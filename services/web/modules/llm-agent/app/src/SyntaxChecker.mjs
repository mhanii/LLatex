// @ts-check

import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import { Parse } from './parsers/latex-linter.mjs'

// Label extraction regexes — same as MetaHandler.mjs (keeps comment-stripping
// and edge-case handling consistent with Overleaf's editor autocomplete).
const LABEL_RE = /\\label{(.{0,80}?)}/g
const LABEL_OPTION_RE = /\blabel={?(.{0,80}?)[\s},\]]/g

// Project-level structural regexes (single-file linter doesn't see other files)
const REF_RE =
  /\\(?:ref|eqref|pageref|autoref|cref|Cref|vref|vpageref)\*?\{([^}]{1,80})\}/g
const INPUT_RE = /\\(?:input|include)\s*\{([^}]{1,100})\}/g

const norm = p => (p.startsWith('/') ? p.slice(1) : p)

/** Same comment-stripping as MetaHandler.getNonCommentedContent */
function stripComment(rawLine) {
  return rawLine.replace(/(^|[^\\])%.*/, '$1')
}

/**
 * Convert a 0-indexed character offset into a 1-indexed line number.
 * @param {string} text
 * @param {number} pos
 * @returns {number}
 */
function offsetToLine(text, pos) {
  if (pos <= 0) return 1
  let line = 1
  const cap = Math.min(pos, text.length)
  for (let i = 0; i < cap; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/**
 * Run editor-parity static analysis on a project's documents without
 * compiling. Two passes:
 *
 *   1. **Per-file** — run the ported CodeMirror 6 LaTeX linter (`Parse`) on
 *      each doc. Same tokenizer + interpreter the editor uses for the
 *      red-squiggle gutter linter, so we catch the same structural issues:
 *      unbalanced environments, malformed args, mismatched delimiters,
 *      bracket / brace problems, etc.
 *
 *   2. **Cross-file** — duplicate `\label{}` definitions, undefined `\ref{}`
 *      targets (project-wide), and `\input{}`/`\include{}` files that aren't
 *      in the project. The single-file linter can't see across files so we
 *      keep this layer on top.
 *
 * Document content is fetched from document-updater (Redis) so edits are
 * visible immediately — no flush to MongoDB required.
 *
 * @param {string} projectId
 * @param {string | null} scopePath  Normalised file path, or null for all files.
 * @returns {Promise<{ issues: Array<{type: string, message: string, file?: string, line?: number}> }>}
 */
async function check(projectId, scopePath) {
  const allDocs = await ProjectEntityHandler.promises.getAllDocs(projectId)

  /** @type {Map<string, {lines: string[]}>} */
  const docContents = new Map()
  const entries = Object.entries(allDocs).filter(
    ([rawPath]) => !scopePath || norm(rawPath) === scopePath
  )
  await Promise.all(
    entries.map(async ([rawPath, doc]) => {
      try {
        const docData = await DocumentUpdaterHandler.promises.getDocument(
          projectId,
          doc._id.toString(),
          '0'
        )
        docContents.set(doc._id.toString(), { lines: docData.lines })
      } catch {
        // Doc not yet in Redis (e.g. freshly created), fall back to Mongo lines.
        docContents.set(doc._id.toString(), { lines: doc.lines })
      }
    })
  )

  const docIdToPath = new Map()
  for (const [rawPath, doc] of Object.entries(allDocs)) {
    docIdToPath.set(doc._id.toString(), norm(rawPath))
  }

  const projectPaths = new Set(Object.keys(allDocs).map(norm))
  const issues = []

  // ── 1. Cross-file label inventory (same logic as MetaHandler) ─────────────
  /** @type {Map<string, string[]>} label → list of files where defined */
  const labelDefs = new Map()
  for (const [docId, content] of docContents) {
    const filePath = docIdToPath.get(docId) ?? docId
    if (scopePath && filePath !== scopePath) continue
    for (const rawLine of content.lines) {
      const line = stripComment(rawLine)
      for (const m of line.matchAll(LABEL_RE)) {
        const label = m[1].trim()
        if (!label) continue
        const locs = labelDefs.get(label) ?? []
        locs.push(filePath)
        labelDefs.set(label, locs)
      }
      for (const m of line.matchAll(LABEL_OPTION_RE)) {
        const label = m[1].trim()
        if (!label) continue
        const locs = labelDefs.get(label) ?? []
        locs.push(filePath)
        labelDefs.set(label, locs)
      }
    }
  }

  for (const [label, files] of labelDefs) {
    if (files.length > 1) {
      const uniq = [...new Set(files)]
      issues.push({
        type: 'warning',
        message: `Duplicate \\label{${label}} defined in: ${uniq.join(', ')}`,
      })
    }
  }

  // Cross-file undefined-ref checking only makes sense when all files are loaded.
  const checkRefs = !scopePath

  // ── 2. Per-doc passes ─────────────────────────────────────────────────────
  for (const [docId, content] of docContents) {
    const filePath = docIdToPath.get(docId) ?? docId
    if (scopePath && filePath !== scopePath) continue

    const text = content.lines.join('\n')

    // Editor-parity structural lint (replaces the old begin/end regex pass).
    let lintErrors = []
    try {
      lintErrors = Parse(text).errors
    } catch {
      // Parse can throw on pathological input (>100k tokens, infinite loop
      // detection). Skip cleanly — cross-file checks below still run.
    }
    // De-dupe linter errors that share a message (the linter occasionally
    // emits both "unclosed X" and "unclosed X found at Y" for the same root
    // cause; mirror the editor's mergeCompatibleOverlappingDiagnostics behaviour).
    const seenLintMessages = new Set()
    for (const e of lintErrors) {
      if (seenLintMessages.has(e.text)) continue
      seenLintMessages.add(e.text)
      issues.push({
        type: e.type === 'info' ? 'info' : e.type, // 'error' | 'warning' | 'info'
        message: e.text,
        file: filePath,
        line: offsetToLine(text, e.startPos),
      })
    }

    // Project-wide undefined-ref check (linter can't see other files).
    if (checkRefs) {
      for (const m of text.matchAll(REF_RE)) {
        const label = m[1].trim()
        if (!labelDefs.has(label)) {
          issues.push({
            type: 'warning',
            message: `Undefined reference \\ref{${label}}`,
            file: filePath,
          })
        }
      }
    }

    // Missing \input / \include files (linter sees the command but can't
    // verify the referenced file exists in the project tree).
    for (const m of text.matchAll(INPUT_RE)) {
      const raw = m[1].trim()
      const ref = raw.includes('.') ? raw : raw + '.tex'
      const found =
        projectPaths.has(ref) ||
        [...projectPaths].some(p => p === ref || p.endsWith('/' + ref))
      if (!found) {
        issues.push({
          type: 'warning',
          message: `\\input{${raw}} references a file not in the project`,
          file: filePath,
        })
      }
    }
  }

  return { issues }
}

export default { check }
