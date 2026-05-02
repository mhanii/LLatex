// @ts-check

import logger from '@overleaf/logger'
import settings from '@overleaf/settings'
import { finalizeRun } from './AgentStore.js'

function webUrl(path) {
  return new URL(path, settings.apis.web.url).toString()
}

function basicAuth() {
  return (
    'Basic ' +
    Buffer.from(
      `${settings.httpAuthUser}:${settings.httpAuthPass}`
    ).toString('base64')
  )
}

async function notifyWebAgentComplete(projectId, payload) {
  const response = await fetch(
    webUrl(`/internal/project/${projectId}/agent/complete`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(),
      },
      body: JSON.stringify(payload),
    }
  )
  if (!response.ok) {
    throw new Error(`agent completion callback failed with HTTP ${response.status}`)
  }
}

/**
 * Entry point for the agent loop. Called without await (fire-and-forget)
 * so the HTTP response can return immediately with the runId.
 *
 * @param {string} runId
 * @param {import('./types.js').AgentInput} input
 * @param {Date} startedAt
 */
export async function run(runId, input, startedAt) {
  try {
    // TODO: replace stub with real LLM provider call + tool loop
    const output = { type: 'text', content: 'stub' }
    await finalizeRun(runId, output, startedAt)
    try {
      await notifyWebAgentComplete(input.projectId, {
        conversationId: input.conversationId,
        userId: input.userId,
        content: output.content,
      })
    } catch (notifyErr) {
      logger.warn(
        { err: notifyErr, runId, projectId: input.projectId },
        'agent completion callback failed'
      )
    }
  } catch (err) {
    logger.error({ err, runId }, 'agent run failed')
    try {
      const output = { type: 'error', content: err.message }
      await finalizeRun(
        runId,
        output,
        startedAt
      )
      try {
        await notifyWebAgentComplete(input.projectId, {
          conversationId: input.conversationId,
          userId: input.userId,
          content: output.content,
        })
      } catch (notifyErr) {
        logger.warn(
          { err: notifyErr, runId, projectId: input.projectId },
          'agent error completion callback failed'
        )
      }
    } catch (finalizeErr) {
      logger.error({ err: finalizeErr, runId }, 'failed to finalize errored run')
    }
  }
}
