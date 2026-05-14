# Track-Changes Integration

**Branch:** `feature/llm-agent-tools`

## Overview

This change fully enables the Overleaf track-changes system and adds a two-tier diff visualization in the editor: a standard inline rendering for user edits, and a paragraph-level (block) rendering for agent edits. It also ships a floating inline-action chip that lets users accept or reject individual changes without opening the review panel.

## Goals

1. Activate track-changes as a first-class feature (ships as a disabled module in upstream Overleaf CE).
2. Propagate a `source` field through the entire stack (`agent` vs. default/user) so the UI can render agent edits differently.
3. Show deleted text in-editor (previously the widget was an invisible marker).
4. Provide per-change accept/reject chips rendered directly in the editor viewport.
5. Add bulk accept/reject by source to the `RangesContext` API.
6. Fix a CM6 constraint: block decorations must come from a `StateField`, not a `ViewPlugin`.

## Backend Changes

### document-updater: `HttpController.js`

`agentReplace` is now a thin delegating handler:

- Validates `old_text`, `new_text`, `user_id` are present.
- No-op guard: `oldText === newText` → 204 (avoids wasted version bump and history entry).
- Delegates to `DocumentManager.promises.agentReplaceWithLock()`.
- Returns 404 with error body if `old_text` not found.

### document-updater: `DocumentManager.js` — Consolidation + Per-Line Hunks

This is the core of the agent editing pipeline. Two new functions:

#### `computeLineHunks(oldText, newText)`

Uses `diff-match-patch` line-mode diff to compute the minimal set of line-level change hunks. Each hunk carries:
- `hunkOld` — the old text for this hunk
- `hunkNew` — the new text for this hunk  
- `oldOffset` — byte offset within `oldText` where this hunk starts

Result is in document order (top → bottom). When applied bottom-up, each hunk's position is unaffected by hunks below it.

#### `agentReplaceWithLock(projectId, docId, oldText, newText, userId)`

1. **Split** `oldText → newText` into per-line hunks via `computeLineHunks()`.
2. **Lock** the document so no concurrent edits shift positions.
3. **Find `oldText` once** to get a stable `basePos`, then pass `posHint = basePos + hunkOffset` to each hunk. This prevents ambiguous `indexOf` when a hunk's content is not unique in the file.
4. **Apply hunks bottom-up** — earlier positions stay stable.
5. **Each hunk calls `agentReplace()`**, which performs the consolidation pass (see below).

#### `agentReplace(projectId, docId, oldText, newText, userId, posHint)` — Consolidation Pass

Why consolidation exists: when the ranges-tracker processes a delete that overlaps an existing tracked insert, it silently absorbs the insert, strips overlapping content from the new delete's `d` field, but keeps the original position. The stored op ends up with content that doesn't match the document anywhere. Consolidation fixes this by producing a single clean (oldest → newest) pair per affected region.

**Algorithm:**
1. **Capture BEFORE state** — the only point where original text in the affected region is still recoverable.
2. **Find agent changes in region** — two passes:
   - Direct overlap with `[pos, opEnd)` (inserts overlapping, deletes strictly inside).
   - Paired pickup — a tracked delete at exactly `insert.p + insert.length` (the `canAggregate` convention) is the oldest half of an already-included insert. Include it so reconstruction sees the full pair.
   - If any **user** change overlaps, mark `mixedWithUser = true` and skip consolidation entirely.
3. **Reconstruct OLDEST text** — walk visible content, splice in tracked-delete content, skip tracked-insert content.
4. **Apply OT update** normally (`[{p, d: oldText}, {p, i: newText}]`) with `meta: { user_id, tc: seed, source: 'agent' }`.
5. **Fast path** — if no prior agent changes overlap (or mixed with user), standard OT path is already clean. Return 204.
6. **Capture AFTER state** and extract NEWEST text for the region.
7. **Drop every agent tracked change inside the post-update region** and append a single clean pair:
   - Insert `newVersionText` at `regionStart` (id: `tcSeed-i`)
   - Delete `oldVersionText` at `regionStart + newVersionText.length` (id: `tcSeed-d`)
   - Both tagged with `metadata: { user_id, ts, source: 'agent' }`
8. **Write back** via `RedisManager.updateDocument` with empty ops (visible content already correct).

**Boundary condition fixes** (Greptile-identified):
- **P1a** — overlap check used `cStart <= opEnd` (closed end), including an unrelated delete anchored right after the last character. Fixed to strict `<`.
- **P1b** — `inRegion` filter used `cStart <= newRegionEnd`, which could discard an unrelated pre-existing delete that shifted to exactly the right boundary. Fixed: strict `<` only for truly unrelated pre-existing changes; OT-generated and region-member changes keep inclusive `<=`.
- **P2** — no-op guard was only in `HttpController`; direct callers of `agentReplace` would still apply a delete-then-reinsert op. Fixed: guard lives in `agentReplace` itself.

### document-updater: `RangesManager.js`

When applying an op to the `rangesTracker`, the `source` field from `update.meta` is now forwarded: `rangesTracker.applyOp(op, { user_id, source })`. This is what persists `source: 'agent'` into the stored change metadata that eventually reaches the frontend.

### Web Module: `services/web/modules/track-changes/`

A self-contained Overleaf web module:

| File | Purpose |
|---|---|
| `index.mjs` | Module entry point. Monkey-patches `ProjectEditorHandler` to set `features.trackChanges = true` and `features.trackChangesVisible = true`. |
| `app/src/TrackChangesRouter.mjs` | Registers four authenticated routes. |
| `app/src/TrackChangesController.mjs` | Implements the four route handlers. |
| `test/unit/src/TrackChangesController.test.mjs` | Vitest unit tests. |

**Module registration:** `track-changes` is inserted into `moduleImportSequence` immediately before `launchpad` in `services/web/config/settings.defaults.js`.

## Frontend Changes

### `types/change.ts`

Added `source?: string` to the `Change.metadata` type.

### `frontend/js/features/ide-react/editor/document-container.ts`

- `Message.meta` now includes `source?: string`.
- When applying remote ops, `source` is extracted from the message metadata and forwarded to `rangesTracker.applyOp`, so remote agent changes are tagged correctly.

### `frontend/js/features/review-panel/context/track-changes-state-context.tsx`

- **Optimistic UI**: `saveTrackChanges` now updates local state immediately before the HTTP call resolves.

### `frontend/js/features/review-panel/context/ranges-context.tsx`

Added two new actions:
- `acceptAllChangesBySource(source)` — filters by `metadata?.source` and bulk-accepts.
- `rejectAllChangesBySource(source)` — filters by `metadata?.source` and bulk-rejects.

### `frontend/js/features/review-panel/components/review-panel-change.tsx`

- Detects `isAgentChange = change.metadata?.source === 'agent'`.
- Renders an `"Agent"` source pill badge next to the author name.

### `frontend/js/features/source-editor/extensions/ranges.ts`

**Problem solved:** CM6 only allows block decorations (those that shift line positions) from `StateField`, not `ViewPlugin`.

**New `agentBlockDeleteField` (StateField)** — A dedicated `StateField<DecorationSet>` that handles block decorations for agent edits only.

**Refactored `buildChangeDecorations`** — Split into three focused helpers:
- `createInlineDeleteWidget(change, position, side)` — for regular user deletes.
- `createBlockDeleteWidget(change, lineStart)` — for agent deletes (full-width block widget).
- `createInsertOrCommentMark(change, data)` — for inserts and comments.

**`buildAgentBlockDecorations`** — Iterates changes tagged `source === 'agent'`:
- **Delete**: places a block widget at the start of the line, showing the old text in a red band.
- **Insert**: applies `Decoration.line({ class: 'ol-cm-line-agent-insert' })` to every editor line covered.

**`ChangeDeletedWidget`** — Now accepts a `block: boolean` flag. Renders `<div>` (block) or `<span>` (inline). Adds `ol-cm-change-agent` class when `metadata?.source === 'agent'`.

### `frontend/js/features/source-editor/components/codemirror-editor.tsx`

Mounts `<InlineChangeActions />` inside `CodeMirrorEditorComponents`, guarded by `features.trackChangesVisible`.

### `frontend/js/features/source-editor/hooks/use-codemirror-scope.ts`

Previously the `updateRanges` dispatch was gated on both `ranges && threads`. Now dispatches immediately when `ranges` is available, using `threads ?? {}` as a safe fallback.

### `frontend/js/features/review-panel/components/inline-change-actions.tsx` *(new)*

Renders floating accept/reject chips directly in the editor viewport via `ReactDOM.createPortal` into `document.body`.

- Positions chips using `view.coordsAtPos(change.op.p)`, offset upward by 26 px.
- Collapses paired insert+delete changes (substitutions) into a single chip.
- Re-measures positions on scroll and resize events.
- Chips are labelled `"Agent"` or `"you"` and colored differently (red border for agent, blue for user).

## Visual Rendering

| Change type | Decoration | Color |
|---|---|---|
| User insert | Inline mark on text | Blue tint |
| User delete | Inline `<span>` widget with deleted text | Pink/red dotted border |
| User substitution (insert + paired delete) | Delete widget placed at insert point | Pink border, side=-1 |
| Agent insert | `Decoration.line` on all covered lines | Green tint (whole line) |
| Agent delete | Block `<div>` widget above the new line | Red band (full width) |

## Data Flow: Agent Edit → Diff Display

```
LLM Agent (editFile tool)
  │  POST /project/:id/doc/:docId/agent-replace
  │  { old_text: "...", new_text: "...", user_id: "..." }
  ▼
document-updater: HttpController.agentReplace
  │  validates, no-op guard, delegates to agentReplaceWithLock
  ▼
document-updater: DocumentManager.agentReplaceWithLock
  │  1. computeLineHunks(oldText, newText) → [hunk1, hunk2, ...]
  │  2. lock document
  │  3. find oldText once → basePos
  │  4. for each hunk (bottom-up):
  │       agentReplace(projectId, docId, hunkOld, hunkNew, userId, posHint)
  ▼
document-updater: DocumentManager.agentReplace (per hunk)
  │  1. capture BEFORE state ranges
  │  2. find overlapping agent changes; skip if mixed with user
  │  3. reconstruct OLDEST text from visible + tracked-delete content
  │  4. apply OT update [{p, d: oldText}, {p, i: newText}] with meta.tc + source: 'agent'
  │  5. capture AFTER state, extract NEWEST text
  │  6. drop messy agent changes in region, write single clean (insert, delete) pair
  │  7. RedisManager.updateDocument with empty ops
  ▼
document-updater flushes via OT → real-time service → Socket.io
  │  broadcast: otUpdateApplied { op, meta: { tc, user_id, source: 'agent' } }
  ▼
Frontend: DocumentContainer.updateDoc
  │  source extracted from remote message meta
  │  rangesTracker.applyOp(op, { user_id, source: 'agent' })
  ▼
Frontend: ranges-context rebuilds RangesData
  ▼
CM6 StateField/ViewPlugin: ranges extension
  │  agentBlockDeleteField → block delete widget (red band)
  │  buildAgentBlockDecorations → Decoration.line (green line tint)
  ▼
InlineChangeActions component
  │  coordsAtPos → positions chip in viewport
  ▼
track-changes module: POST /changes/accept or /changes/reject
  ▼
All connected clients update their ranges
```

## Key Invariants

- **`source` is never set for user edits** — only agent-originated ops include `source: 'agent'`. The absence of `source` means the change is from a human user.
- **`canAggregate`** — two changes form a substitution when: same `user_id`, and the delete position equals the insert position plus the insert length.
- **Block decorations from `StateField` only** — CM6 rules forbid block decorations from `ViewPlugin`. All agent block/line decorations live in `agentBlockDeleteField` (`StateField`), while user inline decorations live in the `ViewPlugin`.
- **Position from `cursor.from`** — when rebuilding a widget on hover/focus, position is read from the live cursor, not from a value stored at construction time, preventing drift after user edits.
- **One clean pair per region** — after consolidation, the affected region contains exactly one insert + one delete (or just one of them if the edit was pure insertion/deletion). No messy overlapping fragments remain.
- **User changes are sacred** — if any user-sourced tracked change overlaps the edit region, consolidation is skipped entirely. The standard OT path handles it; we never drop or rewrite a user's change.
- **Bottom-up hunk application** — hunks are applied in reverse document order so each hunk's position is unaffected by hunks below it.
- **No-op edits are free** — `oldText === newText` returns 204 immediately, producing no version bump, no history entry, no tracked change.
