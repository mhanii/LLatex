// @ts-check

import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'

// Label extraction regexes — same as MetaHandler.mjs (keeps comment-stripping
// and edge-case handling consistent with Overleaf's editor autocomplete).
const LABEL_RE = /\\label{(.{0,80}?)}/g
const LABEL_OPTION_RE = /\blabel={?(.{0,80}?)[\s},\]]/g

// Structural analysis regexes
const REF_RE =
  /\\(?:ref|eqref|pageref|autoref|cref|Cref|vref|vpageref)\*?\{([^}]{1,80})\}/g
const INPUT_RE = /\\(?:input|include)\s*\{([^}]{1,100})\}/g
const BEGIN_RE = /\\begin\{([^}]{1,80})\}/g
const END_RE = /\\end\{([^}]{1,80})\}/g

const norm = p => (p.startsWith('/') ? p.slice(1) : p)

/** Same comment-stripping as MetaHandler.getNonCommentedContent */
function stripComment(rawLine) {
  return rawLine.replace(/(^|[^\\])%.*/, '$1')
}

/**
 * Run structural analysis on a project's documents without compiling.
 *
 * Reads document content from document-updater (Redis) so edits are visible
 * immediately — no flush to MongoDB required. Label extraction uses the same
 * regexes as MetaHandler, keeping behaviour consistent with the editor.
 *
 * @param {string} projectId
 * @param {string | null} scopePath  Normalised file path, or null for all files.
 * @returns {Promise<{ issues: Array<{type: string, message: string, file?: string}> }>}
 */
async function check(projectId, scopePath) {
  // Project structure from MongoDB (docIds → paths, cheap metadata query).
  const allDocs = await ProjectEntityHandler.promises.getAllDocs(projectId)

  // Fetch actual line content from Redis (document-updater) — parallel.
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

  // Build docId → normalised path mapping.
  const docIdToPath = new Map()
  for (const [rawPath, doc] of Object.entries(allDocs)) {
    docIdToPath.set(doc._id.toString(), norm(rawPath))
  }

  const projectPaths = new Set(Object.keys(allDocs).map(norm))
  const issues = []

  // ── 1. Extract labels (same logic as MetaHandler.extractMetaFromDoc) ───────
  /** @type {Map<string, string>} label → first-seen file */
  const labelDefs = new Map()
  for (const [docId, content] of docContents) {
    const filePath = docIdToPath.get(docId) ?? docId
    if (scopePath && filePath !== scopePath) continue
    for (const rawLine of content.lines) {
      const line = stripComment(rawLine)
      for (const m of line.matchAll(LABEL_RE)) {
        const label = m[1].trim()
        if (label && !labelDefs.has(label)) labelDefs.set(label, filePath)
      }
      for (const m of line.matchAll(LABEL_OPTION_RE)) {
        const label = m[1].trim()
        if (label && !labelDefs.has(label)) labelDefs.set(label, filePath)
      }
    }
  }

  // Cross-file undefined-ref checking only makes sense when all files are loaded.
  const checkRefs = !scopePath

  // ── 2. Per-doc passes ─────────────────────────────────────────────────────
  for (const [docId, content] of docContents) {
    const filePath = docIdToPath.get(docId) ?? docId
    if (scopePath && filePath !== scopePath) continue

    const { lines } = content
    const text = lines.join('\n')

    // Undefined \ref targets
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

    // Missing \input / \include files
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

    // Unbalanced \begin / \end
    /** @type {Array<{env: string, line: number}>} */
    const stack = []
    for (let i = 0; i < lines.length; i++) {
      const noComment = stripComment(lines[i])
      for (const m of noComment.matchAll(BEGIN_RE)) {
        stack.push({ env: m[1], line: i + 1 })
      }
      for (const m of noComment.matchAll(END_RE)) {
        const env = m[1]
        if (stack.length === 0) {
          issues.push({
            type: 'error',
            message: `\\end{${env}} without matching \\begin at line ${i + 1}`,
            file: filePath,
          })
        } else if (stack[stack.length - 1].env !== env) {
          const open = stack.pop()
          issues.push({
            type: 'error',
            message: `\\end{${env}} at line ${i + 1} doesn't match \\begin{${open?.env}} at line ${open?.line}`,
            file: filePath,
          })
        } else {
          stack.pop()
        }
      }
    }
    for (const { env, line } of stack) {
      issues.push({
        type: 'warning',
        message: `Unclosed \\begin{${env}} at line ${line}`,
        file: filePath,
      })
    }
  }

  return { issues }
}

export default { check }
