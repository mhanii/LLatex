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

- **`agentReplace` handler** — switched the `tc` (tracked-change ID seed) from a raw `ObjectId` string to `RangesTracker.generateIdSeed()`, which produces the correct format for the ranges tracker.
- Changed `source` from `'llm-agent'` to `'agent'` to match the value checked on the frontend.

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
LLM Agent
  │  POST /project/:id/doc/:docId/agent-replace
  │  { ops: [{i: "new text", d: "old text", p: N}], meta: { user_id, source: 'agent' } }
  ▼
document-updater: HttpController.agentReplace
  │  tc seed generated by RangesTracker.generateIdSeed()
  │  source: 'agent' in update.meta
  ▼
document-updater: RangesManager.applyUpdate
  │  rangesTracker.applyOp(op, { user_id, source: 'agent' })
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
