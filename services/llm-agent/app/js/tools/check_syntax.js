// @ts-check
import { webUrl, basicAuth } from './utils.js'

/**
 * @typedef {{ issues: Array<{type: string, message: string, file?: string}> }} SyntaxResult
 */

/**
 * Run editor-parity static analysis on project documents without compiling.
 *
 * Two passes are performed server-side by SyntaxChecker in the web module:
 *   1. Per-file CodeMirror linter (port of latex-linter.worker.ts) — same
 *      tokenizer + interpreter the editor uses for the red-squiggle gutter
 *      linter. Catches unbalanced environments, mismatched delimiters,
 *      malformed args, etc.
 *   2. Project-wide cross-file regex pass — duplicate \label{} definitions,
 *      undefined \ref{} targets (when path is omitted), and \input{} /
 *      \include{} pointing at files that are not in the project.
 *
 * Document content is read from document-updater (Redis) so edits are
 * visible immediately — no flush to MongoDB required.
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
