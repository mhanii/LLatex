// @ts-check
import { docUpdaterUrl } from './utils.js'

const HARD_MAX_RESULTS = 500
const DEFAULT_MAX_RESULTS = 100
const FETCH_TIMEOUT_MS = 30_000
// Cap on the number of files we'll fan-out to in a single grep call. Doc-updater
// is light per-doc but a project with thousands of files would still flood it.
const MAX_FILES_PER_CALL = 200

/**
 * Convert a simple glob to an anchored RegExp. Supports:
 *   `**\/`  → zero or more path segments (bash globstar — `**\/*.tex` matches `a.tex` and `dir/a.tex`)
 *   `**`   → any sequence of characters, including `/`
 *   `*`    → any sequence of characters except `/`
 *   `?`    → exactly one character except `/`
 * Everything else is matched literally.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  let re = '^'
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      re += '(?:.*/)?'
      i += 3
    } else if (c === '*' && glob[i + 1] === '*') {
      re += '.*'
      i += 2
    } else if (c === '*') {
      re += '[^/]*'
      i++
    } else if (c === '?') {
      re += '[^/]'
      i++
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += '\\' + c
      i++
    } else {
      re += c
      i++
    }
  }
  re += '$'
  return new RegExp(re)
}

/**
 * Fetch a doc's current lines via doc-updater. Peek first (Redis-only,
 * lock-free), falling back to the loading endpoint when the doc isn't hot.
 * Returns null on 404 so the caller can skip the file silently — files can be
 * deleted mid-run.
 * @param {string} projectId
 * @param {string} docId
 * @returns {Promise<string[] | null>}
 */
async function fetchDocLines(projectId, docId) {
  const base = `${docUpdaterUrl()}/project/${projectId}/doc/${docId}`
  let res = await fetch(`${base}/peek`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (res.status === 404) {
    res = await fetch(base, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  }
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching doc ${docId}`)
  }
  const { lines } = /** @type {{lines: string[]}} */ (await res.json())
  return lines
}

/**
 * Regex grep across the project. Iterates `ctx.context.files` (optionally
 * filtered by pathGlob), fetches each doc's current content from doc-updater,
 * and returns matching lines.
 *
 * @param {{
 *   pattern: string,
 *   pathGlob?: string,
 *   caseSensitive?: boolean,
 *   maxResults?: number
 * }} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<string>}
 */
export async function grep(
  { pattern, pathGlob, caseSensitive, maxResults },
  ctx
) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return 'pattern must be a non-empty string'
  }
  let re
  try {
    re = new RegExp(pattern, caseSensitive ? '' : 'i')
  } catch (err) {
    return `Invalid regex: ${err.message}`
  }

  let globRe = null
  if (pathGlob != null) {
    if (typeof pathGlob !== 'string' || pathGlob.length === 0) {
      return 'pathGlob must be a non-empty string when provided'
    }
    try {
      globRe = globToRegExp(pathGlob)
    } catch (err) {
      return `Invalid pathGlob: ${err.message}`
    }
  }

  const cap = Math.min(
    Math.max(1, maxResults ?? DEFAULT_MAX_RESULTS),
    HARD_MAX_RESULTS
  )

  const allFiles = ctx.context?.files ?? []
  const files = (globRe ? allFiles.filter(f => globRe.test(f.path)) : allFiles)
    .slice(0, MAX_FILES_PER_CALL)

  if (files.length === 0) {
    return 'No matches found'
  }

  // Fan out in parallel — each request is independent and doc-updater handles
  // its own concurrency. Failures on a single doc don't poison the whole grep.
  const perFile = await Promise.all(
    files.map(async f => {
      try {
        const lines = await fetchDocLines(ctx.projectId, f.docId)
        if (lines == null) return []
        const hits = []
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            hits.push(`${f.path}:${i + 1}:${lines[i]}`)
          }
        }
        return hits
      } catch (err) {
        logger.warn({ err, docId: f.docId, projectId: ctx.projectId }, 'grep: failed to fetch doc')
        return []
      }
    })
  )

  const results = []
  for (const hits of perFile) {
    for (const h of hits) {
      results.push(h)
      if (results.length >= cap) return results.join('\n')
    }
  }
  return results.length > 0 ? results.join('\n') : 'No matches found'
}
