// @ts-check

import { Portkey } from 'portkey-ai'
import { LlmProvider } from './LlmProvider.js'

/**
 * Wraps Portkey's unified gateway (OpenAI-compatible chat completions).
 * Model selection and underlying provider routing live in Portkey config —
 * the request shape from this module is the same regardless of which model
 * Portkey forwards to.
 */
export class PortkeyProvider extends LlmProvider {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey
   * @param {string} [opts.virtualKey]
   * @param {string} [opts.config]
   * @param {string} [opts.baseURL]
   */
  constructor({ apiKey, virtualKey, config, baseURL }) {
    super()
    if (!apiKey) {
      throw new Error('PortkeyProvider requires apiKey (PORTKEY_API_KEY)')
    }
    this.client = new Portkey({
      apiKey,
      virtualKey: virtualKey || undefined,
      config: config || undefined,
      baseURL: baseURL || undefined,
    })
  }

  /**
   * @param {import('./LlmProvider.js').CompletionRequest} request
   * @returns {Promise<import('./LlmProvider.js').CompletionResult>}
   */
  async complete(request) {
    const messages = []
    if (request.system) messages.push({ role: 'system', content: request.system })
    for (const m of request.messages) {
      const msg = { role: m.role, content: m.content }
      if (m.name) msg.name = m.name
      if (m.toolCallId) msg.tool_call_id = m.toolCallId
      messages.push(msg)
    }

    const body = {
      model: request.model,
      messages,
    }
    if (request.temperature != null) body.temperature = request.temperature
    if (request.maxTokens != null) body.max_tokens = request.maxTokens
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    }

    const startedAt = Date.now()
    const completion = await this.client.chat.completions.create(body)
    const latencyMs = Date.now() - startedAt

    const choice = completion.choices?.[0]
    const message = choice?.message ?? {}
    const text = typeof message.content === 'string' ? message.content : ''

    // Reasoning models (DeepSeek-R1 family, some Anthropic/OpenAI variants)
    // expose their chain-of-thought on a separate field. Field name varies
    // by provider — capture whichever is present, for debugging only.
    const reasoningText =
      typeof message.reasoning_content === 'string'
        ? message.reasoning_content
        : typeof message.reasoning === 'string'
          ? message.reasoning
          : undefined

    let toolCalls
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: safeJsonParse(tc.function?.arguments),
      }))
    }

    return {
      text,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      model: completion.model ?? request.model,
      latencyMs,
      toolCalls,
      finishReason: choice?.finish_reason,
      reasoningText,
      rawResponse: completion,
    }
  }
}

function safeJsonParse(s) {
  if (typeof s !== 'string') return s ?? {}
  try {
    return JSON.parse(s)
  } catch {
    return { _raw: s }
  }
}
