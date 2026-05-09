# Agent Tools

All tools live in `services/llm-agent/app/js/tools/` and follow a 3-layer call chain:

```
llm-agent tool (services/llm-agent/)
  → web module internal route (services/web/modules/llm-agent/)
    → downstream service (CLSI, document-updater, or web service internals)
```

The catalog is consolidated in a single registry — `tools/registry.js` is the only place a tool's name, description, Zod schema, and raw execute function are defined. Any runtime that needs ctx-bound tools (e.g. for a particular agent) calls `buildTools(ctx, toolNames?)` from `tools/index.js`, which wraps registry entries into Vercel AI SDK `tool()` form. See [Agents](./agents.md) for how agents declare which tools they can use.

## RunContext

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

## Tool Inventory

| Tool | File | Internal route | Downstream |
|---|---|---|---|
| `listFiles` | `list_files.js` | (none — reads ctx.files) | — |
| `readFile` | `read_file.js` | (none — reads ctx.files) | document-updater `/project/:pid/doc/:did` |
| `getOutline` | `get_outline.js` | (none — reads ctx.files) | document-updater `/project/:pid/doc/:did` |
| `editFile` | `edit_file.js` | (none — reads ctx.files) | document-updater `/project/:pid/doc/:did/agent-replace` |
| `createFile` | `create_file.js` | `POST /internal/.../agent/create-file` | `EditorController.upsertDocWithPath` |
| `deleteFile` | `delete_file.js` | `POST /internal/.../agent/delete-file` | `EditorController.deleteEntityWithPath` |
| `moveFile` | `move_file.js` | `POST /internal/.../agent/move-file` | `EditorController.moveEntity` + `renameEntity` |
| `compileAndCheck` | `compile_and_check.js` | `POST /internal/.../agent/compile` | CLSI compile + `pdf-info` + ported log parsers |
| `checkSyntax` | `check_syntax.js` | `GET /internal/.../agent/syntax-check` | `SyntaxChecker.check()` (Redis + MongoDB) |
| `getPdfPage` | `get_pdf_page.js` | `GET /internal/.../agent/pdf-page` | CLSI `pdf-page` endpoint |

## Tool Details

### `listFiles`

Returns project file tree from `ctx.context.files`. No network call needed.

```js
listFiles({}, ctx) → [{ path: "main.tex" }, { path: "references.bib" }]
```

### `readFile`

Read lines from a LaTeX file, optionally sliced to a 1-indexed inclusive range.

```js
readFile({ path: "main.tex", fromLine?: number, toLine?: number }, ctx) → "1: \\documentclass{article}\n2: ..."
```

Calls document-updater `/project/:pid/doc/:did/peek`. Returns numbered lines as a string.

### `getOutline`

Parse document structure — extracts `\chapter`, `\section`, `\subsection`, `\subsubsection`, and `\begin{...}` entries with line numbers.

```js
getOutline({ path: "main.tex" }, ctx) → [
  { type: "section", title: "Introduction", lineNumber: 5 },
  { type: "begin:figure", title: "figure", lineNumber: 12 }
]
```

### `editFile`

Replace exact text in a file as a tracked change via `agent-replace` endpoint.

```js
editFile({ path: "main.tex", oldText: "...", newText: "..." }, ctx) → "Change applied."
```

Re-reads the file first to get exact text. If `old_text` is not found, re-read and retry. Returns human-readable error messages for the LLM to act on.

### `createFile`

Create a new file in the project.

```js
createFile({ path: "chapter2.tex", content?: string }, ctx) → { path: "chapter2.tex", docId: "..." }
```

After calling this, push the returned `{path, docId}` into `ctx.context.files` so subsequent tools can find it.

### `deleteFile`

Delete a file from the project.

```js
deleteFile({ path: "old.tex" }, ctx) → "Deleted."
```

### `moveFile`

Rename or move a file within the project.

```js
moveFile({ oldPath: "draft.tex", newPath: "final.tex" }, ctx) → "Moved."
```

### `compileAndCheck`

Compile the project and return the same structured log entries the editor shows the user.

```js
compileAndCheck({ path?: string }, ctx) → {
  success: false,
  status: "failure",
  errors: [
    {
      level: "error",
      file: "./main.tex",
      line: 5,
      message: "Undefined control sequence.",
      ruleId: "hint_undefined_control_sequence",
      command: "\\badcmd"
    }
  ],
  warnings: [
    {
      level: "warning",
      file: "./main.tex",
      line: 7,
      message: "Reference `fig:1' on page 1 undefined on input line 7.",
      ruleId: "hint_reference_on_page_undefined"
    }
  ],
  typesetting: [],   // overfull/underfull \hbox / \vbox
  pageCount: null     // populated only on success
}
```

Optionally specify `path` to compile a different root document. `pageCount` comes from `pdfinfo` (only on success) so the agent knows the valid page range before calling `getPdfPage`.

**Where the log entries come from.** Backend mirrors the frontend pipeline:

1. `CompileManager.promises.compile()` returns `outputFiles` (CLSI's list of compiler output paths).
2. `services/web/modules/llm-agent/app/src/parsers/LogParser.mjs` fetches `output.log` and every `*.blg` directly from CLSI.
3. The bytes go through the same parsers the editor uses — `latex-log-parser.mjs` → `HumanReadableLogs.mjs` (rule-based message rewrites + `ruleId` tagging + cascading-error suppression), and `bib-log-parser.mjs` for `.blg` files.

These four parser files (`latex-log-parser.mjs`, `bib-log-parser.mjs`, `HumanReadableLogs.mjs`, `HumanReadableLogsRules.mjs`, `HumanReadableLogsPackageSuggestions.mjs`) are direct ports of `services/web/frontend/js/ide/log-parser/*` and `services/web/frontend/js/ide/human-readable-logs/*`. Each port carries an upstream sha header and a refresh procedure — when upstream changes, run `git diff <old-sha>..<new-sha>` against the source file and re-port.

### `checkSyntax`

Run structural analysis on project documents without compiling.

```js
checkSyntax({ path?: string }, ctx) → {
  issues: [
    { type: "undefined-ref", message: "\\ref{fig:missing} has no matching \\label", file: "main.tex" },
    { type: "duplicate-label", message: "\\label{eq:1} defined in main.tex and appendix.tex" },
    { type: "missing-input", message: "\\input{nonexistent.tex} not found in project" },
    { type: "unbalanced", message: "\\end{document} at line 50 doesn't match \\begin{table} at line 42" }
  ]
}
```

Detects:
1. **Undefined `\ref{}`** — cross-file, project-wide
2. **Duplicate `\label{}`** — same key in multiple files
3. **Missing `\input{}`/`\include{}`** — referenced file not in project
4. **Unbalanced `\begin{}`/`\end{}`** — per-file, with line numbers

If `path` is provided, analysis is scoped to that file (cross-file ref checking is skipped). If omitted, all project files are analysed together.

**Critical design decision: reads from Redis, not MongoDB.** Document content is fetched from document-updater so edits are visible immediately — no MongoDB flush required. Fallback: if a doc is not yet in Redis (e.g. freshly created), it falls back to MongoDB lines.

### `getPdfPage`

Return a page of the most recently compiled PDF as a base64-encoded PNG.

```js
getPdfPage({ page: 1 }, ctx) → { imageBase64: "...", mimeType: "image/png" }
```

Call `compileAndCheck` first to ensure an up-to-date PDF exists and to find out the total page count. Page number is 1-indexed.

## Tool Registry

Single source of truth: `services/llm-agent/app/js/tools/registry.js`. Each tool is registered as a `ToolDefinition`:

```js
/**
 * @typedef {Object} ToolDefinition
 * @property {string}        description    shown to the LLM during function calling
 * @property {z.ZodTypeAny}  inputSchema    Zod schema; converted to JSON Schema by the AI SDK
 * @property {(input, ctx: RunContext) => Promise<unknown>} execute   raw async function
 */

export const TOOL_REGISTRY = {
  list_files:  { description: '...', inputSchema: z.object({}),                execute: listFiles  },
  read_file:   { description: '...', inputSchema: z.object({ path: ..., ... }), execute: readFile   },
  // …all 10 tools
}
```

Helpers:

```js
import { getTool, listTools } from './tools/registry.js'

getTool('list_files')     // → ToolDefinition | undefined
listTools()               // → ['list_files', 'read_file', …]   (10 entries)
```

The registry contains no Vercel-specific code — it is portable to any framework that consumes `(description, JSON-schema, async fn)` triples.

## Building tools for a runtime

`services/llm-agent/app/js/tools/index.js` wraps registry entries into Vercel AI SDK `tool()` objects and curries the `RunContext` into each `execute`:

```js
import { buildTools } from './tools/index.js'

const ctx = { projectId, userId, runId, context: { projectName, compiler, files } }

// All tools (default behaviour):
buildTools(ctx)

// Subset, typically driven by an agent's allowedTools:
buildTools(ctx, ['list_files', 'read_file'])

// Throws on unknown names:
buildTools(ctx, ['nonexistent']) // Error: Unknown tool: nonexistent
```

This is the only place that imports `tool` from the `ai` package. Replace it if a different framework is ever used; the registry stays unchanged.

## Testing

### Unit tests (mocha, no network)

```bash
cd services/llm-agent
npm run test:unit
```

Relevant suites:

- `test/unit/tools/registry_test.js` — TOOL_REGISTRY shape, schema validation, `getTool` / `listTools`.
- `test/unit/tools/build_tools_test.js` — `buildTools` selection, unknown-name guard, ctx currying.
- `test/unit/agents/registry_test.js` — agent metadata + cross-validation that every `allowedTools` entry exists in `TOOL_REGISTRY`.
- `test/unit/tools/<tool>_test.js` — per-tool behaviour with stubbed `fetch`.

### Registry round-trip script (Vercel + Portkey, no Docker required)

`services/llm-agent/app/js/scripts/verify-registry.mjs` exercises the full registry → buildTools → Vercel `tool()` → Portkey → model → tool result chain using only `list_files` (which doesn't hit document-updater / web / CLSI):

```bash
LLM_MODEL=@deepseek/deepseek-v4-flash \
  node services/llm-agent/app/js/scripts/verify-registry.mjs
```

Skips Phase 2 cleanly if `PORTKEY_API_KEY` is unset; reports "skipped" with the Portkey trace id if the upstream model is rate-limited (5xx / 429). See [Agents — Verification](./agents.md#verification).

### Full tool-chain integration script (requires Docker)

`services/llm-agent/app/js/scripts/test-tools.mjs` runs 13 steps against a live Docker stack (web, document-updater, CLSI, Mongo). Calls each raw tool function directly — does **not** go through the registry, so it is purely a check that the underlying tools still work:

1. `listFiles` — verifies project file tree
2. `readFile(main.tex)` — reads initial document
3. `createFile(new.tex)` — creates a new document
4. `readFile(new.tex)` — verifies created content
5. `editFile` — applies a surgical edit via `agent-replace`
6. `readFile` again — verifies edit is visible
7. `getOutline` — extracts section structure
8. `checkSyntax` (clean) — zero errors on valid file
9. `compileAndCheck` — triggers compile, expects success
10. `getPdfPage(1)` — renders first page as PNG
11. `editFile` — introduces `\begin{table}` without `\end`
12. `compileAndCheck` — expects compile failure
13. `checkSyntax` (broken) — detects unclosed environment

**Run:**
```bash
cd develop && docker compose -f docker-compose.yml -f docker-compose.dev.yml \
  exec -T -e ADMIN_EMAIL="test@example.com" -e ADMIN_PASSWORD="secret" \
  llm-agent node /overleaf/services/llm-agent/app/js/scripts/test-tools.mjs
```
