// @ts-check
import { webUrl, basicAuth } from './utils.js'

/**
 * @typedef {{ success: boolean, status: string, errors: string[], pageCount: number | null }} CompileResult
 */

/**
 * Compile the project and return structured LaTeX errors.
 * Call this after edits to verify the document still compiles.
 *
 * @param {{ path?: string }} input  Optional path to compile as the root document.
 *   If omitted, compiles the project's default root document.
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<CompileResult>}
 */
export async function compileAndCheck({ path } = {}, ctx) {
  const body = { userId: ctx.userId }
  if (path) {
    const file = ctx.context?.files?.find(f => f.path === path)
    if (!file) {
      return { success: false, status: `file not found: ${path}`, errors: [] }
    }
    body.rootDoc_id = file.docId
  }
  const res = await fetch(
    `${webUrl()}/internal/project/${ctx.projectId}/agent/compile`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000), // 240s: 180s compile + 60s buffer
    }
  )
  if (!res.ok) {
    return { success: false, status: `HTTP ${res.status}`, errors: [] }
  }
  return /** @type {CompileResult} */ (await res.json())
}
