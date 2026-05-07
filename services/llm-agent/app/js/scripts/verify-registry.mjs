#!/usr/bin/env node
/**
 * End-to-end verification for the tool + agent registries.
 *
 * Runs in two phases:
 *  1) Local sanity checks — registry shapes, agent allowedTool subsets, buildTools selection.
 *     No network calls. Always runs.
 *  2) Live LLM round-trip — picks the default agent, builds its tools against a fake
 *     RunContext containing two files, and asks the model to "list files." The list_files
 *     tool is the only one we exercise here because it is the only tool that does not
 *     hit document-updater / web / CLSI (it reads ctx.context.files directly), so this
 *     script can run outside Docker. Skipped if PORTKEY_API_KEY is not set.
 *
 * Usage (from services/llm-agent/, with develop/.env populated):
 *   node app/js/scripts/verify-registry.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'

import { TOOL_REGISTRY, listTools } from '../tools/registry.js'
import { buildTools } from '../tools/index.js'
import {
  AGENT_REGISTRY,
  defaultAgent,
  listAgents,
} from '../agents/registry.js'

// ──────────────────────────────────────────────────────────────────────────────
// Tiny test helpers (no chai dependency — keep this script standalone)
// ──────────────────────────────────────────────────────────────────────────────
let pass = 0
let fail = 0

function check(label, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function header(s) {
  console.log(`\n${s}`)
  console.log('─'.repeat(s.length))
}

// ──────────────────────────────────────────────────────────────────────────────
// .env loader (matches the simple parser used in the earlier smoke test)
// ──────────────────────────────────────────────────────────────────────────────
const envPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../develop/.env'
)
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch {
  /* .env is optional for the local-only phase */
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase 1 — local sanity checks
// ──────────────────────────────────────────────────────────────────────────────
header('Phase 1: Local registry checks')

check('TOOL_REGISTRY has 10 tools', listTools().length === 10, `got ${listTools().length}`)

const expectedAgents = ['default', 'readonly']
check(
  `AGENT_REGISTRY has ${expectedAgents.length} agents`,
  Object.keys(AGENT_REGISTRY).sort().join(',') === expectedAgents.sort().join(','),
  Object.keys(AGENT_REGISTRY).join(',')
)

for (const agent of listAgents()) {
  const unknown = agent.allowedTools.filter(t => !TOOL_REGISTRY[t])
  check(
    `agent[${agent.name}] only references known tools`,
    unknown.length === 0,
    unknown.join(',')
  )
  check(
    `agent[${agent.name}] has a non-empty system prompt`,
    typeof agent.systemPrompt === 'string' && agent.systemPrompt.length > 0
  )
}

const fakeCtx = {
  projectId: 'verify-script',
  userId: 'verify-script',
  runId: 'verify-script',
  context: {
    projectName: 'Verification project',
    compiler: 'pdflatex',
    files: [
      { path: 'main.tex', docId: 'd1' },
      { path: 'references.bib', docId: 'd2' },
    ],
  },
}

const allBuilt = buildTools(fakeCtx)
check(
  'buildTools(ctx) returns all 10 tools',
  Object.keys(allBuilt).length === 10
)

const defaultBuilt = buildTools(fakeCtx, defaultAgent().allowedTools)
check(
  `buildTools(ctx, defaultAgent.allowedTools) matches the agent's set`,
  Object.keys(defaultBuilt).sort().join(',') ===
    [...defaultAgent().allowedTools].sort().join(',')
)

const readonlyBuilt = buildTools(fakeCtx, AGENT_REGISTRY.readonly.allowedTools)
const mutationLeak = ['create_file', 'edit_file', 'delete_file', 'move_file'].filter(
  t => t in readonlyBuilt
)
check('readonly agent has no mutation tools after buildTools', mutationLeak.length === 0)

// Verify that ctx is curried by actually executing list_files through the wrapped tool.
const listed = await defaultBuilt.list_files.execute({}, {})
check(
  'wrapped list_files reads ctx.context.files',
  Array.isArray(listed) &&
    listed.length === 2 &&
    listed[0].path === 'main.tex' &&
    listed[1].path === 'references.bib'
)

// ──────────────────────────────────────────────────────────────────────────────
// Phase 2 — live LLM round-trip via Vercel AI SDK + Portkey
// ──────────────────────────────────────────────────────────────────────────────
header('Phase 2: Live Vercel + Portkey round-trip')

if (!process.env.PORTKEY_API_KEY) {
  console.log('  • PORTKEY_API_KEY not set; skipping live round-trip')
} else {
  const baseURL = process.env.PORTKEY_BASE_URL || 'https://api.portkey.ai/v1'
  const model = process.env.LLM_MODEL || '@deepseek/deepseek-v4-flash'
  console.log(`  • Using model ${model} via ${baseURL}`)

  const openai = createOpenAI({ baseURL, apiKey: process.env.PORTKEY_API_KEY })

  // Use the default agent's prompt + a single tool (list_files) so the script
  // does not depend on document-updater / web / CLSI being up.
  const agent = defaultAgent()
  const tools = buildTools(fakeCtx, ['list_files'])

  try {
    const result = await generateText({
      model: openai.chat(model),
      maxSteps: 3,
      system: agent.systemPrompt,
      messages: [
        {
          role: 'user',
          content: 'List the files in this project. Use the list_files tool.',
        },
      ],
      tools,
    })

    const calledListFiles =
      Array.isArray(result.toolCalls) &&
      result.toolCalls.some(c => c.toolName === 'list_files')
    check('model invoked list_files via the registry-built tool map', calledListFiles)

    // Inspect the actual tool output — this proves ctx was curried correctly
    // through the registry → buildTools → Vercel `tool()` chain. The model's
    // final text is intentionally not asserted because some models reply tersely.
    const listResult = result.toolResults?.find(r => r.toolName === 'list_files')
    const out = listResult?.output ?? listResult?.result
    const expected = [{ path: 'main.tex' }, { path: 'references.bib' }]
    const matches =
      Array.isArray(out) &&
      out.length === 2 &&
      JSON.stringify(out) === JSON.stringify(expected)
    check(
      'list_files tool returned the ctx.context.files contents end-to-end',
      matches,
      JSON.stringify(out)
    )

    console.log(`  • input tokens:  ${result.usage?.inputTokens ?? '?'}`)
    console.log(`  • output tokens: ${result.usage?.outputTokens ?? '?'}`)
    console.log(`  • final text:    ${(result.text || '').slice(0, 100).replace(/\s+/g, ' ')}`)
  } catch (err) {
    // Upstream model unavailability (provider 5xx, rate limits) should not
    // mark the registry as broken — the registry's job is to wire the request
    // correctly, which already succeeded if Portkey received it.
    const portkeyTrace = err?.lastError?.responseHeaders?.['x-portkey-trace-id']
    const status = err?.lastError?.statusCode
    if (status >= 500 || status === 429) {
      console.log(
        `  • SKIPPED: upstream model returned HTTP ${status}` +
          (portkeyTrace ? ` (Portkey trace ${portkeyTrace})` : '')
      )
      console.log(
        '    The registry wired the request correctly — Portkey saw it. Retry with a different LLM_MODEL.'
      )
    } else {
      throw err
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
header('Summary')
console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
