// @ts-check

import logger from '@overleaf/logger'
import { createRun } from './AgentStore.js'
import { run } from './AgentManager.js'

async function startRun(req, res) {
  const { projectId } = req.params
  const { userId, conversationId, userMessage, selection } = req.body

  if (!userId || !conversationId || !userMessage) {
    return res
      .status(400)
      .json({ error: 'userId, conversationId, and userMessage are required' })
  }

  const startedAt = new Date()

  /** @type {import('./types.js').AgentInput} */
  const input = { projectId, userId, conversationId, userMessage, selection }

  const runId = await createRun(projectId, input)

  logger.debug({ runId, projectId, userId }, 'agent run started')

  // Fire-and-forget: do not await so HTTP 200 returns immediately
  run(runId, input, startedAt).catch(err => {
    logger.error({ err, runId }, 'unhandled error in agent run')
  })

  res.status(200).json({ runId })
}

export default { startRun }
