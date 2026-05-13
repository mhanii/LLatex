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

async function ensureConversation(projectId, conversationId, userId, message) {
  const now = new Date()
  // Atomic upsert: a non-atomic findOne+insertOne races on concurrent first
  // messages to the same conversationId and throws E11000 on the loser.
  const doc = await db.agentConversations.findOneAndUpdate(
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
  return formatConversation(doc)
}

async function recordMessage(projectId, conversationId, message, role, runId) {
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
        },
      },
    }
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

async function getMessageRoles(projectId, conversationId) {
  const conversation = await db.agentConversations.findOne(
    {
      _id: normalizeObjectId(conversationId, 'conversationId'),
      projectId: normalizeObjectId(projectId, 'projectId'),
    },
    { projection: { messages: 1 } }
  )
  const roles = new Map()
  for (const message of conversation?.messages ?? []) {
    roles.set(message.messageId, message.role)
  }
  return roles
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
    })
  }
  return meta
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
  ensureConversation: callbackify(ensureConversation),
  recordMessage: callbackify(recordMessage),
  getMessageRoles: callbackify(getMessageRoles),
  getMessageMetadata: callbackify(getMessageMetadata),
  recordRun: callbackify(recordRun),
  promises: {
    createConversation,
    listConversations,
    getConversation,
    ensureConversation,
    recordMessage,
    getMessageRoles,
    getMessageMetadata,
    recordRun,
  },
}
