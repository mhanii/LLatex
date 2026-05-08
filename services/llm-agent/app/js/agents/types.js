// @ts-check

/**
 * Agent metadata. Agents are pure data — the runtime that consumes them
 * (e.g. AgentManager once wired) interprets these fields. No `run` method
 * is defined here so that experimenting with new agents is a pure config
 * change: add an entry to the registry, ship a system prompt, and choose
 * which tool names from TOOL_REGISTRY are allowed.
 *
 * @typedef {Object} AgentInfo
 * @property {string} name             - unique identifier, e.g. 'default'
 * @property {string} description      - human-readable, shown in pickers
 * @property {string} systemPrompt     - prepended as the system message
 * @property {string[]} allowedTools   - subset of names from TOOL_REGISTRY
 * @property {string} [model]          - optional model slug; falls back to Settings.llm.defaultModel
 * @property {number} [temperature]
 * @property {number} [maxSteps]       - tool-call iterations cap
 */

export {}
