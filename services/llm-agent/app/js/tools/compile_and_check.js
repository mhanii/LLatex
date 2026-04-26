// @ts-check
import { webUrl, basicAuth } from './utils.js'

/**
 * @typedef {{ success: boolean, status: string, errors: string[] }} CompileResult
 */

/**
 * Compile the project and return structured LaTeX errors.
 * Call this after edits to verify the document still compiles.
 *
 * @param {Record<string, never>} _input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<CompileResult>}
 */
export async function compileAndCheck(_input, ctx) {
  const res = await fetch(
    `${webUrl()}/internal/project/${ctx.projectId}/agent/compile`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(),
      },
      body: JSON.stringify({ userId: ctx.userId }),
    }
  )
  if (!res.ok) {
    return { success: false, status: `HTTP ${res.status}`, errors: [] }
  }
  return /** @type {CompileResult} */ (await res.json())
}
