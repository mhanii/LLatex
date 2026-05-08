// @ts-check
import { resolveFile, docUpdaterUrl } from './utils.js'

/**
 * Read lines from a LaTeX file, optionally sliced to a 1-indexed inclusive range.
 *
 * @param {{ path: string, fromLine?: number, toLine?: number }} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<string>} Numbered lines, or an error string on failure.
 */
export async function readFile({ path, fromLine, toLine }, ctx) {
  const { docId } = resolveFile(path, ctx)
  const res = await fetch(
    `${docUpdaterUrl()}/project/${ctx.projectId}/doc/${docId}/peek`,
    { signal: AbortSignal.timeout(30_000) } // 30s timeout
  )
  if (res.status === 404) {
    return `"${path}" is not loaded yet — try listing files first.`
  }
  if (!res.ok) {
    return `Failed to read "${path}": HTTP ${res.status}`
  }
  const { lines } = /** @type {{lines: string[]}} */ (await res.json())
  if (
    (fromLine != null && (!Number.isInteger(fromLine) || fromLine < 1)) ||
    (toLine != null && (!Number.isInteger(toLine) || toLine < 1))
  ) {
    return 'Invalid line range: fromLine/toLine must be positive integers (1-indexed).'
  }

  const startLine = fromLine ?? 1
  const endLine = toLine ?? lines.length
  if (endLine < startLine) {
    return 'Invalid line range: toLine must be greater than or equal to fromLine.'
  }

  const slice = lines.slice(startLine - 1, endLine)
  return slice.map((l, i) => `${startLine + i}: ${l}`).join('\n')
}
