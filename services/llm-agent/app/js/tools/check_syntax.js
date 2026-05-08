// @ts-check
import { webUrl, basicAuth } from './utils.js'

/**
 * @typedef {{ issues: Array<{type: string, message: string, file?: string}> }} SyntaxResult
 */

/**
 * Run structural analysis on project documents without compiling.
 *
 * Analysis is performed server-side by SyntaxChecker in the web module, which
 * uses Overleaf's own MetaHandler for label extraction (the same logic that
 * drives editor autocomplete), then adds ref-usage, \input, and \begin/\end
 * checks using custom regex where no equivalent Overleaf code exists.
 *
 * Detects:
 *  - Undefined \ref{} targets (project-wide cross-file, when path is omitted)
 *  - Duplicate \label{} definitions
 *  - \input{} / \include{} referencing a file not in the project
 *  - Unbalanced \begin{} / \end{} pairs (with line numbers)
 *
 * @param {{ path?: string }} input
 *   If path is provided, analysis is scoped to that file (cross-file ref
 *   checking is skipped since not all labels are available).
 *   If omitted, all project files are analysed together.
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<SyntaxResult>}
 */
export async function checkSyntax({ path } = {}, ctx) {
  const url = new URL(
    `${webUrl()}/internal/project/${ctx.projectId}/agent/syntax-check`
  )
  if (path) url.searchParams.set('path', path)

  const res = await fetch(url.toString(), {
    headers: { Authorization: basicAuth() },
    signal: AbortSignal.timeout(30_000), // 30s timeout
  })
  if (!res.ok) {
    return { issues: [{ type: 'error', message: `HTTP ${res.status}` }] }
  }
  return /** @type {SyntaxResult} */ (await res.json())
}
