// @ts-check

import { expressify } from '@overleaf/promise-utils'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import ChatManager from '../../../../app/src/Features/Chat/ChatManager.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import CompileManager from '../../../../app/src/Features/Compile/CompileManager.mjs'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectCreationHandler from '../../../../app/src/Features/Project/ProjectCreationHandler.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import Settings from '@overleaf/settings'
import SyntaxChecker from './SyntaxChecker.mjs'
import LlmAgentApiHandler from './LlmAgentApiHandler.mjs'
import AgentConversationManager from './AgentConversationManager.mjs'
import { parseCompileLogs } from './parsers/LogParser.mjs'

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
    return res.status(403).json({ error: 'not logged in' })
  }

  const conversationId = bodyConversationId ?? new ObjectId().toHexString()
  const conversation = await AgentConversationManager.promises.ensureConversation(
    projectId,
    conversationId,
    userId,
    message
  )

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

  await AgentConversationManager.promises.recordMessage(
    projectId,
    conversationId,
    chatMessage,
    'user'
  )

  EditorRealTimeController.emitToRoom(projectId, 'agent:message', {
    conversationId,
    conversation,
    message: { ...chatMessage, role: 'user' },
  })

  const { runId } = await LlmAgentApiHandler.promises.startRun(projectId, {
    userId,
    conversationId,
    userMessage: message,
    selection: selection ?? undefined,
    context,
  })
  await AgentConversationManager.promises.recordRun(projectId, conversationId, runId)

  res.status(202).json({ runId, messageId: chatMessage.id, conversationId })
}

async function createConversation(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(403).json({ error: 'not logged in' })
  }

  const conversation =
    await AgentConversationManager.promises.createConversation(projectId, userId)
  res.status(201).json(conversation)
}

async function listConversations(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(403).json({ error: 'not logged in' })
  }
  const conversations =
    await AgentConversationManager.promises.listConversations(projectId, userId)
  res.json(conversations)
}

async function getConversationMessages(req, res) {
  const { project_id: projectId, conversation_id: conversationId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(403).json({ error: 'not logged in' })
  }
  const conversation = await AgentConversationManager.promises.getConversation(
    projectId,
    conversationId,
    userId
  )
  if (!conversation) {
    return res.status(404).json({ error: 'agent conversation not found' })
  }

  let thread
  try {
    thread = await ChatApiHandler.promises.getThread(projectId, conversationId)
  } catch (err) {
    if (err?.statusCode === 404 || err?.response?.status === 404) {
      return res.json([])
    }
    throw err
  }

  await ChatManager.promises.injectUserInfoIntoThreads({
    [conversationId]: thread,
  })
  const roles = await AgentConversationManager.promises.getMessageRoles(
    projectId,
    conversationId
  )
  res.json(
    thread.messages.map(message => ({
      ...message,
      role: roles.get(message.id) ?? (message.user_id ? 'user' : 'assistant'),
    }))
  )
}

// Called by llm-agent service after run completes — emits reply over WebSocket.
// Accepts either:
// - { conversationId, messageId } to re-emit an existing chat message
// - { conversationId, userId, content } to create and emit a new chat message
async function agentComplete(req, res) {
  const { project_id: projectId } = req.params
  const { conversationId, messageId, userId, content, runId } = req.body
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
    await AgentConversationManager.promises.recordMessage(
      projectId,
      conversationId,
      message,
      'assistant',
      runId
    )
    const updatedConversation =
      await AgentConversationManager.promises.getConversation(
        projectId,
        conversationId
      )
    EditorRealTimeController.emitToRoom(projectId, 'agent:message', {
      conversationId,
      conversation: updatedConversation,
      message: { ...message, role: 'assistant' },
    })
  }
  res.sendStatus(204)
}

async function agentToolCall(req, res) {
  const { project_id: projectId } = req.params
  const {
    conversationId,
    runId,
    toolCallId,
    toolName,
    status,
    input,
    output,
    error,
  } = req.body
  if (!conversationId || !runId || !toolName || !status) {
    return res
      .status(400)
      .json({ error: 'conversationId, runId, toolName and status required' })
  }

  EditorRealTimeController.emitToRoom(projectId, 'agent:tool-call', {
    conversationId,
    runId,
    toolCallId,
    toolName,
    status,
    input,
    output,
    error,
    timestamp: Date.now(),
  })
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

/**
 * Base URL for fetching CLSI output files (output.log, *.blg, etc.) — the
 * same target web's _proxyToClsiWithLimits hits for non-zip output.
 *
 * Defensive fallback: develop/dev.env sets DOWNLOAD_HOST to a full URL
 * because services/clsi/config/settings.defaults.cjs treats it that way.
 * services/web's settings template (settings.defaults.js:248) instead
 * expects a hostname and re-wraps it as `http://${DOWNLOAD_HOST}:8080`,
 * producing `http://http://clsi-nginx:8080:8080` in dev. The frontend never
 * notices because webpack proxies /build/* to clsi-nginx directly. We need
 * a real URL on the backend, so detect the malformed case and fall back to
 * the raw env value.
 */
function clsiOutputBaseUrl() {
  const v = Settings.apis.clsi.downloadHost
  try {
    const parsed = new URL(v)
    // node's URL is permissive: 'http://http://clsi-nginx:8080:8080' parses
    // as host='http', pathname='//clsi-nginx:8080:8080'. Reject the case
    // where the host itself looks like a scheme.
    if (/^https?$/i.test(parsed.host)) throw new Error('malformed')
    return v
  } catch {
    return process.env.DOWNLOAD_HOST || v
  }
}

async function internalCompile(req, res) {
  const { project_id: projectId } = req.params
  const { userId, rootDoc_id, stopOnFirstError } = req.body
  if (!userId) {
    return res.status(400).json({ error: 'userId required' })
  }
  const compileOptions = { isAutoCompile: false, fileLineErrors: true }
  if (rootDoc_id) compileOptions.rootDoc_id = rootDoc_id
  if (stopOnFirstError) compileOptions.stopOnFirstError = true
  const result = await CompileManager.promises.compile(
    projectId,
    userId,
    compileOptions
  )
  const { status, outputFiles = [] } = result

  // Parse logs the same way the editor does — same parsers, same byte stream
  // (output.log + every *.blg) — so the LLM sees what the user sees.
  const { errors, warnings, typesetting } = await parseCompileLogs(
    outputFiles,
    clsiOutputBaseUrl(),
    { stoppedOnFirstError: status === 'stopped-on-first-error' }
  )

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

  res.json({
    success: status === 'success',
    status,
    errors,
    warnings,
    typesetting,
    pageCount,
  })
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
  let clsiRes
  try {
    clsiRes = await fetch(
      `${clsiUrl(projectId, userId, 'pdf-page')}?page=${page}`
    )
  } catch {
    return res.status(502).json({ error: 'CLSI unreachable' })
  }
  if (clsiRes.status === 404 || clsiRes.status === 416) {
    const body = await clsiRes
      .json()
      .catch(() => ({ error: clsiRes.statusText || 'CLSI error' }))
    return res.status(clsiRes.status).json(body)
  }
  if (!clsiRes.ok) {
    return res.status(502).json({ error: 'CLSI error' })
  }
  let buf
  try {
    buf = Buffer.from(await clsiRes.arrayBuffer())
  } catch {
    return res.status(502).json({ error: 'CLSI error' })
  }
  res.json({ imageBase64: buf.toString('base64'), mimeType: 'image/png' })
}

async function agentCreateProject(req, res) {
  const { userId, projectName, docLines } = req.body
  if (!userId || !projectName) {
    return res.status(400).json({ error: 'userId and projectName required' })
  }
  if (docLines != null && !Array.isArray(docLines)) {
    return res.status(400).json({ error: 'docLines must be an array of strings' })
  }
  const lines = docLines ?? ['\\documentclass{article}', '\\begin{document}', '\\end{document}']
  const project = await ProjectCreationHandler.promises.createProjectFromSnippet(
    userId,
    projectName,
    lines
  )
  res.json({ projectId: project._id.toString() })
}

async function agentSyntaxCheck(req, res) {
  const { project_id: projectId } = req.params
  const scopePath = req.query.path ?? null
  const result = await SyntaxChecker.check(projectId, scopePath)
  res.json(result)
}

export default {
  createConversation: expressify(createConversation),
  listConversations: expressify(listConversations),
  getConversationMessages: expressify(getConversationMessages),
  sendMessage: expressify(sendMessage),
  agentComplete: expressify(agentComplete),
  agentToolCall: expressify(agentToolCall),
  agentCreateFile: expressify(agentCreateFile),
  agentDeleteFile: expressify(agentDeleteFile),
  agentMoveFile: expressify(agentMoveFile),
  internalCompile: expressify(internalCompile),
  agentPdfPage: expressify(agentPdfPage),
  agentSyntaxCheck: expressify(agentSyntaxCheck),
  agentCreateProject: expressify(agentCreateProject),
}
