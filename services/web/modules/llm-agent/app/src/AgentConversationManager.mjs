// @ts-check

import { callbackify } from 'node:util'
import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'

const DEFAULT_TITLE = 'New chat'

function objectIdString(id) {
  return id?.toString()
}

function titleFromMessage(message) {
  const collapsed = message.trim().replace(/\s+/g, ' ')
  if (!collapsed) return DEFAULT_TITLE
  return collapsed.length > 48 ? `${collapsed.slice(0, 45)}...` : collapsed
}

function formatConversation(doc) {
  return {
    id: objectIdString(doc._id),
    projectId: objectIdString(doc.projectId),
    createdBy: objectIdString(doc.createdBy),
    title: doc.title || DEFAULT_TITLE,
    createdAt: doc.createdAt?.getTime?.() ?? doc.createdAt,
    updatedAt: doc.updatedAt?.getTime?.() ?? doc.updatedAt,
    lastMessageAt: doc.lastMessageAt?.getTime?.() ?? doc.lastMessageAt ?? null,
    lastRunId: doc.lastRunId ?? null,
  }
}

function normalizeObjectId(id, label) {
  if (!ObjectId.isValid(id)) {
    throw new Error(`${label} must be a valid ObjectId`)
  }
  return new ObjectId(id)
}

function isDuplicateKeyError(err) {
  return err?.code === 11000 || err?.codeName === 'DuplicateKey'
}

async function createConversation(projectId, userId) {
  const now = new Date()
  const _id = new ObjectId()
  const doc = {
    _id,
    projectId: normalizeObjectId(projectId, 'projectId'),
    createdBy: normalizeObjectId(userId, 'userId'),
    title: DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    lastRunId: null,
    messages: [],
  }
  await db.agentConversations.insertOne(doc)
  return formatConversation(doc)
}

async function listConversations(projectId, userId) {
  const conversations = await db.agentConversations
    .find({
      projectId: normalizeObjectId(projectId, 'projectId'),
      createdBy: normalizeObjectId(userId, 'userId'),
    })
    .sort({ updatedAt: -1, _id: -1 })
    .toArray()
  return conversations.map(formatConversation)
}

// userId is optional: the internal agentComplete path does not carry a session
// user. User-facing routes must always pass it to enforce per-creator scoping.
async function getConversation(projectId, conversationId, userId) {
  const conversation = await db.agentConversations.findOne({
    _id: normalizeObjectId(conversationId, 'conversationId'),
    projectId: normalizeObjectId(projectId, 'projectId'),
    ...(userId != null
      ? { createdBy: normalizeObjectId(userId, 'userId') }
      : {}),
  })
  return conversation ? formatConversation(conversation) : null
}

async function deleteConversation(projectId, conversationId) {
  const result = await db.agentConversations.deleteOne({
    _id: normalizeObjectId(conversationId, 'conversationId'),
    projectId: normalizeObjectId(projectId, 'projectId'),
  })
  return result.deletedCount ?? 0
}

async function ensureConversation(projectId, conversationId, userId, message) {
  const now = new Date()
  // Atomic upsert: a non-atomic findOne+insertOne races on concurrent first
  // messages to the same conversationId and throws E11000 on the loser.
  let doc
  try {
    doc = await db.agentConversations.findOneAndUpdate(
      {
        _id: normalizeObjectId(conversationId, 'conversationId'),
        projectId: normalizeObjectId(projectId, 'projectId'),
        ...(userId != null
          ? { createdBy: normalizeObjectId(userId, 'userId') }
          : {}),
      },
      {
        $setOnInsert: {
          createdBy: normalizeObjectId(userId, 'userId'),
          title: message ? titleFromMessage(message) : DEFAULT_TITLE,
          createdAt: now,
          updatedAt: now,
          lastMessageAt: null,
          lastRunId: null,
          messages: [],
        },
      },
      { upsert: true, returnDocument: 'after' }
    )
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw Object.assign(
        new Error('agent conversation not found or not owned by user'),
        { statusCode: 403 }
      )
    }
    throw err
  }
  return formatConversation(doc)
}

async function recordMessage(
  projectId,
  conversationId,
  message,
  role,
  runId,
  projectVersionBefore
) {
  const now = new Date()
  const messageId = message.id ?? message._id?.toString()
  if (!messageId) return

  // Guard the push at the query level so retries (e.g. agentComplete called
  // twice for the same messageId) don't append duplicate entries. $addToSet
  // would not work here because the subdocument carries a per-call createdAt
  // that makes each candidate unique.
  await db.agentConversations.updateOne(
    {
      _id: normalizeObjectId(conversationId, 'conversationId'),
      projectId: normalizeObjectId(projectId, 'projectId'),
      'messages.messageId': { $ne: messageId },
    },
    {
      $set: {
        updatedAt: now,
        lastMessageAt: new Date(message.timestamp ?? now),
        ...(runId ? { lastRunId: runId } : {}),
      },
      $push: {
        messages: {
          messageId,
          role,
          runId: runId ?? null,
          createdAt: now,
          projectVersionBefore:
            typeof projectVersionBefore === 'number'
              ? projectVersionBefore
              : null,
        },
      },
    },
  )

  if (role === 'user') {
    await db.agentConversations.updateOne(
      {
        _id: normalizeObjectId(conversationId, 'conversationId'),
        projectId: normalizeObjectId(projectId, 'projectId'),
        title: DEFAULT_TITLE,
      },
      { $set: { title: titleFromMessage(message.content ?? '') } }
    )
  }
}

// Returns Map<messageId, {role, runId}>. The runId lets the llm-agent service
// look up the prior assistant turn's tool calls/outputs so multi-turn context
// includes them — without it, only the assistant's final text is replayed.
async function getMessageMetadata(projectId, conversationId) {
  const conversation = await db.agentConversations.findOne(
    {
      _id: normalizeObjectId(conversationId, 'conversationId'),
      projectId: normalizeObjectId(projectId, 'projectId'),
    },
    { projection: { messages: 1 } }
  )
  const meta = new Map()
  for (const message of conversation?.messages ?? []) {
    meta.set(message.messageId, {
      role: message.role,
      runId: message.runId ?? null,
      projectVersionBefore:
        typeof message.projectVersionBefore === 'number'
          ? message.projectVersionBefore
          : null,
      createdAt: message.createdAt ?? null,
    })
  }
  return meta
}

// Returns the single message subdoc (or null). Includes the full stored
// shape, not just metadata — callers need messageId, role, createdAt, and
// projectVersionBefore on the same record.
async function findUserMessage(projectId, conversationId, messageId, userId) {
  const conversation = await db.agentConversations.findOne(
    {
      _id: normalizeObjectId(conversationId, 'conversationId'),
      projectId: normalizeObjectId(projectId, 'projectId'),
      ...(userId != null
        ? { createdBy: normalizeObjectId(userId, 'userId') }
        : {}),
    },
    { projection: { messages: 1, createdBy: 1 } }
  )
  if (!conversation) return null
  const message = conversation.messages?.find(m => m.messageId === messageId)
  return message ?? null
}

// Truncates the conversation by removing all messages at or after the given
// createdAt timestamp. Returns the list of removed messageIds so the caller
// can also clean up corresponding chat-service messages.
//
// Uses an atomic `$pull` with a createdAt filter rather than a
// read-then-overwrite. A read-modify-write (`$set: { messages: kept }`)
// would clobber any concurrent `recordMessage` $push that landed between
// the read and the write — e.g. an agent reply being recorded in tab B
// while rollback runs in tab A. A concurrent push has
// createdAt = new Date() (= post-cutoff), so the $pull catches it too —
// the truncation stays consistent without dropping unrelated writes.
async function truncateFromMessage(
  projectId,
  conversationId,
  fromCreatedAt
) {
  const cutoff = fromCreatedAt instanceof Date
    ? fromCreatedAt
    : new Date(fromCreatedAt)
  // Snapshot messages first so we can return the removed messageIds and
  // compute the post-truncate lastMessageAt/lastRunId. The actual mutation
  // below is atomic; a concurrent $push between snapshot and update would
  // also be pulled by the $pull (its createdAt > cutoff), so the kept
  // tail we computed here remains correct.
  const conversation = await db.agentConversations.findOne(
    {
      _id: normalizeObjectId(conversationId, 'conversationId'),
      projectId: normalizeObjectId(projectId, 'projectId'),
    },
    { projection: { messages: 1 } }
  )
  if (!conversation) return []
  const kept = []
  const removed = []
  for (const m of conversation.messages ?? []) {
    const ts = m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt)
    if (ts.getTime() >= cutoff.getTime()) {
      removed.push(m.messageId)
    } else {
      kept.push(m)
    }
  }
  await db.agentConversations.updateOne(
    {
      _id: normalizeObjectId(conversationId, 'conversationId'),
      projectId: normalizeObjectId(projectId, 'projectId'),
    },
    {
      $pull: {
        messages: { createdAt: { $gte: cutoff } },
      },
      $set: {
        updatedAt: new Date(),
        lastMessageAt:
          kept.length > 0 ? kept[kept.length - 1].createdAt ?? null : null,
        lastRunId:
          kept.length > 0
            ? kept
                .filter(m => m.runId)
                .map(m => m.runId)
                .pop() ?? null
            : null,
      },
    }
  )
  return removed
}

// Returns the conversation's lastRunId if it appears to still be in
// flight — i.e. no assistant message with that runId has been recorded
// yet AND it has not been marked cancelled. Returns null if no run is
// active, the run completed, or the run was cancelled. Used to reject
// rollback while the agent is mid-turn (server-side guard against direct
// API hits or stale frontend state).
//
// "completed" is derived from the presence of an assistant message;
// "cancelled" is derived from the `cancelledRunIds` set (populated by
// `markRunCancelled` from the agentCancelled callback). Without the
// cancelled-check, a user who cancels their turn and then tries to roll
// back stays permanently blocked by the in-flight guard: `lastRunId`
// is still set, no assistant message ever lands, so the run would look
// in-flight forever.
async function getActiveRunId(projectId, conversationId) {
  const conversation = await db.agentConversations.findOne(
    {
      _id: normalizeObjectId(conversationId, 'conversationId'),
      projectId: normalizeObjectId(projectId, 'projectId'),
    },
    {
      projection: { messages: 1, lastRunId: 1, cancelledRunIds: 1 },
    }
  )
  if (!conversation?.lastRunId) return null
  const cancelledRunIds = conversation.cancelledRunIds ?? []
  if (cancelledRunIds.includes(conversation.lastRunId)) return null
  const completed = (conversation.messages ?? []).some(
    m => m.role === 'assistant' && m.runId === conversation.lastRunId
  )
  return completed ? null : conversation.lastRunId
}

// Records a run as cancelled. Called from the agentCancelled callback so
// getActiveRunId can distinguish cancelled-but-never-completed runs from
// genuinely in-flight ones. Uses $addToSet for idempotency — the agent
// service can retry cancel callbacks without polluting the set.
async function markRunCancelled(projectId, conversationId, runId) {
  if (!runId) return
  await db.agentConversations.updateOne(
    {
      _id: normalizeObjectId(conversationId, 'conversationId'),
      projectId: normalizeObjectId(projectId, 'projectId'),
    },
    {
      $addToSet: { cancelledRunIds: runId },
      $set: { updatedAt: new Date() },
    }
  )
}

async function recordRun(projectId, conversationId, runId) {
  await db.agentConversations.updateOne(
    {
      _id: normalizeObjectId(conversationId, 'conversationId'),
      projectId: normalizeObjectId(projectId, 'projectId'),
    },
    {
      $set: {
        updatedAt: new Date(),
        lastRunId: runId,
      },
    }
  )
}

export default {
  createConversation: callbackify(createConversation),
  listConversations: callbackify(listConversations),
  getConversation: callbackify(getConversation),
  deleteConversation: callbackify(deleteConversation),
  ensureConversation: callbackify(ensureConversation),
  recordMessage: callbackify(recordMessage),
  getMessageMetadata: callbackify(getMessageMetadata),
  findUserMessage: callbackify(findUserMessage),
  truncateFromMessage: callbackify(truncateFromMessage),
  getActiveRunId: callbackify(getActiveRunId),
  markRunCancelled: callbackify(markRunCancelled),
  recordRun: callbackify(recordRun),
  promises: {
    createConversation,
    listConversations,
    getConversation,
    deleteConversation,
    ensureConversation,
    recordMessage,
    getMessageMetadata,
    findUserMessage,
    truncateFromMessage,
    getActiveRunId,
    markRunCancelled,
    recordRun,
  },
}
