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
      currentFile: input.currentFile ?? null,
      agentName: input.agentName ?? null,
    },
    steps: [],
    contextItems: [],
    output: null,
    finishedAt: null,
    durationMs: null,
    error: null,
  })
  return result.insertedId.toString()
}

/**
 * Fetch the steps array for a given run. Used by the chat-history seeder to
 * replay a prior assistant turn's tool calls, outputs, and reasoning when the
 * conversation continues. Returns [] if the run is not found.
 *
 * @param {string} runId
 * @returns {Promise<Array<import('./types.js').RunStep>>}
 */
export async function getStepsForRun(runId) {
  if (!runId || !ObjectId.isValid(runId)) return []
  const doc = await db.agentRuns.findOne(
    { _id: new ObjectId(runId) },
    { projection: { steps: 1 } }
  )
  return doc?.steps ?? []
}

/**
 * Like getStepsForRun but also enforces that the run belongs to the given
 * project. Returns null when the run does not exist or belongs to another
 * project — lets the caller distinguish "no such run" from "empty steps".
 *
 * @param {string} projectId
 * @param {string} runId
 * @returns {Promise<Array<import('./types.js').RunStep> | null>}
 */
export async function getStepsForRunInProject(projectId, runId) {
  if (!runId || !ObjectId.isValid(runId)) return null
  const doc = await db.agentRuns.findOne(
    { _id: new ObjectId(runId), projectId },
    { projection: { steps: 1 } }
  )
  if (!doc) return null
  return doc.steps ?? []
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
 * @param {import('./context/types.js').ContextItem} item
 */
export async function appendContextItem(runId, item) {
  await db.agentRuns.updateOne(
    { _id: new ObjectId(runId) },
    { $push: { contextItems: item } }
  )
}

/**
 * Mark a singleton item as replaced. Chains stay on disk for trace.
 *
 * @param {string} runId
 * @param {string} oldId
 * @param {string} newId
 * @param {Date} when
 */
export async function markContextItemReplaced(runId, oldId, newId, when) {
  await db.agentRuns.updateOne(
    { _id: new ObjectId(runId), 'contextItems.id': oldId },
    {
      $set: {
        'contextItems.$.replacedBy': newId,
        'contextItems.$.replacedAt': when,
      },
    }
  )
}

/**
 * @param {string} runId
 * @param {import('./types.js').AgentOutput} output
 * @param {Date} startedAt
 */
export async function finalizeRun(runId, output, startedAt) {
  const finishedAt = new Date()
  const status =
    output.type === 'error'
      ? 'error'
      : output.type === 'cancelled'
        ? 'cancelled'
        : 'done'
  await db.agentRuns.updateOne(
    { _id: new ObjectId(runId) },
    {
      $set: {
        status,
        output,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: output.type === 'error' ? output.content : null,
      },
    }
  )
}
