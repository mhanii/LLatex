// @ts-check

import logger from '@overleaf/logger'
import { createRun, getStepsForRunInProject } from './AgentStore.js'
import { run } from './AgentManager.js'
import { getAgent } from './agents/registry.js'

async function startRun(req, res) {
  const { projectId } = req.params
  const {
    userId,
    conversationId,
    userMessage,
    selection,
    context,
    currentFile,
    agentName,
    chatHistory,
  } = req.body

  if (!userId || !conversationId || !userMessage) {
    return res
      .status(400)
      .json({ error: 'userId, conversationId, and userMessage are required' })
  }

  if (agentName != null && (typeof agentName !== 'string' || !getAgent(agentName))) {
    return res.status(400).json({ error: 'unknown agentName' })
  }

  const startedAt = new Date()

  /** @type {import('./types.js').AgentInput} */
  const input = {
    projectId,
    userId,
    conversationId,
    userMessage,
    selection,
    context,
    currentFile,
    agentName,
    chatHistory,
  }

  const runId = await createRun(projectId, input)

  logger.debug({ runId, projectId, userId, agentName }, 'agent run started')

  // Fire-and-forget: do not await so HTTP 200 returns immediately
  run(runId, input, startedAt, { agentName }).catch(err => {
    logger.error({ err, runId }, 'unhandled error in agent run')
  })

  res.status(200).json({ runId })
}

async function getRunSteps(req, res) {
  const { projectId, runId } = req.params
  const steps = await getStepsForRunInProject(projectId, runId)
  if (steps === null) {
    return res.status(404).json({ error: 'run not found in project' })
  }
  res.json({ steps })
}

export default { startRun, getRunSteps }
