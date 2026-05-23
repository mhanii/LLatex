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
 * @param {{ userId: string, conversationId: string, userMessage: string, selection?: object, context?: object, chatHistory?: Array<{id: string, user_id: string, content: string, timestamp: number, role: 'user'|'assistant', runId: string|null}> }} payload
 * @returns {Promise<{ runId: string }>}
 */
async function startRun(projectId, payload) {
  return await fetchJson(agentUrl(`/project/${projectId}/run`), {
    method: 'POST',
    json: payload,
  })
}

/**
 * @param {string} projectId
 * @param {string} runId
 * @returns {Promise<{ steps: Array<{ name: string, output?: { toolCalls?: Array<{ toolCallId: string, toolName: string, input: unknown }>, toolResults?: Array<{ toolCallId: string, toolName: string, input: unknown, output: unknown }> } }> }>}
 */
async function getRunSteps(projectId, runId) {
  return await fetchJson(agentUrl(`/project/${projectId}/run/${runId}/steps`), {
    method: 'GET',
  })
}

/**
 * @param {string} projectId
 * @param {string} runId
 * @returns {Promise<{ cancelled: boolean }>}
 */
async function cancelRun(projectId, runId) {
  return await fetchJson(
    agentUrl(`/project/${projectId}/run/${runId}/cancel`),
    { method: 'POST' }
  )
}

export default {
  promises: { startRun, getRunSteps, cancelRun },
}
