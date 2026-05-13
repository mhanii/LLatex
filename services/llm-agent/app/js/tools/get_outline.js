// @ts-check
import { resolveFile, docUpdaterUrl, unknownPathError } from './utils.js'

const OUTLINE_RE =
  /^\\(chapter|section|subsection|subsubsection)\*?\{([^}]*)\}|^\\begin\{([^}]+)\}/

/**
 * @param {{ path: string }} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<Array<{type: string, title: string, lineNumber: number}> | string>}
 */
export async function getOutline({ path }, ctx) {
  const file = resolveFile(path, ctx)
  if (!file) return unknownPathError(path)
  const { docId } = file
  const base = `${docUpdaterUrl()}/project/${ctx.projectId}/doc/${docId}`
  // Peek first — Redis-only, lock-free, reflects the latest in-flight edits
  // from any active client. On 404 the doc isn't in Redis yet; fall back to
  // the loading endpoint, which reads from docstore and warms Redis.
  let res = await fetch(`${base}/peek`, { signal: AbortSignal.timeout(30_000) })
  if (res.status === 404) {
    res = await fetch(base, { signal: AbortSignal.timeout(30_000) })
  }
  if (res.status === 404) {
    return `"${path}" not found in project storage. Call list_files to confirm the path.`
  }
  if (!res.ok) {
    return `Failed to read "${path}": HTTP ${res.status}`
  }
  const { lines } = /** @type {{lines: string[]}} */ (await res.json())
  const outline = []
  for (let i = 0; i < lines.length; i++) {
    const m = OUTLINE_RE.exec(lines[i].trim())
    if (!m) continue
    outline.push({
      type: m[1] ?? `begin:${m[3]}`,
      title: m[2] ?? m[3] ?? '',
      lineNumber: i + 1,
    })
  }
  return outline
}
