# LLM Providers

Hide the LLM provider behind one module. All pipeline steps call this; none import a provider SDK directly. Swapping providers means changing this one file.

## LlmProvider (Abstract Base)

Located at `services/llm-agent/app/js/providers/LlmProvider.js`.

```js
class LlmProvider {
  async complete({ system, messages, model, temperature, maxTokens, tools })
    → { text, inputTokens, outputTokens, model, latencyMs, toolCalls, finishReason, reasoningText, rawResponse }
}
```

All methods throw if called directly — must be subclassed.

## PortkeyProvider

Located at `services/llm-agent/app/js/providers/PortkeyProvider.js`.

Wraps Portkey's unified gateway (OpenAI-compatible chat completions). Model selection and underlying provider routing live in Portkey config — the request shape from this module is the same regardless of which model Portkey forwards to.

```js
new PortkeyProvider({ apiKey, virtualKey, config, baseURL })
```

| Parameter | Required | Notes |
|---|---|---|
| `apiKey` | yes | Portkey gateway API key (`PORTKEY_API_KEY`) |
| `virtualKey` | one of | Routes to a Portkey-configured underlying provider |
| `config` | one of | Alternative: full Portkey config id |
| `baseURL` | no | Self-hosted Portkey gateway URL |

With Portkey you typically don't need a virtual key — just pass the `@provider/model` id (e.g. `@gemini/gemini-3.1-pro-preview`) and Portkey routes it.

## Provider Factory

`providerFromEnv()` in `services/llm-agent/app/js/providers/index.js` builds the provider configured for the current environment.

```js
import { providerFromEnv } from './providers/index.js'
const provider = providerFromEnv()
const result = await provider.complete({ system: "...", messages: [...], model: "gpt-4o" })
```

## Adding a New Provider

1. Create `providers/MyProvider.js` extending `LlmProvider`.
2. Implement `complete(request)` returning a `CompletionResult`.
3. Register in `providers/index.js` — add to `providerFromEnv()` logic.

## Reasoning Models

Reasoning models (DeepSeek-R1 family, some Anthropic/OpenAI variants) expose their chain-of-thought on a separate field. Field name varies by provider — `PortkeyProvider` captures whichever is present (`reasoning_content` or `reasoning`) for debugging only. It is not used by callers.
