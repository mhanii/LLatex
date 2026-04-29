// @ts-check

import { fetchJson } from '@overleaf/fetch-utils'
import settings from '@overleaf/settings'

/**
 * @param {string} path
 */
function agentUrl(path) {
  return new URL(path, settings.apis.llmAgent.internal_url)
}

/**
 * @param {string} projectId
 * @param {{ userId: string, conversationId: string, userMessage: string, selection?: object }} payload
 * @returns {Promise<{ runId: string }>}
 */
async function startRun(projectId, payload) {
  return await fetchJson(agentUrl(`/project/${projectId}/run`), {
    method: 'POST',
    json: payload,
  })
}

export default {
  promises: { startRun },
}
