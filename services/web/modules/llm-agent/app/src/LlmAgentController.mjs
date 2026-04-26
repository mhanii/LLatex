// @ts-check

import { expressify } from '@overleaf/promise-utils'
import { ObjectId } from 'mongodb'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
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

export default {
  sendMessage: expressify(sendMessage),
}
