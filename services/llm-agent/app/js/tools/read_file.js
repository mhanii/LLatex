// @ts-check
import { resolveFile, docUpdaterUrl } from './utils.js'

/**
 * Read lines from a LaTeX file, optionally sliced to a range.
 *
 * @param {{ path: string, fromLine?: number, toLine?: number }} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<string>} Numbered lines, or an error string on failure.
 */
export async function readFile({ path, fromLine, toLine }, ctx) {
  const { docId } = resolveFile(path, ctx)
  const res = await fetch(
    `${docUpdaterUrl()}/project/${ctx.projectId}/doc/${docId}/peek`
  )
  if (res.status === 404) {
    return `"${path}" is not loaded yet — try listing files first.`
  }
  if (!res.ok) {
    return `Failed to read "${path}": HTTP ${res.status}`
  }
  const { lines } = /** @type {{lines: string[]}} */ (await res.json())
  const start = fromLine ?? 0
  const slice = lines.slice(start, toLine != null ? toLine + 1 : undefined)
  return slice.map((l, i) => `${start + i + 1}: ${l}`).join('\n')
}
