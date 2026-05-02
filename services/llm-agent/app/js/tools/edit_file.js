// @ts-check
import { resolveFile, docUpdaterUrl } from './utils.js'

async function readErrorBody(res) {
  const body = await res.text().catch(() => '')
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    return { error: body }
  }
}

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
  if (res.ok) {
    return 'Change applied.'
  }

  const errorBody = await readErrorBody(res)

  if (res.status === 404) {
    return `"${oldText}" not found in ${path} — re-read the file and retry.`
  }
  if (res.status === 409) {
    if (errorBody?.code === 'AMBIGUOUS_OLD_TEXT') {
      return `The target text appears multiple times in ${path} — re-read and provide a more specific oldText snippet.`
    }
    return `Edit conflict in ${path}; re-read and retry with a more specific target.`
  }
  if (!res.ok) {
    const body = typeof errorBody?.error === 'string' ? errorBody.error : ''
    return `Edit failed: HTTP ${res.status} — ${body}`
  }
}
