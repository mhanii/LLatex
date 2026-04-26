// @ts-check
import { resolveFile, docUpdaterUrl } from './utils.js'

const OUTLINE_RE =
  /^\\(chapter|section|subsection|subsubsection)\*?\{([^}]*)\}|^\\begin\{([^}]+)\}/

/**
 * @param {{ path: string }} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<Array<{type: string, title: string, lineNumber: number}> | string>}
 */
export async function getOutline({ path }, ctx) {
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
