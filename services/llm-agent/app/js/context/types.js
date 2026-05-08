// @ts-check

/**
 * Discriminator for ContextItem. Some kinds are singletons — adding a new one
 * marks the prior active item with replacedBy/replacedAt instead of duplicating.
 *
 * @typedef {'system_prompt'|'current_file'|'selection'|
 *          'user_message'|'assistant_message'|
 *          'tool_call'|'tool_output'|
 *          'chat_history_message'} ContextItemKind
 */

/** @type {Set<ContextItemKind>} */
export const SINGLETON_KINDS = new Set([
  'system_prompt',
  'current_file',
  'selection',
])

/**
 * A single, individually-traceable input on the model's context window.
 * Persisted via $push to agentRuns.contextItems[]. Replaced singletons stay in
 * the array with replacedBy/replacedAt set; only items without replacedBy are
 * "active".
 *
 * @typedef {Object} ContextItem
 * @property {string} id              uuid; stable across the run
 * @property {ContextItemKind} kind
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {{kind: string, ref?: string}} source
 * @property {string|object|null} content   inline content; null when ref carries the data
 * @property {{path: string, docId: string}} [ref]  reference-mode payload (current_file)
 * @property {Date} addedAt
 * @property {string} addedBy         seed:<name> | tool:<name> | llm:assistant | user
 * @property {string} [replacedBy]    id of the item that superseded this one
 * @property {Date}   [replacedAt]
 * @property {Object} [meta]          {bytes, toolCallId, ...}
 */

export {}
