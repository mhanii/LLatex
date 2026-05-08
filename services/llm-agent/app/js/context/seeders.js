// @ts-check

import settings from '@overleaf/settings'
import { getThreadMessages } from './chatApi.js'

/**
 * @typedef {Omit<import('./types.js').ContextItem, 'id'|'addedAt'>} SeedItem
 */

/**
 * @param {import('../agents/types.js').AgentInfo} agent
 * @returns {SeedItem[]}
 */
export function seedSystemPrompt(agent) {
  return [
    {
      kind: 'system_prompt',
      role: 'system',
      source: { kind: 'agent', ref: agent.name },
      content: agent.systemPrompt,
      addedBy: 'seed:system_prompt',
    },
  ]
}

/**
 * Pulls the conversation thread from the chat service so the model sees
 * prior turns. Empty when no thread / chat service unreachable.
 *
 * @param {import('../types.js').AgentInput} input
 * @returns {Promise<SeedItem[]>}
 */
export async function seedChatHistory(input) {
  if (!input.conversationId) return []
  let msgs
  try {
    msgs = await getThreadMessages(input.projectId, input.conversationId)
  } catch {
    return []
  }
  const agentUserId = settings.llm?.agentUserId ?? 'agent'
  return msgs.map(m => ({
    kind: 'chat_history_message',
    role: m.user_id === agentUserId ? 'assistant' : 'user',
    source: { kind: 'chat', ref: String(m.id) },
    content: m.content,
    addedBy: 'seed:chat_history',
    meta: { user_id: m.user_id, timestamp: m.timestamp },
  }))
}

/**
 * Reference-mode current_file. Picks selection.docId first, then input.currentFile.
 *
 * @param {import('../types.js').AgentInput} input
 * @returns {SeedItem[]}
 */
export function seedCurrentFile(input) {
  const ref = pickFileRef(input)
  if (!ref) return []
  return [
    {
      kind: 'current_file',
      role: 'user',
      source: { kind: 'file', ref: ref.path },
      content: null,
      ref,
      addedBy: 'seed:current_file',
    },
  ]
}

/**
 * @param {import('../types.js').AgentInput} input
 * @returns {{path: string, docId: string} | null}
 */
function pickFileRef(input) {
  const sel = input.selection
  if (sel?.docId) {
    const path =
      input.context?.files?.find(f => f.docId === sel.docId)?.path ??
      input.currentFile?.path ??
      'unknown'
    return { path, docId: sel.docId }
  }
  if (input.currentFile?.docId) {
    return { path: input.currentFile.path, docId: input.currentFile.docId }
  }
  return null
}

/**
 * @param {import('../types.js').AgentInput} input
 * @returns {SeedItem[]}
 */
export function seedSelection(input) {
  const sel = input.selection
  if (!sel?.content) return []
  const path = input.context?.files?.find(f => f.docId === sel.docId)?.path
  return [
    {
      kind: 'selection',
      role: 'user',
      source: { kind: 'selection', ref: sel.docId ?? '' },
      content: {
        text: sel.content,
        path,
        fromLine: sel.fromLine,
        toLine: sel.toLine,
      },
      addedBy: 'seed:selection',
    },
  ]
}

/**
 * @param {import('../types.js').AgentInput} input
 * @returns {SeedItem[]}
 */
export function seedUserMessage(input) {
  if (!input.userMessage) return []
  return [
    {
      kind: 'user_message',
      role: 'user',
      source: { kind: 'user', ref: input.userId },
      content: input.userMessage,
      addedBy: 'seed:user_message',
    },
  ]
}
