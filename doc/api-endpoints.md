# API Endpoints

All HTTP endpoints used by the LLM Agent system, organized by service.

## Public Endpoints (web module)

### `POST /project/:project_id/agent/message`

The main entrypoint connecting the frontend chat panel to the backend LLM pipeline.

**Auth:** Requires authenticated session + read access to the project (existing middleware enforces both). CSRF token required in `x-csrf-token` header.

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
| `conversationId` | string (ObjectId hex) | no | If absent, a new thread is created. Must be a valid 24-char hex ObjectId |
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
| `conversationId` | The thread ID to pass back on the next message in the same conversation. |

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
- POST to `/project/:pid/agent/message` with CSRF token in `x-csrf-token` header
- Store `conversationId` from the 202 response; pass it in subsequent messages
- Show user message immediately (optimistic) — don't wait for the WebSocket event
- Show spinner/pending state after 202 until `new-chat-message` arrives with the agent's reply
- Agent messages have `user_id` = the agent's user ID — detect this to style differently
- The `runId` can be shown in an admin/debug panel as a link to `/admin/agent/runs/:runId` (not yet implemented)

## Internal Endpoints (web module → llm-agent)

These use Basic auth (`requirePrivateApiAuth()`), not session cookies.

### `POST /project/:projectId/run`

Called by the web module to start an agent run.

**Request body:**
```json
{
  "userId": "...",
  "conversationId": "...",
  "userMessage": "...",
  "selection": { "docId": "...", "fromLine": 0, "toLine": 5, "content": "..." },
  "context": {
    "projectName": "...",
    "compiler": "pdflatex",
    "files": [{ "path": "main.tex", "docId": "..." }]
  }
}
```

**Response — HTTP 200:**
```json
{ "runId": "..." }
```

## Internal Endpoints (llm-agent → web module)

These are called by llm-agent tools. All use Basic auth.

| Route | Method | Purpose |
|---|---|---|
| `/internal/project/:pid/agent/complete` | POST | llm-agent calls after run finishes → emits agent reply via WebSocket |
| `/internal/project/:pid/agent/create-file` | POST | Create a new document in the project |
| `/internal/project/:pid/agent/delete-file` | POST | Delete a document by path |
| `/internal/project/:pid/agent/move-file` | POST | Rename or move a document (with rollback on failure) |
| `/internal/project/:pid/agent/compile` | POST | Trigger CLSI compile, return `{success, status, errors, pageCount}` |
| `/internal/project/:pid/agent/pdf-page` | GET | Get a PDF page as base64 PNG |
| `/internal/project/:pid/agent/syntax-check` | GET | Run structural analysis, return `{issues}` |

**Registration order:** Internal routes are registered in `applyNonCsrfRouter()` which runs before CSRF middleware is attached to `webRouter`. See `LlmAgentRouter.mjs`.

## Internal Endpoints (document-updater)

### `POST /project/:pid/doc/:did/agent-replace`

Surgical edit via `{old_text, new_text}`. The primary editing primitive.

**Request body:**
```json
{
  "old_text": "exact text to replace",
  "new_text": "replacement text",
  "user_id": "..."
}
```

**Responses:**
| Status | Meaning |
|---|---|
| 204 | Change applied successfully |
| 404 | `old_text` not found in document |
| 409 `AMBIGUOUS_OLD_TEXT` | `old_text` appears multiple times |
| 409 | Edit conflict; re-read and retry |

**Server logic:** Fetch current lines from Redis → join as string → find `old_text` offset → build op `[{p, d: old_text}, {p, i: new_text}]` → call `UpdateManager.applyUpdate()` with `meta.tc` set.

Failure mode: `old_text` not found → 404. Clean, detectable, not a silent corruption. Indicates the document changed during the LLM call.

## Internal Endpoints (CLSI)

### `GET /project/:project_id/user/:user_id/pdf-info`

Returns `{ pageCount: number }` from `pdfinfo`. Returns 404 if no compiled PDF exists.

### `GET /project/:project_id/user/:user_id/pdf-page?page=N`

Returns a PNG image (150 dpi) of page N as `image/png`. Returns 404 if no PDF or page out of range.

Both routes are registered in `services/clsi/app.js`. Implementation in `CompileManager.js`:
- `findPdfPath(projectId, userId)` — locates the most recent `output.pdf` by checking the output dir first (where qpdf optimization places it), iterating builds in reverse chronological order, then falling back to the compile dir.
- `getPdfInfo()` — runs `pdfinfo` on the located PDF.
- `getPdfPage()` — runs `pdftoppm -png -r 150 -f N -l N` with a temp file (stdout mode is broken in poppler 22.12.0).

## Track-Changes Module Endpoints

| Method | Path | Auth | Action |
|---|---|---|---|
| `GET` | `/project/:id/ranges` | read | Return all doc ranges from document-updater. |
| `POST` | `/project/:id/track_changes` | write/review | Toggle track-changes globally (`on`), per-user (`on_for`), or for guests (`on_for_guests`). |
| `POST` | `/project/:id/doc/:doc_id/changes/accept` | write/review | Accept listed change IDs; broadcasts `accept-changes` via Socket.io. |
| `POST` | `/project/:id/doc/:doc_id/changes/reject` | write/review | Reject listed change IDs; broadcasts `reject-changes` with the IDs that were actually rejected. |

## Health Check

### `GET /health`

All services expose this. Returns HTTP 200.
