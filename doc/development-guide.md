# Development Guide

## Implementation Status

### Completed (Steps 1–4)

| Step | What was built | Verified by |
|---|---|---|
| 1 | `services/llm-agent/` skeleton — app.js, server.js, MongoDB connection, `/health` | `curl llm-agent:3055/health` → 200 |
| 2 | `AgentStore` (createRun/appendStep/finalizeRun) + `agent_runs` MongoDB collection | run doc appears with `status: done` after POST |
| 3 | `AgentManager.run()` stub — immediately finalizes run as `{ type: 'text', content: 'stub' }` | durationMs recorded, output.type = 'text' |
| 4 | Web module gateway — `POST /project/:pid/agent/message` with auth, chat storage, WebSocket emit | HTTP 202 + `{ runId, messageId, conversationId }` |

### Development Sequence

1. `services/llm-agent/` skeleton — health endpoint, starts in Docker. ✅ done
2. Run storage — `AgentStore` + MongoDB. ✅ done
3. Web module backend — auth route + `POST /project/:pid/agent/message`. ✅ done
4. `AgentManager` stub — run finalizes immediately as done. ✅ done
5. Provider interface — `LlmProvider.js` with one real provider.
6. Real agent response — `AgentManager.run()` calls the LLM, stores reply in chat.
7. `agent-replace` endpoint on `document-updater`.
8. Tool loop — agent calls `get-outline`, `read-file`, `compile-and-check` in sequence.
9. Rail sidebar — `AgentPanel` with `AgentChatContext` forked from `ChatContext`.
10. CM6 selection — selected text arrives in the sidebar panel.
11. End-to-end — user message in → agent reply appears in panel via WebSocket.

## How to Add a New Service

**1. Create the directory and `package.json`**

```
services/llm-agent/
  package.json
  app.js
  app/js/server.js
  config/settings.defaults.cjs
```

Copy `services/chat/package.json`. Change `name` to `@overleaf/llm-agent`. Keep `@overleaf/logger`, `@overleaf/metrics`, `@overleaf/settings` as dependencies.

**2. Register as a workspace**

In root `package.json`, add `"services/llm-agent"` to the `workspaces` array. Run `npm install` from the repo root.

**3. Write the entry point**

Copy `services/chat/app.js` verbatim. Change the logger name, settings key, and import of `server.js`.

**4. Write `settings.defaults.cjs`**

```js
module.exports = {
  internal: {
    llmAgent: { host: process.env.LLM_AGENT_HOST || '127.0.0.1', port: 3055 },
  },
}
```

Pick a port not used by any existing service. Check `develop/dev.env`.

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

**6. Add to `develop/docker-compose.yml`**

Copy the `chat:` block. Change the service name, Dockerfile path, and env vars.

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
```

## How to Add an API Endpoint

### Internal endpoint (inside `services/llm-agent/`)

Add a route in `app/js/server.js`:

```js
app.post('/project/:projectId/run', AgentController.startRun)
```

`AgentController.startRun` reads the body, writes a run document, kicks off `AgentManager.run()`, and responds with `{ runId }`. No auth — the web module is the only caller.

### Public endpoint (inside `services/web/modules/llm-agent/`)

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

4. Create `LlmAgentApiHandler.mjs` — calls `services/llm-agent/` via `fetchJson` from `@overleaf/fetch-utils`.

5. Modules are auto-loaded from `services/web/modules/` — no registration needed beyond creating `index.mjs`.

## How to Add the `agent-replace` Endpoint to Document-Updater

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

## The `meta.tc` Flag

This is the only thing that distinguishes our edits from Dropbox sync (which uses the same HTTP path). `RangesManager.js:47`:

```javascript
rangesTracker.track_changes = Boolean(update.meta?.tc)
```

Set it → tracked change. Unset → silent overwrite. Everything else in the pipeline is identical.

## Gotchas & Debugging Notes

### CLSI PDF Path Resolution (Bug #1 — fixed)

**Problem:** `getPdfPage` returned HTTP 502 after successful compiles.

**Root cause:** The compile pipeline runs `_saveOutputFiles` which moves the PDF from the compile dir to the output dir (for qpdf optimization). `getPdfPage` was only looking in the compile dir.

**Fix:** `findPdfPath()` checks the output dir first, iterating builds in reverse order (hex timestamps sort chronologically), returning the first build that has an `output.pdf`. Falls back to compile dir for the brief window during compile or legacy setups.

### pdftoppm Stdout Produces 0 Bytes (Bug #1 — related)

**Problem:** `pdftoppm -png -r 150 -f 1 -l 1 output.pdf -` (stdout mode) returns 0 bytes in the CLSI container's poppler version (22.12.0).

**Fix:** Use a temp file instead. `pdftoppm` appends the page number to the filename prefix, so the output file is `${tmpPrefix}-${page}.png`. Clean up in `finally` block.

### SyntaxChecker Misses Edits (Bug #2 — fixed)

**Problem:** After `editFile` modifies a document, `checkSyntax` still sees the old content.

**Root cause:** `SyntaxChecker` was reading document lines from MongoDB, which is stale until a flush occurs. `editFile` writes to Redis (document-updater) — the live source of truth.

**Fix:** Read from `DocumentUpdaterHandler.promises.getDocument()` instead of MongoDB. Falls back to MongoDB lines if the doc isn't in Redis yet.

### Table Mismatch Error Detection (Bug #2 — related)

**Problem:** Test assertion checked for `"Unclosed"` in the error message, but an unclosed `\begin{table}` produces a mismatch error like `"\\end{document} at line N doesn't match \\begin{table} at line M"`.

**Fix:** Check for `"table"` in any issue message instead of looking for `"Unclosed"`.

### bcrypt in Test Scripts

The test script (`test-tools.mjs`) needs `bcrypt` to hash passwords when creating new test users. `bcrypt` is available inside the web container but not the llm-agent container. Workaround: pre-create the user via the web container and use `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars.

### `ctx.context.files` Must Be Updated After createFile

After `createFile` returns a new `{path, docId}`, the test script (and any tool orchestration code) must push this entry into `ctx.context.files`. Otherwise subsequent tools like `readFile` or `editFile` won't find the docId and will fail.

### CLSI Compile Dir vs Output Dir

- **Compile dir** (`Settings.path.compilesDir`): Working directory during compilation. Contains `.tex` files, intermediate files, and `output.pdf` briefly.
- **Output dir** (`Settings.path.outputDir`): Final destination after `_saveOutputFiles`. Contains build subdirectories (hex timestamp IDs) with `output.pdf` (qpdf-optimized) and auxiliary files.
- Build subdirectory naming: starts with a hex timestamp, so `.sort().reverse()` gives newest-first.

### Per-User vs Shared CLSI Routes

CLSI has two route patterns:
- Shared: `/project/:project_id/compile`
- Per-user: `/project/:project_id/user/:user_id/compile`

The web module's `clsiUrl()` helper picks the right pattern based on `Settings.disablePerUserCompiles`. Always use this helper — don't hardcode URLs.

### Settings Paths for CLSI Directories

Defined in `services/clsi/config/settings.defaults.cjs`:
- `path.compilesDir` — working compile directory
- `path.outputDir` — final output directory with build subdirs

### Stale-Read Risk

The LLM reads the document, processes for 2–10 seconds, then posts the edit. If another user edited the same span during that window, `old_text` won't be found → clean 404. The agent layer handles this by retrying with a fresh document read. No corruption is possible.
