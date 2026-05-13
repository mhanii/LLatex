// @ts-check
import { webUrl, basicAuth } from './utils.js'

/**
 * @typedef {{
 *   level: 'error' | 'warning' | 'typesetting',
 *   file?: string,
 *   line?: number | string | null,
 *   message: string,
 *   ruleId?: string,
 *   command?: string,
 * }} LogEntry
 *
 * @typedef {{
 *   success: boolean,
 *   status: string,
 *   errors: LogEntry[],
 *   warnings: LogEntry[],
 *   typesetting: LogEntry[],
 *   pageCount: number | null
 * }} CompileResult
 */

/**
 * Compile the project and return the structured log entries the editor itself
 * shows the user. Errors / warnings / typesetting are produced by the same
 * parsers (LaTeX log parser + HumanReadableLogs ruleset + BibTeX/.blg parser)
 * the Overleaf frontend uses, so the agent and the user are looking at the
 * same view of the compile.
 *
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
      return {
        success: false,
        status: `file not found: ${path}`,
        errors: [],
        warnings: [],
        typesetting: [],
        pageCount: null,
      }
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
    return {
      success: false,
      status: `HTTP ${res.status}`,
      errors: [],
      warnings: [],
      typesetting: [],
      pageCount: null,
    }
  }
  return /** @type {CompileResult} */ (await res.json())
}
