// @ts-check

import logger from '@overleaf/logger'
import { finalizeRun } from './AgentStore.js'

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
    await finalizeRun(runId, { type: 'text', content: 'stub' }, startedAt)
  } catch (err) {
    logger.error({ err, runId }, 'agent run failed')
    try {
      await finalizeRun(
        runId,
        { type: 'error', content: err.message },
        startedAt
      )
    } catch (finalizeErr) {
      logger.error({ err: finalizeErr, runId }, 'failed to finalize errored run')
    }
  }
}
