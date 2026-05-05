// @ts-check

/**
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {string} content
 * @property {string} [name]
 * @property {string} [toolCallId]
 *
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} description
 * @property {Record<string, unknown>} parameters  - JSON Schema
 *
 * @typedef {Object} ToolCall
 * @property {string} id
 * @property {string} name
 * @property {Record<string, unknown>} arguments
 *
 * @typedef {Object} CompletionRequest
 * @property {string} [system]
 * @property {Array<ChatMessage>} messages
 * @property {string} model
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {Array<ToolDef>} [tools]
 *
 * @typedef {Object} CompletionResult
 * @property {string} text
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {string} model
 * @property {number} latencyMs
 * @property {Array<ToolCall>} [toolCalls]
 * @property {string} [finishReason]
 * @property {string} [reasoningText]   - hidden chain-of-thought from reasoning models (DeepSeek-R1, etc.) — captured for debugging, not used by callers
 * @property {unknown} [rawResponse]
 */

export class LlmProvider {
  /**
   * @param {CompletionRequest} _request
   * @returns {Promise<CompletionResult>}
   */
  async complete(_request) {
    throw new Error('LlmProvider.complete() must be implemented by subclass')
  }
}
