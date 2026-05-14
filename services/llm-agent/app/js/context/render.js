// @ts-check

import { docUpdaterUrl } from '../tools/utils.js'

/**
 * Resolve a current_file reference to its current bytes by hitting docUpdater
 * /peek. Done fresh on every render() so the model never sees stale content.
 *
 * @param {string} projectId
 * @param {{path: string, docId: string}} ref
 * @returns {Promise<string>}
 */
async function fetchFileContent(projectId, ref) {
  const url = `${docUpdaterUrl()}/project/${projectId}/doc/${ref.docId}/peek`
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) {
    return `<file path="${ref.path}" error="HTTP ${res.status}"/>`
  }
  const { lines } = /** @type {{lines: string[]}} */ (await res.json())
  return Array.isArray(lines) ? lines.join('\n') : ''
}

/**
 * Render a single non-tool ContextItem into one CoreMessage.
 *
 * @param {import('./types.js').ContextItem} item
 * @param {{ projectId: string }} ctx
 */
async function renderSingle(item, ctx) {
  switch (item.kind) {
    case 'system_prompt':
      return { role: 'system', content: String(item.content ?? '') }

    case 'current_file': {
      if (!item.ref) return null
      const content = await fetchFileContent(ctx.projectId, item.ref)
      return {
        role: 'user',
        content: `<file path="${item.ref.path}">\n${content}\n</file>`,
      }
    }

    case 'selection': {
      const c = /** @type {any} */ (item.content)
      const path = c?.path ? ` path="${c.path}"` : ''
      const range =
        c?.fromLine != null && c?.toLine != null
          ? ` lines="${c.fromLine}-${c.toLine}"`
          : ''
      return {
        role: 'user',
        content: `<selection${path}${range}>\n${c?.text ?? c ?? ''}\n</selection>`,
      }
    }

    case 'chat_history_message':
      return {
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: String(item.content ?? ''),
      }

    case 'user_message':
      return { role: 'user', content: String(item.content ?? '') }

    case 'assistant_message':
      return { role: 'assistant', content: String(item.content ?? '') }

    default:
      return null
  }
}

/**
 * @param {import('./types.js').ContextItem} item
 */
function toolCallPart(item) {
  const c = /** @type {any} */ (item.content) ?? {}
  return {
    type: 'tool-call',
    toolCallId: c.toolCallId ?? item.meta?.toolCallId,
    toolName: c.name ?? c.toolName,
    input: c.input ?? c.args ?? {},
  }
}

/**
 * @param {import('./types.js').ContextItem} item
 */
function toolResultPart(item) {
  const value = item.content
  const output =
    typeof value === 'string'
      ? { type: 'text', value }
      : { type: 'json', value: value ?? null }
  return {
    type: 'tool-result',
    toolCallId: item.meta?.toolCallId,
    toolName: item.source?.ref ?? '',
    output,
  }
}

/**
 * Render active ContextItems into the message array consumed by Vercel AI
 * SDK's generateText.
 *
 * Consecutive tool_call items from the same step are merged into ONE
 * assistant message with N tool-call parts; OpenAI/DeepSeek require an
 * assistant message with tool_calls to be IMMEDIATELY followed by tool
 * messages responding to each tool_call_id, so emitting one assistant
 * message per call (with K-1 unmatched calls between the first call and
 * its result) is rejected with "insufficient tool messages following
 * tool_calls message". Consecutive tool_output items are emitted as a
 * single role:'tool' message with N tool-result parts; the OpenAI chat
 * adapter splits that into N OpenAI tool messages internally.
 *
 * @param {Array<import('./types.js').ContextItem>} items
 * @param {{ projectId: string }} ctx
 */
export async function renderContextItems(items, ctx) {
  const out = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'reasoning' || item.kind === 'tool_call') {
      // Merge consecutive reasoning + tool_call items at the same stepIndex
      // into one assistant message: { content: [reasoning..., tool-call...] }.
      // Reasoning parts must precede tool-call parts within the message.
      const stepIdx = item.meta?.stepIndex
      const parts = []
      while (
        i < items.length &&
        (items[i].kind === 'reasoning' || items[i].kind === 'tool_call') &&
        items[i].meta?.stepIndex === stepIdx
      ) {
        if (items[i].kind === 'reasoning') {
          parts.push({ type: 'reasoning', text: String(items[i].content ?? '') })
        } else {
          parts.push(toolCallPart(items[i]))
        }
        i++
      }
      i--
      if (parts.length > 0) out.push({ role: 'assistant', content: parts })
    } else if (item.kind === 'tool_output') {
      const parts = [toolResultPart(item)]
      while (
        i + 1 < items.length &&
        items[i + 1].kind === 'tool_output' &&
        items[i + 1].meta?.stepIndex === item.meta?.stepIndex
      ) {
        i++
        parts.push(toolResultPart(items[i]))
      }
      out.push({ role: 'tool', content: parts })
    } else {
      const msg = await renderSingle(item, ctx)
      if (msg) out.push(msg)
    }
  }
  return out
}
