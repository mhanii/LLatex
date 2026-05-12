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

async function listConversations(projectId) {
  const conversations = await db.agentConversations
    .find({ projectId: normalizeObjectId(projectId, 'projectId') })
    .sort({ updatedAt: -1, _id: -1 })
    .toArray()
  return conversations.map(formatConversation)
}

async function getConversation(projectId, conversationId) {
  const conversation = await db.agentConversations.findOne({
    _id: normalizeObjectId(conversationId, 'conversationId'),
    projectId: normalizeObjectId(projectId, 'projectId'),
  })
  return conversation ? formatConversation(conversation) : null
}

async function ensureConversation(projectId, conversationId, userId, message) {
  const now = new Date()
  const _id = normalizeObjectId(conversationId, 'conversationId')
  const existing = await db.agentConversations.findOne({
    _id,
    projectId: normalizeObjectId(projectId, 'projectId'),
  })
  if (existing) return formatConversation(existing)

  const doc = {
    _id,
    projectId: normalizeObjectId(projectId, 'projectId'),
    createdBy: normalizeObjectId(userId, 'userId'),
    title: message ? titleFromMessage(message) : DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    lastRunId: null,
    messages: [],
  }
  await db.agentConversations.insertOne(doc)
  return formatConversation(doc)
}

async function recordMessage(projectId, conversationId, message, role, runId) {
  const now = new Date()
  const messageId = message.id ?? message._id?.toString()
  if (!messageId) return

  const update = {
    $set: {
      updatedAt: now,
      lastMessageAt: new Date(message.timestamp ?? now),
      ...(runId ? { lastRunId: runId } : {}),
    },
    $addToSet: {
      messages: {
        messageId,
        role,
        runId: runId ?? null,
        createdAt: now,
      },
    },
  }

  if (role === 'user') {
    update.$setOnInsert = {
      title: titleFromMessage(message.content ?? ''),
      createdAt: now,
      createdBy: normalizeObjectId(message.user_id, 'userId'),
    }
  }

  await db.agentConversations.updateOne(
    {
      _id: normalizeObjectId(conversationId, 'conversationId'),
      projectId: normalizeObjectId(projectId, 'projectId'),
    },
    update,
    { upsert: false }
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
  recordRun: callbackify(recordRun),
  promises: {
    createConversation,
    listConversations,
    getConversation,
    ensureConversation,
    recordMessage,
    getMessageRoles,
    recordRun,
  },
}
