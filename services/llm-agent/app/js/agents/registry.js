// @ts-check

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { TOOL_REGISTRY } from '../tools/registry.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * @param {string} name
 * @returns {string}
 */
function loadPrompt(name) {
  return readFileSync(join(__dirname, 'prompts', `${name}.txt`), 'utf8').trim()
}

/**
 * Compose the final system prompt: agent's base personality + a "## Your tools"
 * section listing only the tools this agent is allowed to call. Keeps the
 * prompt honest — agents never see tools they cannot invoke.
 *
 * @param {string} basePrompt
 * @param {string[]} allowedTools
 * @returns {string}
 */
function withAllowedTools(basePrompt, allowedTools) {
  const lines = []
  for (const name of allowedTools) {
    const tool = TOOL_REGISTRY[name]
    if (!tool) continue
    lines.push(`- \`${name}\` — ${tool.usagePrompt}`)
  }
  return `${basePrompt}\n\n## Your tools\n\n${lines.join('\n')}`
}

/**
 * Canonical catalog of all agents. Single source of truth — no caller defines
 * system prompts or tool selections anywhere else.
 *
 * @type {Record<string, import('./types.js').AgentInfo>}
 */
const DEFAULT_ALLOWED_TOOLS = [
  'list_files',
  'read_file',
  'grep',
  'create_file',
  'edit_file',
  'delete_file',
  'move_file',
  'get_outline',
  'check_syntax',
  'compile_and_check',
  'list_skills',
  'read_skill',
  'ask_question',
]

const READONLY_ALLOWED_TOOLS = [
  'list_files',
  'read_file',
  'grep',
  'get_outline',
  'check_syntax',
  'compile_and_check',
  'get_pdf_page',
  'list_skills',
  'read_skill',
  'ask_question',
]

export const AGENT_REGISTRY = {
  default: {
    name: 'default',
    description:
      'Full-access LaTeX editing assistant. Can read, edit, create, delete, and move files; check syntax; compile; view PDF pages.',
    systemPrompt: withAllowedTools(loadPrompt('default'), DEFAULT_ALLOWED_TOOLS),
    allowedTools: DEFAULT_ALLOWED_TOOLS,
    maxSteps: 25,
  },

  readonly: {
    name: 'readonly',
    description:
      'Read-only LaTeX explorer. Cannot mutate files, but can read, outline, syntax-check, compile and inspect PDF pages.',
    systemPrompt: withAllowedTools(
      loadPrompt('readonly'),
      READONLY_ALLOWED_TOOLS
    ),
    allowedTools: READONLY_ALLOWED_TOOLS,
    maxSteps: 10,
  },
}

/**
 * Look up an agent by name.
 * @param {string} name
 * @returns {import('./types.js').AgentInfo | undefined}
 */
export function getAgent(name) {
  return AGENT_REGISTRY[name]
}

/**
 * @returns {import('./types.js').AgentInfo[]}
 */
export function listAgents() {
  return Object.values(AGENT_REGISTRY)
}

/**
 * @returns {import('./types.js').AgentInfo}
 */
export function defaultAgent() {
  const a = AGENT_REGISTRY.default
  if (!a) throw new Error('default agent not registered')
  return a
}
