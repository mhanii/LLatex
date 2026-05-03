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
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import Settings from '@overleaf/settings'
import SyntaxChecker from './SyntaxChecker.mjs'
import LlmAgentApiHandler from './LlmAgentApiHandler.mjs'
import { parseLatexLog } from './LatexLogParser.mjs'

function normalizeProjectPath(path) {
  return path.startsWith('/') ? path.slice(1) : path
}

function buildProjectContext(project) {
  const { docs } = ProjectEntityHandler.getAllEntitiesFromProject(project)
  const files = docs
    .map(({ path, doc }) => ({
      path: normalizeProjectPath(path),
      docId: doc._id.toString(),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  return {
    projectName: project.name ?? '',
    compiler: project.compiler ?? 'pdflatex',
    files,
  }
}

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

  const project = await ProjectGetter.promises.getProject(projectId, {
    name: 1,
    compiler: 1,
    rootFolder: 1,
  })
  if (!project) {
    return res.status(404).json({ error: 'project not found' })
  }
  const context = buildProjectContext(project)

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
    context,
  })

  res.status(202).json({ runId, messageId: chatMessage.id, conversationId })
}

// Called by llm-agent service after run completes — emits reply over WebSocket.
// Accepts either:
// - { conversationId, messageId } to re-emit an existing chat message
// - { conversationId, userId, content } to create and emit a new chat message
async function agentComplete(req, res) {
  const { project_id: projectId } = req.params
  const { conversationId, messageId, userId, content } = req.body
  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId required' })
  }

  let message
  if (messageId) {
    message = await ChatApiHandler.promises.getThreadMessage(
      projectId,
      conversationId,
      messageId
    )
  } else if (userId && typeof content === 'string' && content.trim() !== '') {
    message = await ChatApiHandler.promises.sendComment(
      projectId,
      conversationId,
      userId,
      content
    )
    const user = await UserInfoManager.promises.getPersonalInfo(message.user_id)
    message.user = UserInfoController.formatPersonalInfo(user)
  } else {
    return res
      .status(400)
      .json({ error: 'messageId or (userId and content) required' })
  }

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

  const { element, type, folder } =
    await ProjectLocator.promises.findElementByPath({
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

  const entityId = element._id.toString()
  const oldFolderId = folder?._id?.toString()

  // Resolve destination folder before any mutation to reduce partial-state risk.
  let destinationFolderId
  if (oldDir !== newDir) {
    const { lastFolder } = await EditorController.promises.mkdirp(
      projectId,
      newDir || '/',
      userId
    )
    destinationFolderId = lastFolder._id.toString()
  }

  let moved = false
  try {
    if (destinationFolderId && oldFolderId && oldFolderId !== destinationFolderId) {
      await EditorController.promises.moveEntity(
        projectId,
        entityId,
        destinationFolderId,
        type,
        userId,
        'llm-agent'
      )
      moved = true
    }

    if (oldName !== newName) {
      await EditorController.promises.renameEntity(
        projectId,
        entityId,
        type,
        newName,
        userId,
        'llm-agent'
      )
    }
  } catch (err) {
    if (moved && oldFolderId && destinationFolderId && oldFolderId !== destinationFolderId) {
      try {
        await EditorController.promises.moveEntity(
          projectId,
          entityId,
          oldFolderId,
          type,
          userId,
          'llm-agent-rollback'
        )
      } catch {
        // If rollback fails we still propagate the original error.
      }
    }
    throw err
  }

  res.sendStatus(204)
}

function clsiUrl(projectId, userId, action) {
  const clsiUserId = Settings.disablePerUserCompiles ? undefined : userId
  const base = Settings.apis.clsi.url
  const prefix = clsiUserId
    ? `/project/${projectId}/user/${clsiUserId}`
    : `/project/${projectId}`
  return `${base}${prefix}/${action}`
}

async function fetchCompileErrors(projectId, userId) {
  try {
    const logRes = await fetch(clsiUrl(projectId, userId, 'output-log'))
    if (!logRes.ok) return []
    return parseLatexLog(await logRes.text())
  } catch {
    return []
  }
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
  const { status } = result

  const errors =
    status !== 'success' ? await fetchCompileErrors(projectId, userId) : []

  let pageCount = null
  if (status === 'success') {
    try {
      const infoRes = await fetch(clsiUrl(projectId, userId, 'pdf-info'))
      if (infoRes.ok) {
        const info = await infoRes.json()
        pageCount = info.pageCount ?? null
      }
    } catch {
      // non-fatal — pageCount stays null
    }
  }

  res.json({ success: status === 'success', status, errors, pageCount })
}

async function agentPdfPage(req, res) {
  const { project_id: projectId } = req.params
  const { userId, page: pageStr } = req.query
  const page = parseInt(pageStr, 10)
  if (!userId || !page || page < 1) {
    return res
      .status(400)
      .json({ error: 'userId and page (1-indexed) query params required' })
  }
  const clsiRes = await fetch(
    `${clsiUrl(projectId, userId, 'pdf-page')}?page=${page}`
  )
  if (clsiRes.status === 404) {
    return res.status(404).json({ error: clsiRes.statusText })
  }
  if (!clsiRes.ok) {
    return res.status(502).json({ error: 'CLSI error' })
  }
  const buf = Buffer.from(await clsiRes.arrayBuffer())
  if (buf.length === 0) {
    return res.status(404).json({ error: 'page out of range' })
  }
  res.json({ imageBase64: buf.toString('base64'), mimeType: 'image/png' })
}

async function agentSyntaxCheck(req, res) {
  const { project_id: projectId } = req.params
  const scopePath = req.query.path ?? null
  const result = await SyntaxChecker.check(projectId, scopePath)
  res.json(result)
}

export default {
  sendMessage: expressify(sendMessage),
  agentComplete: expressify(agentComplete),
  agentCreateFile: expressify(agentCreateFile),
  agentDeleteFile: expressify(agentDeleteFile),
  agentMoveFile: expressify(agentMoveFile),
  internalCompile: expressify(internalCompile),
  agentPdfPage: expressify(agentPdfPage),
  agentSyntaxCheck: expressify(agentSyntaxCheck),
}
