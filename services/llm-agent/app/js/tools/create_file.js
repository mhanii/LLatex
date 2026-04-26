// @ts-check
import { webUrl, basicAuth } from './utils.js'

/**
 * Create a new file in the project at the given path.
 *
 * @param {{ path: string, content?: string }} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<{path: string, docId: string} | string>}
 */
export async function createFile({ path, content }, ctx) {
  const res = await fetch(
    `${webUrl()}/internal/project/${ctx.projectId}/agent/create-file`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(),
      },
      body: JSON.stringify({ path, content: content ?? '', userId: ctx.userId }),
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return `Create failed: HTTP ${res.status} — ${body}`
  }
  return /** @type {{path: string, docId: string}} */ (await res.json())
}
