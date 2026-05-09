# LLM Agent — Architecture Overview

> **Status: Steps 1–4 complete.** Backend infrastructure is running and verified end-to-end. See [Development Guide](./development-guide.md) for implementation status.

## Goal

Extend Overleaf into a LaTeX LLM Agent platform. The agent is intrinsic to the editor: users interact via a sidebar panel and can select document text to send to the agent for amendment. Agent suggestions appear as tracked changes the user can accept or reject.

This is simultaneously a **research project** (swap models freely, log everything, replay runs) and a **commercial product** (auth, rate limiting, reliability). The architecture keeps those two concerns in separate layers so neither blocks the other.

## Decisions

- **Provider**: must be swappable — local models and private APIs alike. Hide the provider behind a single interface so changing it is one file. See [Providers](./providers.md).
- **Agents and tools**: each agent is metadata (system prompt + allowed tool names + model parameters). Tools are registered in a single registry. Adding a new agent is a config change, not a code change. See [Agents](./agents.md) and [Tools](./tools.md).
- **Document input**: snapshot at call time. Simpler, sufficient for text amendment.
- **Conversation scope**: per project. All collaborators share a conversation thread.
- **Pipeline steps**: not decided — that is the research.
- **Document edits**: surgical `{old_text, new_text}` replacement via a new endpoint on `document-updater`. Never full-document replacement.
- **Change tracking**: all agent edits go through `meta.tc` → tracked changes pipeline. Users accept/reject individually. See [Track Changes](./track-changes.md).

## Architecture: Two Layers

### Layer 1 — `services/llm-agent/` (Research Layer)

All LLM logic: prompt construction, model calls, pipeline orchestration, run storage. No auth, no sessions. Receives a payload, returns a result. Researchers can call this directly, bypassing the web layer entirely, for experiments.

### Layer 2 — `services/web/modules/llm-agent/` (Commercial Layer)

Auth gateway + frontend. Reuses existing auth middleware, rate limiters, subscription checks. Proxies to Layer 1. Registers all frontend code. Touches zero core Overleaf code.

This separation means: research iteration happens entirely in Layer 1. Commercial concerns live entirely in Layer 2. Neither blocks the other.

| Concern | Where it lives | How to iterate |
|---|---|---|
| New pipeline step | `services/llm-agent/AgentManager.js` | Edit, `bin/dev llm-agent` hot-reloads |
| Swap LLM provider | `services/llm-agent/LlmProvider.js` | One file change + env var |
| Inspect a run | `GET /admin/agent/runs/:runId` | Returns full run doc with all steps |
| Replay a run | Call agent service directly with saved `input` | Bypass web module entirely |
| Rate limiting | `AiFeatureUsageRateLimiter` in web module | Extend existing class |
| Subscription gating | Add feature flag to existing subscription system | Follow `aiErrorAssistant` pattern |
| Frontend UI | `services/web/modules/llm-agent/frontend/` | Webpack hot-reloads |

The rule: **if it is about the agent's intelligence, it goes in `services/llm-agent/`**. If it is about who is allowed to use it and how it surfaces in the editor, it goes in the web module.

## Run Data Model (Observability)

Every agent invocation is a **run**, written to MongoDB. Write it when the run starts, append each step as it completes, finalize at the end. Full audit trail even if the process crashes.

```
Run {
  _id, projectId, userId, createdAt
  status: pending | running | done | error

  input {
    userMessage, selectedText, documentSnapshot, cursorPosition
  }

  steps [{                     ← one entry per LLM or tool call
    name                       ← e.g. 'edit-generation'
    startedAt, finishedAt
    input                      ← exact payload sent
    output                     ← exact response received
    metadata                   ← token counts, model, latency
    error
  }]

  output { type, content, diff }
  durationMs, error
}
```

Use `$push` for steps — never rewrite the whole document mid-run. See [Types & Schemas](./types-and-schemas.md) for full type definitions.

## What Already Exists to Reuse

Overleaf's AI infrastructure is further along than the open-source code suggests:

- **`AiFeatureUsageRateLimiter`** (`app/src/infrastructure/rate-limiters/`) — quota-based rate limiter tied to subscription tier and Writefull status.
- **`WorkbenchRateLimiter`** — token-count-based rate limiter (8M token allowance per period).
- **`ai`, `@ai-sdk/openai`, `@ai-sdk/mcp`, `@ai-sdk/react`** — already in `services/web/package.json`.
- **`sectionTitleGenerators` module slot** — evidence that Overleaf is already wiring AI generation into the editor.
- **Subscription feature flags** (`aiErrorAssistant`, `writefull.isPremium`) — gating mechanism already built.
- **`EditorRealTimeController.emitToRoom()`** — existing pattern for pushing backend events to the browser.
- **`services/chat/`** — message storage, thread management, and full frontend chat UI.

See [Capabilities](./capabilities.md) for the full list of unique Overleaf capabilities the agent can leverage.

## Frontend Integration Points

The module macro reads `settings.overleafModuleImports` at webpack build time. **Restart webpack after any change to `settings.defaults.js`.**

| Slot | Purpose | Reference |
|---|---|---|
| `railEntries` | Sidebar tab + panel | `rail.tsx` → `moduleRailEntries` |
| `sourceEditorExtensions` | CM6 selection watcher + decorations | `extensions/selection-listener.ts` |
| `rootContextProviders` | Agent React context wrapping the IDE | any existing provider |

**Text amendments must go through the tracked-changes pipeline** — not applied directly to CM6. Agent returns `{old_text, new_text}` → web module calls `agent-replace` endpoint → tracked change created → pushed via `emitToRoom` → `updateRangesEffect` fires in frontend. The accept/reject UI from `review-panel` works for free. See `extensions/ranges.ts` and `ranges-context.tsx`.
