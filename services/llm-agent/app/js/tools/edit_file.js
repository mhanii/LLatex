// @ts-check
import { resolveFile, docUpdaterUrl } from './utils.js'

/**
 * Replace exact text in a file as a tracked change.
 * Re-read the file first to get exact text. If old_text is not found, re-read and retry.
 *
 * @param {{ path: string, oldText: string, newText: string }} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<string>}
 */
export async function editFile({ path, oldText, newText }, ctx) {
  const { docId } = resolveFile(path, ctx)
  const res = await fetch(
    `${docUpdaterUrl()}/project/${ctx.projectId}/doc/${docId}/agent-replace`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_text: oldText,
        new_text: newText,
        user_id: ctx.userId,
      }),
    }
  )
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}))
    console.error('[edit_file] 404 body:', JSON.stringify(body))
    return `"${oldText}" not found in ${path} — re-read the file and retry.`
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return `Edit failed: HTTP ${res.status} — ${body}`
  }
  return 'Change applied.'
}
