# LLM Agent — Architecture & Development Plan

> **Status: Steps 1–4 complete.** Backend infrastructure is running and verified end-to-end. See Implementation Status section.

---

## Goal

Extend Overleaf into a LaTeX LLM Agent platform. The agent is intrinsic to the editor: users interact via a sidebar panel and can select document text to send to the agent for amendment. Agent suggestions appear as tracked changes the user can accept or reject.

This is simultaneously a **research project** (swap models freely, log everything, replay runs) and a **commercial product** (auth, rate limiting, reliability). The architecture keeps those two concerns in separate layers so neither blocks the other.

---

## Decided

- **Provider**: must be swappable — local models and private APIs alike. Hide the provider behind a single interface so changing it is one file. The `ai` package (Vercel AI SDK) is already in `services/web/package.json` and supports both local and cloud providers; evaluate it first before adding new dependencies.
- **Document input**: snapshot at call time. Simpler, sufficient for text amendment.
- **Conversation scope**: per project. All collaborators share a conversation thread.
- **Pipeline steps**: not decided — that is the research.
- **Document edits**: surgical `{old_text, new_text}` replacement via a new endpoint on `document-updater`. Never full-document replacement.
- **Change tracking**: all agent edits go through `meta.tc` → tracked changes pipeline. Users accept/reject individually.

---

## What already exists to reuse

Overleaf's AI infrastructure is further along than the open-source code suggests. The actual AI feature implementations live in private SaaS modules, but the scaffolding is all here:

- **`AiFeatureUsageRateLimiter`** (`app/src/infrastructure/rate-limiters/`) — quota-based rate limiter tied to subscription tier and Writefull status. Extend this for the agent rather than writing a new one.
- **`WorkbenchRateLimiter`** — token-count-based rate limiter, already designed for LLM usage (8M token allowance per period). The pattern to copy for per-project token budgets.
- **`ai`, `@ai-sdk/openai`, `@ai-sdk/mcp`, `@ai-sdk/react`** — already in `services/web/package.json`. Do not add duplicate LLM dependencies.
- **`sectionTitleGenerators` module slot** — evidence that Overleaf is already wiring AI generation into the editor via the module system. Our agent uses the same injection points.
- **Subscription feature flags** (`aiErrorAssistant`, `writefull.isPremium`) — the gating mechanism for commercial access is already built. The agent adds a new flag, not a new system.
- **`EditorRealTimeController.emitToRoom()`** — the existing pattern for pushing backend events to the browser. No new infrastructure needed for real-time agent responses.
- **`services/chat/`** — message storage, thread management, and the full frontend chat UI. Reused directly for the agent conversation panel (see Chat Integration section).

---

## Architecture: two layers

**Layer 1 — `services/llm-agent/`** (pure research layer)

All LLM logic: prompt construction, model calls, pipeline orchestration, run storage. No auth, no sessions. Receives a payload, returns a result. Researchers can call this directly, bypassing the web layer entirely, for experiments.

**Layer 2 — `services/web/modules/llm-agent/`** (commercial layer)

Auth gateway + frontend. Reuses existing auth middleware, rate limiters, subscription checks. Proxies to Layer 1. Registers all frontend code. Touches zero core Overleaf code.

This separation means: research iteration happens entirely in Layer 1. Commercial concerns live entirely in Layer 2. Neither blocks the other.

---

## The run data model (observability)

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

Use `$push` for steps — never rewrite the whole document mid-run.

---

## Provider interface

Hide the LLM provider behind one module. All pipeline steps call this; none import a provider SDK directly. Swapping providers means changing this one file.

```
LlmProvider {
  complete({ system, messages, model, ...options })
    → { text, inputTokens, outputTokens, model, rawResponse }
}
```

Configure the active provider and model via environment variables. Local model support (Ollama, llama.cpp, etc.) requires the provider to accept a `baseUrl` override — verify this before committing to a specific SDK.

---

## Agent tools — inventory and LOC estimates

All tools follow the same 3-layer pattern: `document-updater` endpoint → web module proxy → frontend call. The document-updater layer is the real work; the proxy is mechanical.

### Core document tools

**`agent-replace`** — surgical edit via `{old_text, new_text}`

The primary editing primitive. The LLM identifies the exact span to replace and returns the replacement. Never requires the full document. Multiple calls = multiple discrete tracked changes the user reviews independently.

```
POST /project/:pid/doc/:did/agent-replace
{ old_text: "...", new_text: "...", user_id: "..." }
```

Server logic: fetch current lines from Redis → join as string → find `old_text` offset → build op `[{p, d: old_text}, {p, i: new_text}]` → call `UpdateManager.applyUpdate()` with `meta.tc` set.

Failure mode: `old_text` not found → 404. Clean, detectable, not a silent corruption. Indicates the document changed during the LLM call.

*LOC: ~40 in document-updater, ~20 in web module proxy. Total: ~60.*

**`compile-and-check`** — trigger compile, return structured errors

Trigger a CLSI compile, wait for result, return errors and warnings as structured objects (file, line, message). Enables iterative error-fixing loops. The existing log parser already produces structured output — we just need to expose it as a tool call.

*LOC: ~60 in web module (CLSI call + log parsing already done). Total: ~80.*

**`read-file`** — read any project file by path

Multi-file projects are the norm. An agent that can only see `main.tex` is useless for real documents. Returns file content as a string.

*LOC: ~15 in document-updater, ~20 in web module. Total: ~35.*

**`list-files`** — return project file tree

Prerequisite for `read-file`. The web service already computes this for the editor — the module proxies it.

*LOC: ~15 in web module (existing endpoint, just proxy). Total: ~15.*

**`create-file`** — create a new `.tex` or `.bib` file

Enables the agent to split a document, scaffold a new chapter, or create a bibliography. The web service already has `POST /project/:pid/doc` — the module wraps it with agent auth context.

*LOC: ~20 in web module. Total: ~20.*

**`get-outline`** — parse document structure

Fetch lines, extract `\section`, `\subsection`, `\begin{...}` entries with line numbers. Returns a structured outline the agent uses to navigate large documents semantically before deciding where to edit. Called first on most agent interactions.

*LOC: ~30 in document-updater (fetch + regex parse), ~20 in web module. Total: ~50.*

**`accept-changes` / `reject-changes`** — bulk change management

Accept or reject all pending agent changes in one call. The HTTP endpoints already exist in `document-updater` (`/change/accept`, `/change/reject`) — the module wraps them with a filter for `source: "llm-agent"` changes only.

*LOC: ~25 in web module. Total: ~25.*

**`check-syntax`** — LSP-like structural analysis without compiling

Reads all project documents via the document-updater `/peek` endpoint and detects four classes of problems entirely in-process:

1. **Undefined `\ref{}`** — reference targets not defined as `\label` in any loaded file (cross-file, project-wide)
2. **Duplicate `\label{}`** — same label key defined in multiple files
3. **Missing `\input{}`/`\include{}`** — referenced file not present in the project file list
4. **Unbalanced `\begin{}`/`\end{}`** — mismatched or unclosed environments (per-file, with line numbers)

Takes an optional `path` to scope to one file; when omitted, analyses the whole project. Useful before calling `compile-and-check` to catch structural errors cheaply, or to quickly locate a broken environment without a full compile cycle.

*LOC: ~120 in llm-agent service (no other layers). Total: ~120.*

**`get-pdf-page`** — render a PDF page as a PNG image for visual inspection

Returns a specific page of the most recently compiled PDF as a base64-encoded PNG. The image is generated by `pdftoppm` (poppler-utils, installed in CLSI) at 150 dpi and streamed back through the CLSI → web module → llm-agent tool chain. Enables the agent to visually verify layout, figure placement, table formatting, or any aspect of the typeset output that cannot be inferred from source text alone.

Pipeline:
```
llm-agent tool
  → GET /internal/project/:pid/agent/pdf-page?page=N&userId=X   (web module, Basic auth)
    → GET /project/:pid/user/:uid/pdf-page?page=N               (CLSI, internal)
      → pdftoppm -png -r 150 -f N -l N -singlefile output.pdf -
        → PNG bytes → base64 → { imageBase64, mimeType }
```

`compile-and-check` now also returns `pageCount` (from `pdfinfo`) so the agent knows the valid page range before calling this tool.

*LOC: ~50 in CLSI (CompileManager + CompileController + app.js routes), ~55 in web module, ~35 in llm-agent. Total: ~140.*

### LOC summary

| Tool | CLSI | web module | llm-agent | Total |
|---|---|---|---|---|
| `agent-replace` | — | 60 | — | 60 |
| `compile-and-check` + pageCount | 20 | 80 | 0 | 100 |
| `read-file` | — | 20 | 15 | 35 |
| `list-files` | — | 15 | — | 15 |
| `create-file` | — | 20 | — | 20 |
| `get-outline` | — | — | 30 | 30 |
| `accept/reject-changes` | — | 25 | — | 25 |
| `check-syntax` | — | — | 120 | 120 |
| `get-pdf-page` | 50 | 55 | 35 | 140 |
| Module scaffolding (shared) | — | 60 | — | 60 |
| **Total** | **70** | **335** | **200** | **605** |

Zero lines modified in existing files. All additive.

---

## Document operations: how edits work

### Why not full-document replacement

`setDoc` sends full lines → `DiffCodec.diffAsShareJsOp(oldLines, newLines)` runs Myers diff. Myers finds the minimal edit but has no concept of intent. Replacing one paragraph may produce 15 scattered ops. In the review panel, the user sees noise. The LLM already knows what it changed — we capture that knowledge directly.

### The edit pipeline for `agent-replace`

```
LLM returns { old_text, new_text }
       │
       ▼
POST /project/:pid/doc/:did/agent-replace
       │
       ▼
HttpController.agentReplace()
  1. Fetch current lines from Redis (already in memory)
  2. Join as single string
  3. Find old_text → get char offset p
  4. If not found → 404
  5. Build op: [{ p, d: old_text }, { p, i: new_text }]
  6. Construct update: { op, meta: { user_id, tc: <id_seed>, source: "llm-agent" } }
       │
       ▼
UpdateManager.applyUpdate()
RangesManager sees meta.tc → creates ONE tracked change entry
       │
       ▼
Redis pub/sub → real-time service → WebSocket broadcast
       │
       ▼
Tracked change appears in all connected clients' review panels (~100ms)
```

### The `meta.tc` flag

This is the only thing that distinguishes our edits from Dropbox sync (which uses the same HTTP path). `RangesManager.js:47`:

```javascript
rangesTracker.track_changes = Boolean(update.meta?.tc)
```

Set it → tracked change. Unset → silent overwrite. Everything else in the pipeline is identical.

### Stale-read risk

The LLM reads the document, processes for 2–10 seconds, then posts the edit. If another user edited the same span during that window, `old_text` won't be found → clean 404. The agent layer handles this by retrying with a fresh document read. No corruption is possible.

---

## Unique Overleaf capabilities: what makes this harness special

A bash+compiler harness gives the agent: `.tex` files, raw LaTeX log output, a PDF. The Overleaf platform gives the agent everything below — none of which requires new infrastructure.

### Tier 1 — No equivalent exists outside Overleaf

**Auxiliary files after compile** (`.aux`, `.toc`, `.bbl`, `.lof`, `.lot`)

After every compile, CLSI produces files that contain resolved structure:
- `.aux` — every `\label` → page and section number, fully resolved
- `.toc` — complete table of contents with actual page numbers
- `.bbl` — the formatted bibliography exactly as it appears in print
- `.lof` / `.lot` — every figure and table with caption and page number

A compiler tells you about errors after the fact. These files tell you the resolved document graph — label resolution, citation rendering, structure with pagination — without any additional parsing work.

**1.6MB package mapping** (`services/web/app/src/Features/Metadata/packageMapping.mjs`)

A server-side mapping of essentially every LaTeX package to structured metadata. The agent answers "what package provides `\qty{}`?" or "which packages conflict with `fontenc`?" without any external lookup. Thousands of hours of curated knowledge already in the repo.

**Semantic live index** (CodeMirror 6 language layer + `MetaHandler`)

The editor continuously parses `.tex` source and maintains live indexes of every `\label`, `\ref`, `\cite`, `\input`, `\include`, and `\usepackage`. The agent can report undefined references, unused labels, and missing citations **without triggering a compile**. This is structural analysis that runs as the user types.

Server-side extraction is handled by `MetaHandler.mjs` with regex patterns:
- `LABEL_RE` — all `\label{...}` definitions
- `PACKAGE_RE` / `REQ_PACKAGE_RE` — packages with option extraction
- `DOCUMENT_CLASS_RE` — document class and options

**Existing AI quota infrastructure**

`AiFeatureUsageRateLimiter` already exists with free/premium/unlimited tiers, tied to Writefull and subscription status. The billing and gating infrastructure is already built. The agent hooks into it rather than building a new quota system.

### Tier 2 — Strong differentiators

**Full attributed change history** (`services/project-history/`)

Every character-level operation ever applied is stored with `user_id`, `timestamp`, `pathname`, and the op itself. The agent can query: "what changed in this section in the last 3 days?" or "show me everything user X has edited." A git repo gives you commits. This gives character-level attribution across every collaborator with millisecond timestamps, with no commit discipline required.

**Tracked changes as context** (`ranges` on every document)

Before editing, the agent reads existing pending tracked changes — who proposed what and when. It can avoid making a redundant edit that conflicts with a pending human change, or explicitly reason about whether to reinforce or contradict a pending proposal.

**Live presence** (`ConnectedUsersManager` in `services/real-time/`)

Redis stores each collaborator's current cursor position and which file they are viewing, updated in real-time. The agent knows who is currently editing section 3 and can avoid writing into an actively-edited span, or prioritize the section with the most active focus.

**Structured compile errors** (log parser + hint rules)

`services/web/frontend/js/ide/log-parser/` already converts raw TeX log output into structured objects with `level`, `file`, `line`, `message`, and `content`. On top of that, `HumanReadableLogsRules.tsx` contains 36KB of hand-written rules mapping error patterns to actionable hints. The agent inherits all of this without writing a single log parser.

**Linked files — inter-project graph** (`services/web/app/src/Features/LinkedFiles/`)

Files can be linked between Overleaf projects, to external URLs, or to compiled output from other projects. The agent can traverse this graph. A thesis with chapters as linked sub-projects, a paper that imports figures from a shared figures project — the agent sees and reasons about the full dependency tree, not just a single project.

**Mendeley / Zotero / Papers integration**

Users already have their reference libraries connected. The agent can suggest citations by querying their actual library, not a generic lookup. "You cited Smith 2019 in section 2 — your Zotero library has 3 related Smith papers you haven't cited" is only possible here.

**Comment threads with resolution tracking** (`services/chat/`)

Comment threads are stored with full history and `resolved_by_user_id`. The agent reads the discussion around a section before editing — understanding not just what the text says but what conversation happened around it. It can post its own responses into threads, making the agent a participant in review discussions.

**Git bridge snapshot API** (`services/git-bridge/`)

Exposes project snapshots tied to git commits — version history at commit granularity, with human-authored commit messages. Gives the agent historical context beyond Overleaf's OT op history.

### Tier 3 — Useful context signals

**Project tags** — user-defined categorization (`conference-paper`, `thesis`, `draft`). The agent knows the intent and formality level before reading a word.

**Project compile settings** — compiler choice (pdflatex/xelatex/lualatex), TeX Live version, root doc. The agent won't suggest `fontspec` to a pdfLaTeX user or a package requiring TeX Live 2023 to someone on 2021.

**User editor settings** — spell check language, autocomplete preferences, keybindings. The agent knows if the user writes in British English and adapts suggestions accordingly.

**Word count by semantic category** — not total words but `textWords`, `headWords`, `abstractWords`, `captionWords`, `footnoteWords` separately. The agent can say "your abstract is 380 words; most target journals cap at 250" and know it is talking about the abstract specifically.

**SyncTeX** — bidirectional source↔PDF mapping. After compile, the agent can anchor its suggestions to specific PDF pages and coordinates. "The error is on page 3, paragraph 2 — here is the source line" is a qualitatively different interaction.

**Split test / feature flag infrastructure** — rollout of new agent features without code deploys, already wired to analytics and Slack notifications.

---

## Chat integration: frontend ↔ backend entrypoint

### What the current chat system is

`services/chat/` is an independent Node service storing messages and threads in MongoDB. The web service proxies it via `ChatController.mjs` → `ChatApiHandler.mjs`. The frontend renders it as a rail panel with full React state management, WebSocket-driven real-time updates, pagination, optimistic sending, and MathJax rendering.

**Current data model:**
- Each project has one global thread (`GLOBAL` constant in `ThreadManager.js`)
- Messages store: `content`, `room_id`, `user_id`, `timestamp`, optionally `edited_at`
- Threads store: `project_id`, `thread_id`, `resolved` (with `user_id` and `ts`)

**Current WebSocket events** (emitted by `ChatController` via `EditorRealTimeController`):
- `new-chat-message` — new message received
- `delete-global-message` — message deleted
- `edit-global-message` — message edited

**Frontend components available:**
- `ChatContext` — full state machine (load, paginate, send, delete, edit, unread tracking)
- `MessageList` — groups messages by author within 5-minute windows
- `MessageInput` — textarea with Enter-to-send
- `MessageContent` — Linkify + MathJax rendering + inline edit mode
- `InfiniteScroll` — scroll-to-load pagination with position preservation
- `ChatIndicator` — unread count badge on rail tab

### What we reuse directly

| Component | Reuse | Notes |
|---|---|---|
| `MessageManager.js` | Unchanged | Stores agent messages in the same collection with `user_id = agent_id` |
| `ThreadManager.js` | Unchanged | One thread per agent conversation; `thread_id = conversationId` |
| `ChatApiHandler.mjs` | Unchanged | Already proxies all thread endpoints |
| `MessageList` | Unchanged | Groups messages; agent messages render as their own group |
| `MessageInput` | Unchanged | User types, hits Enter, message goes to agent |
| `MessageContent` | Unchanged | MathJax renders LaTeX in agent responses for free |
| `InfiniteScroll` | Unchanged | Conversation history pagination works immediately |
| `ChatIndicator` | Unchanged | Unread badge on the agent rail tab |

### What we modify

**`ChatManager.mjs` — user enrichment**

Currently batch-fetches real users by ID to inject `{first_name, last_name, email}` into messages. Agent messages have no MongoDB user document. Add a branch: if `user_id` matches a known agent ID, inject agent metadata instead `{name: "Agent", avatar: "...", isAgent: true}`.

*Change: ~15 lines in one existing function.*

**`ChatController.mjs` — new `sendAgentMessage` handler**

The current `sendMessage` handler stores the message and broadcasts it. We need a variant that also triggers the LLM pipeline. This is a new handler, not a modification of the existing one.

*New function: ~30 lines.*

**Frontend `ChatContext` — agent conversation thread**

Currently hardcoded to the global thread. For agent chat we target a specific `thread_id` (the conversation ID). Fork `ChatContext` into `AgentChatContext` that parameterizes on `conversationId` and adds a `pending` state for in-flight LLM responses.

*Fork + extend: ~80 lines of new context code.*

### The main entrypoint: `POST /project/:pid/agent/message`

This is the single route that connects the frontend chat panel to the backend LLM pipeline.

```
User types message → MessageInput → POST /project/:pid/agent/message
                                         │
                    ┌────────────────────┘
                    │
                    ▼
  LlmAgentController.sendMessage() [web module]
    1. Validate auth + project access (existing middleware)
    2. Check AiFeatureUsageRateLimiter.check(userId)
    3. Save user message to chat service:
       POST chat:3010/project/:pid/thread/:conversationId/messages
       → returns { messageId }
    4. Emit 'new-chat-message' via EditorRealTimeController
       → all clients see user message immediately
    5. POST llm-agent:3055/project/:pid/run
       { userId, conversationId, userMessage, projectSnapshot? }
       → returns { runId }
    6. Respond to browser: { runId, messageId }  (HTTP 202)
                    │
                    │  async, in services/llm-agent/
                    ▼
  AgentManager.run()
    1. Load conversation history from chat service
    2. Call LlmProvider.complete(...)
    3. For each tool call: execute, record step in Run document
    4. When response ready:
       POST chat:3010/project/:pid/thread/:conversationId/messages
       { content: agentResponse, user_id: AGENT_USER_ID }
    5. EditorRealTimeController.emitToRoom(projectId,
         'new-chat-message', { message, ... })
                    │
                    │  WebSocket push to all clients
                    ▼
  Frontend AgentChatContext receives 'new-chat-message'
  → dispatch RECEIVE_MESSAGE
  → agent response appears in panel
  → pending spinner cleared
```

**Key properties of this design:**
- The HTTP response (step 6) returns immediately — no waiting for the LLM
- The user sees their own message instantly (step 4)
- The agent response arrives via the existing WebSocket infrastructure (step 5) — no polling, no new socket events, reuses `new-chat-message`
- Conversation history is stored in the chat service — same MongoDB collection, no new storage
- The entire flow is observable: every step is recorded in the Run document

### New files required for the entrypoint

```
services/web/modules/llm-agent/
  index.mjs
  app/src/
    LlmAgentRouter.mjs         ← registers POST /project/:pid/agent/message
    LlmAgentController.mjs     ← steps 1–6 above (~60 lines)
    LlmAgentApiHandler.mjs     ← proxies to llm-agent service (~30 lines)
  frontend/js/
    components/
      AgentPanel.tsx            ← rail panel container
    context/
      agent-chat-context.tsx    ← fork of ChatContext, parameterized on conversationId
```

Modifications to existing files: `ChatManager.mjs` (~15 lines for agent identity enrichment). Nothing else.

---

## Frontend integration points

The module macro reads `settings.overleafModuleImports` at webpack build time. **Restart webpack after any change to `settings.defaults.js`.**

| Slot | Purpose | Reference |
|---|---|---|
| `railEntries` | Sidebar tab + panel | `rail.tsx` → `moduleRailEntries` |
| `sourceEditorExtensions` | CM6 selection watcher + decorations | `extensions/selection-listener.ts` |
| `rootContextProviders` | Agent React context wrapping the IDE | any existing provider |

**Text amendments must go through the tracked-changes pipeline** — not applied directly to CM6. Agent returns `{old_text, new_text}` → web module calls `agent-replace` endpoint → tracked change created → pushed via `emitToRoom` → `updateRangesEffect` fires in frontend. The accept/reject UI from `review-panel` works for free. See `extensions/ranges.ts` and `ranges-context.tsx`.

---

## How to add a new service (step by step)

This is the concrete sequence for `services/llm-agent/`. Follow it for any new service.

**1. Create the directory and `package.json`**

```
services/llm-agent/
  package.json
  app.js
  app/js/server.js
  config/settings.defaults.cjs
```

Copy `services/chat/package.json`. Change `name` to `@overleaf/llm-agent`. Keep `@overleaf/logger`, `@overleaf/metrics`, `@overleaf/settings` as dependencies — these three are mandatory for every service.

**2. Register as a workspace**

In root `package.json`, add `"services/llm-agent"` to the `workspaces` array. Run `npm install` from the repo root to link it.

**3. Write the entry point**

Copy `services/chat/app.js` verbatim. Change the logger name (`logger.initialize('llm-agent')`), the settings key for host/port, and the import of `server.js`. Do not add anything else yet.

**4. Write `settings.defaults.cjs`**

```js
module.exports = {
  internal: {
    llmAgent: { host: process.env.LLM_AGENT_HOST || '127.0.0.1', port: 3055 },
  },
}
```

Pick a port not used by any existing service. Check `develop/dev.env` for the current list.

**5. Write `app/js/server.js`**

```js
import express from 'express'
import metrics from '@overleaf/metrics'
import logger from '@overleaf/logger'

export function createServer() {
  const app = express()
  app.use(metrics.http.monitor(logger))
  metrics.injectMetricsRoute(app)
  app.use(express.json())

  app.get('/health', (req, res) => res.sendStatus(200))

  return { app }
}
```

Nothing else. Verify it starts locally with `node app.js` before touching Docker.

**6. Add to `develop/docker-compose.yml`**

Copy the `chat:` block. Change the service name, Dockerfile path, and env vars. No port mapping needed unless you want to hit it directly from the host.

```yaml
llm-agent:
  build:
    context: ..
    dockerfile: services/llm-agent/Dockerfile
  env_file:
    - dev.env
```

Add `llm-agent` to the `depends_on` list of `web:`.

**7. Add to `develop/dev.env`**

```
LLM_AGENT_HOST=llm-agent
```

**8. Add to `develop/docker-compose.dev.yml`** (for `bin/dev` hot-reload)

```yaml
llm-agent:
  command: ["node", "--watch", "app.js"]
  volumes:
    - ../services/llm-agent/app:/overleaf/services/llm-agent/app
    - ../services/llm-agent/app.js:/overleaf/services/llm-agent/app.js
    - ../services/llm-agent/config:/overleaf/services/llm-agent/config
```

**9. Write a Dockerfile**

Copy `services/chat/Dockerfile` and change the paths. Run `bin/build` then `bin/up`. Verify with:

```shell
docker compose exec llm-agent curl localhost:3055/health
# → 200 OK
```

---

## How to add an API endpoint (step by step)

**Internal endpoint (inside `services/llm-agent/`)**

Add a route in `app/js/server.js`:

```js
app.post('/project/:projectId/run', AgentController.startRun)
```

`AgentController.startRun` reads the body, writes a run document, kicks off `AgentManager.run()`, and responds with `{ runId }`. No auth — the web module is the only caller.

**Public endpoint (inside `services/web/modules/llm-agent/`)**

1. Create `services/web/modules/llm-agent/index.mjs`:

```js
import LlmAgentRouter from './app/src/LlmAgentRouter.mjs'
export default { router: LlmAgentRouter }
```

2. Create `LlmAgentRouter.mjs`:

```js
import AuthenticationController from '../../app/src/Features/Authentication/AuthenticationController.mjs'
import { expressify } from '@overleaf/promise-utils'
import LlmAgentController from './LlmAgentController.mjs'

export default {
  apply(webRouter) {
    webRouter.post(
      '/project/:project_id/agent/message',
      AuthenticationController.requireLogin(),
      expressify(LlmAgentController.sendMessage)
    )
  },
}
```

3. Create `LlmAgentController.mjs` — reads session, calls `LlmAgentApiHandler`, responds with `{ runId }`.

4. Create `LlmAgentApiHandler.mjs` — calls `services/llm-agent/` via `fetchJson` from `@overleaf/fetch-utils`. Use `Settings.internal.llmAgent` for the host/port.

5. Modules are auto-loaded from `services/web/modules/` — no registration needed beyond creating `index.mjs`.

---

## How to add the `agent-replace` endpoint to document-updater

Two files, both additive:

**`services/document-updater/app.js`** — one line:
```js
app.post('/project/:project_id/doc/:doc_id/agent-replace', HttpController.agentReplace)
```

**`services/document-updater/app/js/HttpController.js`** — one new function:
```js
async function agentReplace(req, res) {
  const { project_id: projectId, doc_id: docId } = req.params
  const { old_text, new_text, user_id } = req.body

  const { lines, version } = await DocumentManager.getDocWithLock(projectId, docId)
  const content = lines.join('\n')
  const p = content.indexOf(old_text)

  if (p === -1) return res.status(404).json({ error: 'old_text not found' })

  const op = [{ p, d: old_text }, { p, i: new_text }]
  const update = {
    doc: docId, op, v: version,
    meta: { user_id, tc: new ObjectId().toString(), source: 'llm-agent' }
  }

  await UpdateManager.promises.applyUpdate(projectId, docId, update)
  res.sendStatus(204)
}
```

---

## Research vs. commercial: how to keep both moving

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

---

## Implementation Status

### Completed (Steps 1–4)

| Step | What was built | Verified by |
|---|---|---|
| 1 | `services/llm-agent/` skeleton — app.js, server.js, MongoDB connection, `/health` | `curl llm-agent:3055/health` → 200 |
| 2 | `AgentStore` (createRun/appendStep/finalizeRun) + `agent_runs` MongoDB collection | run doc appears with `status: done` after POST |
| 3 | `AgentManager.run()` stub — immediately finalizes run as `{ type: 'text', content: 'stub' }` | durationMs recorded, output.type = 'text' |
| 4 | Web module gateway — `POST /project/:pid/agent/message` with auth, chat storage, WebSocket emit | HTTP 202 + `{ runId, messageId, conversationId }` |

**Files created:**

```
services/llm-agent/
  app.js                          ← entry point (mirrors services/chat/app.js)
  config/settings.defaults.cjs   ← port 3055, mongo URL
  Dockerfile                      ← copies all @overleaf/* libs including fetch-utils + promise-utils
  package.json                    ← @overleaf/llm-agent, ESM, mocha for acceptance tests
  app/js/
    server.js                     ← Express + /health + POST /project/:projectId/run
    AgentController.js            ← validates body, createRun, fire-and-forget run()
    AgentStore.js                 ← createRun / appendStep ($push) / finalizeRun
    AgentManager.js               ← stub: finalizes run immediately as done
    mongodb.js                    ← MongoClient + db.agentRuns collection
    types.js                      ← JSDoc: AgentInput, AgentOutput, AgentTool, RunStep, etc.
  test/
    setup.js                      ← chai + chai-as-promised
    acceptance/
      StartingARunTests.js        ← health check, happy path, selection storage, validation
      helpers/
        AgentApp.js               ← starts service in-process on port 13055
        AgentClient.js            ← fetch-based HTTP client
        MongoHelper.js            ← clears agent_runs before each suite

services/web/modules/llm-agent/
  index.mjs                       ← exports { router: LlmAgentRouter }
  app/src/
    LlmAgentRouter.mjs            ← requireLogin + ensureUserCanReadProject + sendMessage
    LlmAgentController.mjs        ← validates, sendComment, emitToRoom, startRun → 202
    LlmAgentApiHandler.mjs        ← fetchJson to llmAgent internal_url
  test/unit/src/
    LlmAgentController.test.mjs   ← vitest: happy path, validation, auth, emitToRoom

develop/scripts/test-agent.mjs    ← standalone E2E test script (see Testing section)
```

**Config changes made:**
- `develop/docker-compose.yml` — added `llm-agent` service + `web.depends_on`
- `develop/docker-compose.dev.yml` — added `llm-agent` hot-reload + port 9241
- `develop/dev.env` — added `LLM_AGENT_HOST=llm-agent`
- `services/web/config/settings.defaults.js` — added `apis.llmAgent.internal_url` + `'llm-agent'` to `moduleImportSequence`
- Root `package.json` — added `"services/llm-agent"` to workspaces

---

## API Contract (for frontend engineers)

### Public endpoint — `POST /project/:project_id/agent/message`

Requires: authenticated session + read access to the project (existing middleware enforces both).

**Request body:**
```json
{
  "message": "Fix the grammar in the introduction",
  "conversationId": "64c9a0b8e1234567890abcde",
  "selection": {
    "docId": "63a4e1...",
    "fromLine": 41,
    "toLine": 44,
    "content": "the selected text as a string"
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | string | yes | Whitespace-only is rejected with 400 |
| `conversationId` | string (ObjectId hex) | no | If absent, a new thread is created. Must be a valid 24-char hex ObjectId — the chat service rejects UUIDs |
| `selection` | object | no | Text the user highlighted in the editor |
| `selection.docId` | string | no | MongoDB ObjectId of the document |
| `selection.fromLine` | number | no | 0-indexed, inclusive |
| `selection.toLine` | number | no | 0-indexed, inclusive |
| `selection.content` | string | no | Resolved text (sent by frontend to avoid a docstore roundtrip) |

**Response — HTTP 202 (immediate, does not wait for LLM):**
```json
{
  "runId": "69ed4e216a09e3a16d96c48c",
  "messageId": "69ed4e21d2740938d633b9e6",
  "conversationId": "69ed4e21abc123def4567890"
}
```

| Field | Notes |
|---|---|
| `runId` | ObjectId of the run document in `agent_runs`. Use for admin/debug links. |
| `messageId` | ObjectId of the user's message stored in the chat service. |
| `conversationId` | The thread ID to pass back on the next message in the same conversation. Persist in UI state. |

**Error responses:**
| Status | When |
|---|---|
| 400 | `message` absent or whitespace-only |
| 302/401 | Not authenticated (redirects to login) |
| 403 | CSRF token missing or invalid |
| 500 | Chat service unavailable or internal error |

### How the agent response arrives

The HTTP 202 returns immediately. The agent response comes later via the existing WebSocket:

```
Browser POSTs → HTTP 202 { runId, messageId, conversationId }
                        │
                        │  async, inside services/llm-agent/
                        ↓
            AgentManager.run() finishes
            → stores agent reply in chat service
            → EditorRealTimeController.emitToRoom(projectId, 'new-chat-message', message)
                        │
                        │  Redis pub/sub → Socket.io → WebSocket
                        ↓
            Browser receives 'new-chat-message' event
            (same event as human chat messages)
```

**Frontend integration checklist:**
- [ ] POST to `/project/:pid/agent/message` with CSRF token in `x-csrf-token` header
- [ ] Store `conversationId` from the 202 response; pass it in subsequent messages
- [ ] Show user message immediately (optimistic) — don't wait for the WebSocket event
- [ ] Show spinner/pending state after 202 until `new-chat-message` arrives with the agent's reply
- [ ] Agent messages have `user_id` = the agent's user ID — detect this to style differently
- [ ] The `runId` can be shown in an admin/debug panel as a link to `/admin/agent/runs/:runId` (not yet implemented)

### Testing the endpoint

End-to-end test script (runs against the live dev stack):
```bash
cd /repo/root && node develop/scripts/test-agent.mjs
# Creates a throw-away test user, runs all checks, cleans up
# Uses mongodb://localhost:27017/sharelatex?directConnection=true

# With existing credentials:
node develop/scripts/test-agent.mjs --email=you@example.com --password=secret

# Against a specific project (skip project creation):
node develop/scripts/test-agent.mjs --project=<projectId>
```

---

## Development sequence

1. `services/llm-agent/` skeleton — health endpoint, starts in Docker. ✅ done
2. Run storage — `AgentStore` + MongoDB. ✅ done
3. Web module backend — auth route + `POST /project/:pid/agent/message`. ✅ done
4. `AgentManager` stub — run finalizes immediately as done. ✅ done
5. Provider interface — `LlmProvider.js` with one real provider. ✓ = run document has completed step with token counts.
6. Real agent response — `AgentManager.run()` calls the LLM, stores reply in chat. ✓ = agent message appears in chat thread.
7. `agent-replace` endpoint on `document-updater`. ✓ = tracked change visible in review panel after curl.
8. Tool loop — agent calls `get-outline`, `read-file`, `compile-and-check` in sequence. ✓ = multi-step run in DB.
9. Rail sidebar — `AgentPanel` with `AgentChatContext` forked from `ChatContext`. ✓ = panel opens, shows empty conversation.
10. CM6 selection — selected text arrives in the sidebar panel. ✓ = text shown.
11. End-to-end — user message in → agent reply appears in panel via WebSocket. ✓ = full round-trip.

---

## Agent Tools — Implementation (Steps 5+)

All tools live in `services/llm-agent/app/js/tools/` and follow a 3-layer call chain:

```
llm-agent tool (services/llm-agent/)
  → web module internal route (services/web/modules/llm-agent/)
    → downstream service (CLSI, document-updater, or web service internals)
```

### Tool inventory

| Tool | File | Internal route | Downstream |
|---|---|---|---|
| `listFiles` | `list_files.js` | (none — reads ctx.files) | — |
| `readFile` | `read_file.js` | (none — reads ctx.files) | document-updater `/project/:pid/doc/:did` |
| `getOutline` | `get_outline.js` | (none — reads ctx.files) | document-updater `/project/:pid/doc/:did` |
| `editFile` | `edit_file.js` | (none — reads ctx.files) | document-updater `/project/:pid/doc/:did/agent-replace` |
| `createFile` | `create_file.js` | `POST /internal/.../agent/create-file` | `EditorController.upsertDocWithPath` |
| `deleteFile` | `delete_file.js` | `POST /internal/.../agent/delete-file` | `EditorController.deleteEntityWithPath` |
| `moveFile` | `move_file.js` | `POST /internal/.../agent/move-file` | `EditorController.moveEntity` + `renameEntity` |
| `compileAndCheck` | `compile_and_check.js` | `POST /internal/.../agent/compile` | CLSI compile + `pdf-info` |
| `checkSyntax` | `check_syntax.js` | `GET /internal/.../agent/syntax-check` | `SyntaxChecker.check()` (Redis + MongoDB) |
| `getPdfPage` | `get_pdf_page.js` | `GET /internal/.../agent/pdf-page` | CLSI `pdf-page` endpoint |

### RunContext

Every tool receives a `RunContext` object:

```js
{
  projectId: string,       // MongoDB ObjectId hex
  userId: string,          // MongoDB ObjectId hex
  runId: string,           // MongoDB ObjectId hex
  context: {
    projectName: string,
    compiler: string,      // 'pdflatex' | 'xelatex' | 'lualatex'
    files: [{ path: string, docId: string }],
  }
}
```

Tools that need file metadata (readFile, editFile, getOutline) look up `docId` from `ctx.context.files` by path. After `createFile`, the tool must push the new `{path, docId}` into `ctx.context.files` so subsequent tools can find it.

### CLSI PDF endpoints

Two new endpoints were added to CLSI for PDF inspection:

**`GET /project/:project_id/user/:user_id/pdf-info`**
Returns `{ pageCount: number }` from `pdfinfo`. Returns 404 if no compiled PDF exists.

**`GET /project/:project_id/user/:user_id/pdf-page?page=N`**
Returns a PNG image (150 dpi) of page N as `image/png`. Returns 404 if no PDF or page out of range.

Both routes are registered in `services/clsi/app.js` lines 87-88 (shared) and 115-121 (per-user).

Implementation in `CompileManager.js`:
- `findPdfPath(projectId, userId)` — locates the most recent `output.pdf` by checking the output dir first (where qpdf optimization places it), iterating builds in reverse chronological order, then falling back to the compile dir.
- `getPdfInfo()` — runs `pdfinfo` on the located PDF.
- `getPdfPage()` — runs `pdftoppm -png -r 150 -f N -l N` with a temp file (stdout mode is broken in poppler 22.12.0).

### SyntaxChecker — Redis-based analysis

`SyntaxChecker.check(projectId, scopePath)` performs structural analysis without compiling. It detects:

1. **Undefined `\ref{}`** — cross-file, project-wide
2. **Duplicate `\label{}`** — same key in multiple files
3. **Missing `\input{}`/`\include{}`** — referenced file not in project
4. **Unbalanced `\begin{}`/`\end{}`** — per-file, with line numbers

**Critical design decision: reads from Redis, not MongoDB.**

Document content is fetched from document-updater (`DocumentUpdaterHandler.promises.getDocument`) so edits are visible immediately — no MongoDB flush required. The only MongoDB query is `ProjectEntityHandler.getAllDocs()` for the file tree (docIds → paths), which is cheap metadata.

Label extraction uses the same regexes as `MetaHandler.mjs` (`LABEL_RE`, `LABEL_OPTION_RE`) with identical comment-stripping logic, keeping behavior consistent with the editor's autocomplete.

Fallback: if a doc is not yet in Redis (e.g. freshly created), it falls back to MongoDB lines.

### Internal service-to-service routes

The web module exposes internal routes under `/internal/project/:project_id/agent/` that are called by the llm-agent service. These use Basic auth (`requirePrivateApiAuth()`), not session cookies, so CSRF is not an attack vector.

**Registration order matters:** internal routes are registered in `applyNonCsrfRouter()` which runs before CSRF middleware is attached to `webRouter`. See `LlmAgentRouter.mjs`.

| Route | Method | Purpose |
|---|---|---|
| `/internal/project/:pid/agent/complete` | POST | llm-agent calls after run finishes → emits agent reply via WebSocket |
| `/internal/project/:pid/agent/create-file` | POST | Create a new document in the project |
| `/internal/project/:pid/agent/delete-file` | POST | Delete a document by path |
| `/internal/project/:pid/agent/move-file` | POST | Rename or move a document (with rollback on failure) |
| `/internal/project/:pid/agent/compile` | POST | Trigger CLSI compile, return `{success, status, errors, pageCount}` |
| `/internal/project/:pid/agent/pdf-page` | GET | Get a PDF page as base64 PNG |
| `/internal/project/:pid/agent/syntax-check` | GET | Run structural analysis, return `{issues}` |

---

## Integration testing

### `test-tools.mjs` — full tool chain verification

Located at `services/llm-agent/app/js/scripts/test-tools.mjs`. Runs inside the llm-agent container against the live dev stack.

**Run:**
```bash
cd develop && docker compose -f docker-compose.yml -f docker-compose.dev.yml \
  exec -T -e ADMIN_EMAIL="test@example.com" -e ADMIN_PASSWORD="secret" \
  llm-agent node /overleaf/services/llm-agent/app/js/scripts/test-tools.mjs
```

**What it tests (13 steps):**
1. `listFiles` — verifies project file tree
2. `readFile(main.tex)` — reads initial document
3. `createFile(new.tex)` — creates a new document, returns `{path, docId}`
4. `readFile(new.tex)` — verifies created content
5. `editFile` — applies a surgical edit via `agent-replace`
6. `readFile` again — verifies edit is visible (proves Redis read path works)
7. `getOutline` — extracts section structure
8. `checkSyntax` (clean) — zero errors on valid file
9. `compileAndCheck` — triggers compile, expects success
10. `getPdfPage(1)` — renders first page as PNG
11. `editFile` — introduces `\begin{table}` without `\end`
12. `compileAndCheck` — expects compile failure
13. `checkSyntax` (broken) — detects unclosed environment

**Auth setup:** Uses an existing admin account (set via `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars). If the user doesn't exist, it creates one with bcrypt-hashed password. The script upgrades the user to admin with unlimited features to avoid permission failures.

**Important:** When using a pre-existing account, `createdUserId` is set to `null` to prevent cleanup from deleting your account.

---

## Gotchas & Debugging Notes

### CLSI PDF path resolution (Bug #1 — fixed)

**Problem:** `getPdfPage` returned HTTP 502 after successful compiles.

**Root cause:** The compile pipeline runs `_saveOutputFiles` which moves the PDF from the compile dir to the output dir (for qpdf optimization). `getPdfPage` was only looking in the compile dir.

**Fix:** `findPdfPath()` checks the output dir first, iterating builds in reverse order (hex timestamps sort chronologically), returning the first build that has an `output.pdf`. Falls back to compile dir for the brief window during compile or legacy setups.

### pdftoppm stdout produces 0 bytes (Bug #1 — related)

**Problem:** `pdftoppm -png -r 150 -f 1 -l 1 output.pdf -` (stdout mode) returns 0 bytes in the CLSI container's poppler version (22.12.0).

**Fix:** Use a temp file instead. `pdftoppm` appends the page number to the filename prefix, so the output file is `${tmpPrefix}-${page}.png`. Clean up in `finally` block.

### SyntaxChecker misses edits (Bug #2 — fixed)

**Problem:** After `editFile` modifies a document, `checkSyntax` still sees the old content.

**Root cause:** `SyntaxChecker` was reading document lines from MongoDB, which is stale until a flush occurs. `editFile` writes to Redis (document-updater) — the live source of truth.

**Fix:** Read from `DocumentUpdaterHandler.promises.getDocument()` instead of MongoDB. Falls back to MongoDB lines if the doc isn't in Redis yet (e.g. freshly created).

### Table mismatch error detection (Bug #2 — related)

**Problem:** Test assertion checked for `"Unclosed"` in the error message, but an unclosed `\begin{table}` produces a mismatch error like `"\\end{document} at line N doesn't match \\begin{table} at line M"`.

**Fix:** Check for `"table"` in any issue message instead of looking for `"Unclosed"`. The detection is via the mismatch error, not an "Unclosed" message.

### bcrypt in test scripts

The test script (`test-tools.mjs`) needs `bcrypt` to hash passwords when creating new test users. `bcrypt` is available inside the web container but not the llm-agent container. Workaround: pre-create the user via the web container and use `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars:

```bash
# Generate hash from web container:
docker exec develop-web-1 node --input-type=module -e "
  import bcrypt from 'bcrypt';
  console.log(await bcrypt.hash('ToolsTest!1', 12));
"

# Update user in mongo:
docker exec develop-mongo-1 mongosh --quiet sharelatex --eval '
  db.users.updateOne(
    { email: "agent-test@overleaf.dev" },
    { $set: { hashedPassword: "<hash>" } }
  )
'
```

### `ctx.context.files` must be updated after createFile

After `createFile` returns a new `{path, docId}`, the test script (and any tool orchestration code) must push this entry into `ctx.context.files`. Otherwise subsequent tools like `readFile` or `editFile` won't find the docId and will fail.

### CLSI compile dir vs output dir

- **Compile dir** (`Settings.path.compilesDir`): Working directory during compilation. Contains `.tex` files, intermediate files, and `output.pdf` briefly.
- **Output dir** (`Settings.path.outputDir`): Final destination after `_saveOutputFiles`. Contains build subdirectories (hex timestamp IDs) with `output.pdf` (qpdf-optimized) and auxiliary files.
- Build subdirectory naming: starts with a hex timestamp, so `.sort().reverse()` gives newest-first.

### Per-user vs shared CLSI routes

CLSI has two route patterns:
- Shared: `/project/:project_id/compile`
- Per-user: `/project/:project_id/user/:user_id/compile`

The web module's `clsiUrl()` helper picks the right pattern based on `Settings.disablePerUserCompiles`. Always use this helper — don't hardcode URLs.

### Settings paths for CLSI directories

Defined in `services/clsi/config/settings.defaults.cjs`:
- `path.compilesDir` — working compile directory
- `path.outputDir` — final output directory with build subdirs
