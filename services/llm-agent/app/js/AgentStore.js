// @ts-check

import { db, ObjectId } from './mongodb.js'

/**
 * @param {string} projectId
 * @param {import('./types.js').AgentInput} input
 * @returns {Promise<string>} runId
 */
export async function createRun(projectId, input) {
  const now = new Date()
  const result = await db.agentRuns.insertOne({
    projectId,
    userId: input.userId,
    conversationId: input.conversationId,
    createdAt: now,
    status: 'running',
    input: {
      userMessage: input.userMessage,
      selection: input.selection ?? null,
      context: input.context ?? null,
    },
    steps: [],
    output: null,
    finishedAt: null,
    durationMs: null,
    error: null,
  })
  return result.insertedId.toString()
}

/**
 * @param {string} runId
 * @param {import('./types.js').RunStep} step
 */
export async function appendStep(runId, step) {
  await db.agentRuns.updateOne(
    { _id: new ObjectId(runId) },
    { $push: { steps: step } }
  )
}

/**
 * @param {string} runId
 * @param {import('./types.js').AgentOutput} output
 * @param {Date} startedAt
 */
export async function finalizeRun(runId, output, startedAt) {
  const finishedAt = new Date()
  await db.agentRuns.updateOne(
    { _id: new ObjectId(runId) },
    {
      $set: {
        status: output.type === 'error' ? 'error' : 'done',
        output,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: output.type === 'error' ? output.content : null,
      },
    }
  )
}
