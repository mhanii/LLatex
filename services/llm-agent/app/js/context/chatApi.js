// @ts-check

import settings from '@overleaf/settings'

/**
 * @typedef {Object} ChatThreadMessage
 * @property {string} id
 * @property {string} content
 * @property {number} timestamp
 * @property {string} user_id
 * @property {number} [edited_at]
 */

function chatUrl() {
  return settings.apis.chat.url
}

/**
 * Fetch the messages of a single thread from the chat service. Returns [] when
 * the thread does not exist yet (a fresh conversation), so seeders can call
 * this unconditionally on every run.
 *
 * @param {string} projectId
 * @param {string} conversationId  - must be a valid ObjectId hex (chat enforces)
 * @returns {Promise<ChatThreadMessage[]>}
 */
export async function getThreadMessages(projectId, conversationId) {
  const url = `${chatUrl()}/project/${projectId}/thread/${conversationId}`
  const res = await fetch(url)
  if (res.status === 404) return []
  if (!res.ok) {
    throw new Error(`chat getThread failed: HTTP ${res.status}`)
  }
  const body = /** @type {{messages?: ChatThreadMessage[]}} */ (await res.json())
  return Array.isArray(body?.messages) ? body.messages : []
}
