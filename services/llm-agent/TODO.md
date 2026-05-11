# Agent Tool Bugs — To Fix

Discovered during run `6a01e1e325608253e788c5bd` (2026-05-11, `@deepseek/deepseek-v4-pro`, `e2e-complex-paper.mjs`).
The run passed all 25 assertions but burned ~15–20 steps fighting these two bugs.

---

## Bug 1 — Stale `ctx.context.files`: create/delete/move don't update the shared file list

**Impact:** High. Caused 20 of 71 tool outputs to be synthesized failures in one run.

**What happened:**
`ctx.context.files` is populated once at run start from the project snapshot and never mutated.
Tools that depend on it are broken for any file created during the run:

- `list_files` — returned `[{"path":"main.tex"}]` at steps 0, 2, and 15, even after 18 files
  were created at steps 5–8. The agent was blind to its own work.
- `read_file` — looks up `docId` from `ctx.context.files` by path. Throws synchronously for
  any path not present at run start → 16 failed calls, all on `figures/*.tex` / `sections/*.tex`.
- `edit_file` — same `docId` lookup → 4 failed calls.
- `get_outline` — same mechanism; not exercised in this run but equally broken.

**Fix:**
After a successful HTTP response, each mutating tool should update `ctx.context.files` in-place
(the object is passed by reference, so mutation is enough — no extra plumbing needed):

| Tool | Action |
|---|---|
| `create_file` | Push `{ path, docId }` (as returned by the web endpoint) |
| `delete_file` | Splice out the entry matching `path` |
| `move_file` | Update the `path` field of the matching entry |

**Files to change:**
- `app/js/tools/create_file.js`
- `app/js/tools/delete_file.js`
- `app/js/tools/move_file.js`

---

## Bug 2 — Misleading synthesized error: "timed out or failed" for a synchronous throw

**Impact:** Medium. Wastes several steps on futile serial retries before the agent gives up.

**What happened:**
When `read_file` / `edit_file` throw because a path isn't in `ctx.context.files`, the Vercel AI SDK
doesn't include the call in `toolResults`. `AgentManager` then synthesizes:

> "Tool read_file did not return a result (timed out or failed). Try a smaller request, or call
> this tool alone instead of in parallel."

This is wrong in two ways:
1. The real cause is a synchronous throw ("path not in context files"), not a timeout or parallelism issue.
2. The suggestion ("try calling alone") is useless — the call fails identically when called alone.

The agent wasted 7 steps re-trying `read_file`/`edit_file` on `figures/performance_bars.tex`
serially before resorting to delete + recreate (which was the right move from the start).

**Fix (prefer option B):**
- **Option A** — Catch throws inside the tool wrapper in `buildTools` (`app/js/tools/index.js`)
  and return an informative error string instead of rethrowing.
- **Option B** — Have `read_file`, `edit_file`, `get_outline` return an error string (not throw)
  when the path is unknown. This is consistent with how those tools already handle HTTP errors.
  The `throw` for unknown paths is an outlier in the existing convention.

**Note:** Once Bug 1 is fixed, newly created files will be findable and most of these failures
will disappear. Bug 2 is still worth fixing for robustness against any future lookup failures.

**Files to change:**
- `app/js/tools/read_file.js`
- `app/js/tools/edit_file.js`
- `app/js/tools/get_outline.js`
  (or `app/js/tools/index.js` if taking option A)
