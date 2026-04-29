// @ts-check

import { expressify } from '@overleaf/promise-utils'
import { ObjectId } from 'mongodb'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import CompileManager from '../../../../app/src/Features/Compile/CompileManager.mjs'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.mjs'
import LlmAgentApiHandler from './LlmAgentApiHandler.mjs'

async function sendMessage(req, res) {
  const { project_id: projectId } = req.params
  const { message, selection, conversationId: bodyConversationId } = req.body

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'message is required' })
  }

  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }

  const conversationId = bodyConversationId ?? new ObjectId().toHexString()

  const chatMessage = await ChatApiHandler.promises.sendComment(
    projectId,
    conversationId,
    userId,
    message
  )

  const user = await UserInfoManager.promises.getPersonalInfo(chatMessage.user_id)
  chatMessage.user = UserInfoController.formatPersonalInfo(user)

  EditorRealTimeController.emitToRoom(projectId, 'new-chat-message', chatMessage)

  const { runId } = await LlmAgentApiHandler.promises.startRun(projectId, {
    userId,
    conversationId,
    userMessage: message,
    selection: selection ?? undefined,
  })

  res.status(202).json({ runId, messageId: chatMessage.id, conversationId })
}

// Called by llm-agent service after run completes — emits reply over WebSocket.
// Expects { conversationId, messageId } in the body.
async function agentComplete(req, res) {
  const { project_id: projectId } = req.params
  const { conversationId, messageId } = req.body
  if (!conversationId || !messageId) {
    return res.status(400).json({ error: 'conversationId and messageId required' })
  }
  const message = await ChatApiHandler.promises.getThreadMessage(
    projectId,
    conversationId,
    messageId
  )
  if (message) {
    EditorRealTimeController.emitToRoom(projectId, 'new-chat-message', message)
  }
  res.sendStatus(204)
}

async function agentCreateFile(req, res) {
  const { project_id: projectId } = req.params
  const { path, content, userId } = req.body
  if (!path || !userId) {
    return res.status(400).json({ error: 'path and userId required' })
  }
  const lines = content ? content.split('\n') : []
  // upsertDocWithPath expects an absolute path — Path.dirname('main.tex') returns '.'
  // which mkdirp rejects, so we normalise here the same way TPDS does.
  const absPath = path.startsWith('/') ? path : '/' + path
  const { doc } = await EditorController.promises.upsertDocWithPath(
    projectId,
    absPath,
    lines,
    'llm-agent',
    userId
  )
  res.status(201).json({ path, docId: doc._id.toString() })
}

async function agentDeleteFile(req, res) {
  const { project_id: projectId } = req.params
  const { path, userId } = req.body
  if (!path || !userId) {
    return res.status(400).json({ error: 'path and userId required' })
  }
  try {
    await EditorController.promises.deleteEntityWithPath(
      projectId,
      path,
      'llm-agent',
      userId
    )
  } catch (err) {
    if (err.message?.includes('not found') || err.name === 'NotFoundError') {
      return res.status(404).json({ error: 'not found' })
    }
    throw err
  }
  res.sendStatus(204)
}

async function agentMoveFile(req, res) {
  const { project_id: projectId } = req.params
  const { oldPath, newPath, userId } = req.body
  if (!oldPath || !newPath || !userId) {
    return res.status(400).json({ error: 'oldPath, newPath and userId required' })
  }

  const { element, type } = await ProjectLocator.promises.findElementByPath({
    project_id: projectId,
    path: oldPath,
  })
  if (!element) {
    return res.status(404).json({ error: 'not found' })
  }

  const oldName = oldPath.split('/').pop()
  const newName = newPath.split('/').pop()
  const newDir = newPath.includes('/')
    ? newPath.slice(0, newPath.lastIndexOf('/'))
    : ''
  const oldDir = oldPath.includes('/')
    ? oldPath.slice(0, oldPath.lastIndexOf('/'))
    : ''

  if (oldName !== newName) {
    await EditorController.promises.renameEntity(
      projectId,
      element._id.toString(),
      type,
      newName,
      userId,
      'llm-agent'
    )
  }

  if (oldDir !== newDir) {
    // mkdirp ensures target directory exists and returns its id
    const { lastFolder } = await EditorController.promises.mkdirp(
      projectId,
      newDir || '/',
      userId
    )
    await EditorController.promises.moveEntity(
      projectId,
      element._id.toString(),
      lastFolder._id.toString(),
      type,
      userId,
      'llm-agent'
    )
  }

  res.sendStatus(204)
}

async function internalCompile(req, res) {
  const { project_id: projectId } = req.params
  const { userId, rootDoc_id } = req.body
  if (!userId) {
    return res.status(400).json({ error: 'userId required' })
  }
  const compileOptions = { isAutoCompile: false, fileLineErrors: true }
  if (rootDoc_id) compileOptions.rootDoc_id = rootDoc_id
  const result = await CompileManager.promises.compile(
    projectId,
    userId,
    compileOptions
  )
  const { status, validationProblems } = result
  const errors = validationProblems
    ? Object.values(validationProblems).flat().map(String)
    : []
  res.json({ success: status === 'success', status, errors })
}

export default {
  sendMessage: expressify(sendMessage),
  agentComplete: expressify(agentComplete),
  agentCreateFile: expressify(agentCreateFile),
  agentDeleteFile: expressify(agentDeleteFile),
  agentMoveFile: expressify(agentMoveFile),
  internalCompile: expressify(internalCompile),
}
