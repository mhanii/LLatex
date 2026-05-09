# Agents

This service supports multiple agents — each agent is a configuration of (system prompt, allowed tools, optional model and decoding parameters). Agents are pure data, defined in a single registry. Adding a new agent is a config change, not a code change.

This directly supports the research goals in [overview.md](./overview.md): swap models, swap prompts, swap tool sets independently.

## Where things live

```
services/llm-agent/app/js/
├── agents/
│   ├── types.js          — AgentInfo JSDoc typedef
│   ├── registry.js       — AGENT_REGISTRY + getAgent / listAgents / defaultAgent
│   └── prompts/
│       ├── default.txt   — system prompt for the default agent
│       └── readonly.txt  — system prompt for the read-only agent
└── tools/
    ├── registry.js       — TOOL_REGISTRY (single source of truth for tool defs)
    └── index.js          — buildTools(ctx, toolNames?) — Vercel `tool()` wrapping
```

## AgentInfo

```js
/**
 * @typedef {Object} AgentInfo
 * @property {string}   name            unique identifier, e.g. 'default'
 * @property {string}   description     human-readable, shown in pickers
 * @property {string}   systemPrompt    prepended as the system message
 * @property {string[]} allowedTools    subset of names from TOOL_REGISTRY
 * @property {string=}  model           optional model slug; falls back to Settings.llm.defaultModel
 * @property {number=}  temperature
 * @property {number=}  maxSteps        tool-call iterations cap
 */
```

There is no `Agent.run()` method. Agents are pure data consumed by `AgentManager.run()` in `services/llm-agent/app/js/AgentManager.js`:

1. Resolve agent via `getAgent(opts.agentName) ?? defaultAgent()`.
2. Seed context items (`systemPrompt`, chat history, current file, selection, user message) via `ContextManager`.
3. Build tools via `buildTools(runCtx, agent.allowedTools)`.
4. Create model via `createModel(agent.model)`.
5. Run Vercel AI SDK `generateText()` loop up to `agent.maxSteps` iterations.

This keeps agents as data so future runtimes (ReAct, Self-Refine, HITL) can consume the same registry without code changes.

## Built-in agents

| Name | Tools | maxSteps | Use case |
|---|---|---|---|
| `default` | all 10 | 20 | Full-access LaTeX editing assistant. Read, write, compile, inspect. |
| `readonly` | 6 (no `create_file`, `edit_file`, `delete_file`, `move_file`) | 10 | Exploration / Q&A — locate sections, summarize structure, find issues, inspect compiled output. |

## API

```js
import {
  AGENT_REGISTRY,
  getAgent,
  listAgents,
  defaultAgent,
} from './agents/registry.js'

defaultAgent()           // → AGENT_REGISTRY.default
getAgent('readonly')     // → AGENT_REGISTRY.readonly
getAgent('does-not-exist') // → undefined
listAgents()             // → [AgentInfo, AgentInfo]
```

## Adding a new agent

1. Add a system prompt at `services/llm-agent/app/js/agents/prompts/<name>.txt`.
2. Add an entry to `AGENT_REGISTRY` in `agents/registry.js`:

   ```js
   reactish: {
     name: 'reactish',
     description: 'Encourages explicit reasoning before each tool call.',
     systemPrompt: loadPrompt('reactish'),
     allowedTools: ['list_files', 'read_file', 'check_syntax', 'compile_and_check'],
     temperature: 0.2,
     maxSteps: 15,
   },
   ```

3. (Optional) Add a unit test entry in `test/unit/agents/registry_test.js` covering:
   - the agent appears in `AGENT_REGISTRY`
   - every name in `allowedTools` exists in `TOOL_REGISTRY`
   - any expected tool exclusions are honored

That is the entire change. No runtime code edits, no wiring, no provider work.

## Constraint: registry is the only source of truth

Per project convention (see `feedback_registry_pattern.md` in agent memory):

- System prompts live in `agents/prompts/*.txt` and are referenced from `agents/registry.js`. Never duplicate a prompt in a runtime file.
- Tool definitions (description, Zod schema, raw execute fn) live only in `tools/registry.js`. The Vercel `tool()` wrapping in `tools/index.js` is the single consumer that knows about Vercel — keep it that way so the registry stays portable to other frameworks.
- A runtime that needs ctx-bound tools for an agent should call `buildTools(ctx, agent.allowedTools)`. It must not reach into `TOOL_REGISTRY` directly to rewrap.

## Verification

Two layers:

**Unit tests** (mocha, no network):

```bash
cd services/llm-agent
npm run test:unit
# the relevant suites are tools/registry, tools/index buildTools, agents/registry
```

**End-to-end script** (Vercel AI SDK + Portkey, requires `PORTKEY_API_KEY` in `develop/.env`):

```bash
node services/llm-agent/app/js/scripts/verify-registry.mjs
```

The script does two phases:

1. Local checks — registry shapes, agent allowedTool subsets, `buildTools` selection, ctx currying.
2. Live Portkey round-trip — picks the default agent's prompt and a single `list_files` tool, asks the model to list files, and asserts the model both invoked `list_files` and the tool returned the expected `ctx.context.files`. Skips gracefully if `PORTKEY_API_KEY` is unset, and reports "skipped" with the Portkey trace id if the upstream model is rate-limited or down (the registry's job is to wire the request correctly — that part already succeeded).

Override the model via env:

```bash
LLM_MODEL=@deepseek/deepseek-v4-flash node services/llm-agent/app/js/scripts/verify-registry.mjs
```
