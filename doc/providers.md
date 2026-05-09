# LLM Providers

The provider layer builds Vercel AI SDK model instances routed through Portkey's unified gateway. `AgentManager.run()` calls `generateText({ model, tools, messages, ... })` directly — there is no hand-written `complete()` wrapper. The `model` object is the only thing that changes when swapping providers.

## `createModel(modelSlug?)`

Located at `services/llm-agent/app/js/providers/vercelPortkey.js`.

```js
import { createModel } from './providers/vercelPortkey.js'
const model = createModel('@gemini/gemini-3.1-pro-preview')
const result = await generateText({ model, tools, messages })
```

Returns a Vercel AI SDK model instance. Routing config (provider, fallbacks, etc.) lives in Portkey; the code here only picks the right SDK adapter.

| Parameter | Required | Notes |
|---|---|---|
| `modelSlug` | no | Defaults to `settings.llm.defaultModel` |

## DeepSeek Adapter

DeepSeek slugs (`@deepseek/...`) use `@ai-sdk/deepseek` instead of `@ai-sdk/openai`:

- **Why:** DeepSeek V4 flash/pro require the `reasoning_content` field to be round-tripped on every follow-up turn. The generic OpenAI adapter silently drops it, causing the API to 400 on the second tool-call turn.
- **How:** `createModel()` detects `slug.toLowerCase().includes('deepseek')` and uses `createDeepSeek({ baseURL, apiKey })`.

All other models use `@ai-sdk/openai` pointed at Portkey's base URL.

## Configuration

Set in environment / `develop/.env`:

| Var | Required | Notes |
|---|---|---|
| `PORTKEY_API_KEY` | yes | Portkey gateway API key |
| `PORTKEY_VIRTUAL_KEY` | no | Routes to a Portkey-configured underlying provider |
| `PORTKEY_CONFIG` | no | Full Portkey config id |
| `PORTKEY_BASE_URL` | no | Self-hosted Portkey gateway URL (default: `https://api.portkey.ai/v1`) |
| `LLM_MODEL` | no | Default model slug when `--model` is omitted |

## Adding a New Provider

1. Create `providers/MyAdapter.js` that returns a Vercel AI SDK model instance (e.g. via `@ai-sdk/anthropic`, `@ai-sdk/google`, etc.).
2. Add detection logic in `createModel()` — check the slug prefix and return the appropriate adapter.
3. The registry, tool loop, and `AgentManager` require no changes.

## Reasoning Models

Reasoning models (DeepSeek-R1 family, some Anthropic/OpenAI variants) expose chain-of-thought on a separate field. `AgentManager.run()` captures `result.reasoning` (if present) in the run step's `output.reasoningText` for debugging. It is not sent to the user or used by callers.
