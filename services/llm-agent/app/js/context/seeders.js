// @ts-check

import { getThreadMessages } from './chatApi.js'
import { getStepsForRun as defaultGetStepsForRun } from '../AgentStore.js'

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
 * Build the prior-turn context for a new run. Treats multi-turn as one
 * extended conversation: for every prior assistant turn we replay its full
 * trace (reasoning + tool calls + tool outputs + final text) so the model
 * sees what it saw at the end of the previous turn, plus the new user
 * message that arrived since.
 *
 * Prefers `input.chatHistory` (built by the web module with role + runId
 * lookups) — the chat service alone cannot distinguish assistant messages
 * from user messages since both are stored under the human user_id. The
 * legacy chat-fetch fallback is best-effort (treats every message as 'user')
 * and is only used when chatHistory was not provided.
 *
 * @param {import('../types.js').AgentInput} input
 * @returns {Promise<SeedItem[]>}
 */
export async function seedChatHistory(input, deps = {}) {
  const getStepsForRun = deps.getStepsForRun ?? defaultGetStepsForRun
  if (Array.isArray(input.chatHistory)) {
    return await buildHistoryFromInput(input.chatHistory, getStepsForRun)
  }
  if (!input.conversationId) return []
  let msgs
  try {
    msgs = await getThreadMessages(input.projectId, input.conversationId)
  } catch {
    return []
  }
  // Fallback: no role info available. Best-effort treat all as user.
  return msgs.map(m => ({
    kind: 'chat_history_message',
    role: 'user',
    source: { kind: 'chat', ref: String(m.id) },
    content: m.content,
    addedBy: 'seed:chat_history',
    meta: { user_id: m.user_id, timestamp: m.timestamp },
  }))
}

/**
 * For each historical chat message, emit:
 *   - user msg → one chat_history_message item (role=user)
 *   - assistant msg with runId → for each persisted step in that run, emit
 *     reasoning items + tool_call items + tool_output items (paired to
 *     trigger render-side merging), then a chat_history_message item
 *     (role=assistant) carrying the step's final text.
 *
 * Each historical step gets a unique opaque stepIndex (string `${runId}:${k}`)
 * so render.js groups its reasoning/tool_call items together but does not
 * accidentally merge them with adjacent steps from a different run.
 *
 * @param {Array<{id: string, user_id: string, content: string, timestamp: number, role: 'user'|'assistant', runId: string|null}>} chatHistory
 * @returns {Promise<SeedItem[]>}
 */
async function buildHistoryFromInput(chatHistory, getStepsForRun) {
  const items = []
  for (const m of chatHistory) {
    if (m.role !== 'assistant') {
      items.push({
        kind: 'chat_history_message',
        role: 'user',
        source: { kind: 'chat', ref: String(m.id) },
        content: m.content,
        addedBy: 'seed:chat_history',
        meta: { user_id: m.user_id, timestamp: m.timestamp },
      })
      continue
    }
    if (m.runId) {
      const steps = await getStepsForRun(m.runId)
      for (let k = 0; k < steps.length; k++) {
        const step = steps[k]
        const stepIndex = `${m.runId}:${k}`
        const reasoning = step.output?.reasoning ?? []
        const toolCalls = step.output?.toolCalls ?? []
        const toolResults = step.output?.toolResults ?? []

        for (const r of reasoning) {
          if (!r.text) continue
          items.push({
            kind: 'reasoning',
            role: 'assistant',
            source: { kind: 'chat', ref: String(m.id) },
            content: r.text,
            addedBy: 'seed:chat_history',
            meta: { stepIndex, fromRunId: m.runId },
          })
        }
        for (const tc of toolCalls) {
          items.push({
            kind: 'tool_call',
            role: 'assistant',
            source: { kind: 'tool', ref: tc.toolName },
            content: {
              toolCallId: tc.toolCallId,
              name: tc.toolName,
              args: tc.input ?? tc.args ?? {},
            },
            addedBy: 'seed:chat_history',
            meta: { toolCallId: tc.toolCallId, stepIndex, fromRunId: m.runId },
          })
        }
        const resultIds = new Set(toolResults.map(tr => tr.toolCallId))
        for (const tr of toolResults) {
          items.push({
            kind: 'tool_output',
            role: 'tool',
            source: { kind: 'tool', ref: tr.toolName },
            content: tr.output ?? tr.result ?? null,
            addedBy: 'seed:chat_history',
            meta: { toolCallId: tr.toolCallId, stepIndex, fromRunId: m.runId },
          })
        }
        // Synthesize a placeholder for unpaired tool_calls so render emits
        // the matching tool messages OpenAI-compat providers require.
        for (const tc of toolCalls) {
          if (resultIds.has(tc.toolCallId)) continue
          items.push({
            kind: 'tool_output',
            role: 'tool',
            source: { kind: 'tool', ref: tc.toolName },
            content: `Tool ${tc.toolName} did not return a result.`,
            addedBy: 'seed:chat_history',
            meta: {
              toolCallId: tc.toolCallId,
              stepIndex,
              fromRunId: m.runId,
              synthesized: true,
            },
          })
        }
      }
    }
    items.push({
      kind: 'chat_history_message',
      role: 'assistant',
      source: { kind: 'chat', ref: String(m.id) },
      content: m.content,
      addedBy: 'seed:chat_history',
      meta: {
        user_id: m.user_id,
        timestamp: m.timestamp,
        ...(m.runId ? { runId: m.runId } : {}),
      },
    })
  }
  return items
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
