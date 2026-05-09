# Chat Integration

## What the Current Chat System Is

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

## What We Reuse Directly

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

## What We Modify

### `ChatManager.mjs` — User Enrichment

Batch-fetches real users by ID to inject `{first_name, last_name, email}` into messages. Agent messages have no MongoDB user document. Added a branch: if `user_id` matches the configured agent ID, inject agent metadata instead `{name: "Agent", avatar: "...", isAgent: true}`.

*Change: ~15 lines in one existing function.*

### `LlmAgentController.mjs` — Agent Message Handler

`POST /project/:pid/agent/message` handles the full flow: validate auth, save user message to chat, emit via WebSocket, kick off `AgentManager.run()` asynchronously, and return HTTP 202 immediately. This is a new handler in the web module, not a modification of the existing chat `sendMessage`.

*New function: ~60 lines in web module.*

### Frontend `AgentChatContext`

Forked from `ChatContext` to parameterize on `conversationId` and add a `pending` state for in-flight LLM responses. Manages optimistic user message display and spinner clearing when the agent reply arrives via `new-chat-message` WebSocket event.

*Fork + extend: ~80 lines of new context code in web module frontend.*

## The Main Entrypoint: `POST /project/:pid/agent/message`

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
    2. Build model via `createModel(agent.model)`, tools via `buildTools(runCtx, agent.allowedTools)`
    3. Call Vercel AI SDK `generateText({ model, tools, messages })` in a loop up to `agent.maxSteps`
    4. For each tool call: execute, record step in Run document
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

## New Files Required

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
