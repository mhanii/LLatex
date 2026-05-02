import {
  EditorState,
  StateEffect,
  StateField,
  TransactionSpec,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view'
import {
  AnyOperation,
  Change,
  DeleteOperation,
  InsertOperation,
} from '../../../../../types/change'
import { debugConsole } from '@/utils/debugging'
import {
  isCommentOperation,
  isDeleteOperation,
  isInsertOperation,
  isInsertChange,
  isDeleteChange,
} from '@/utils/operations'
import { Ranges } from '@/features/review-panel/context/ranges-context'
import { Threads } from '@/features/review-panel/context/threads-context'
import { isSelectionWithinOp } from '@/features/review-panel/utils/is-selection-within-op'
import { canAggregate } from '@/features/review-panel/utils/can-aggregate'

type RangesData = {
  ranges: Ranges
  threads: Threads
}

const updateRangesEffect = StateEffect.define<RangesData>()
const highlightRangesEffect = StateEffect.define<AnyOperation>()
const clearHighlightRangesEffect = StateEffect.define<AnyOperation>()

export const updateRanges = (data: RangesData): TransactionSpec => {
  return {
    effects: updateRangesEffect.of(data),
  }
}
export const highlightRanges = (op: AnyOperation): TransactionSpec => {
  return {
    effects: highlightRangesEffect.of(op),
  }
}
export const clearHighlightRanges = (op: AnyOperation): TransactionSpec => {
  return {
    effects: clearHighlightRangesEffect.of(op),
  }
}

export const rangesDataField = StateField.define<RangesData | null>({
  create() {
    return null
  },
  update(rangesData, tr) {
    for (const effect of tr.effects) {
      if (effect.is(updateRangesEffect)) {
        return effect.value
      }
    }
    return rangesData
  },
})

// Empty block widget that React portals the accept/reject chip UI into.
// Placed at the line start of each tracked change with side: -2 so it
// sits above the delete block widget (side: -1) and above the text line.
class ChipContainerWidget extends WidgetType {
  constructor(public readonly changeId: string) {
    super()
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'inline-change-chip-host'
    el.dataset.changeId = this.changeId
    return el
  }

  eq(other: ChipContainerWidget): boolean {
    return other.changeId === this.changeId
  }
}

const buildChipContainerDecorations = (
  data: RangesData,
  state: EditorState
): DecorationSet => {
  if (!data.ranges) return Decoration.none

  const decorations = []
  const changes = data.ranges.changes
  const docLength = state.doc.length
  let i = 0

  while (i < changes.length) {
    const primary = changes[i]
    const next = changes[i + 1]
    const isPaired =
      next &&
      isInsertChange(primary) &&
      isDeleteChange(next) &&
      canAggregate(
        next as Change<DeleteOperation>,
        primary as Change<InsertOperation>
      )

    i += isPaired ? 2 : 1

    try {
      const refPos = primary.op.p
      if (refPos < 0 || refPos > docLength) continue
      const lineStart = state.doc.lineAt(refPos).from
      decorations.push(
        Decoration.widget({
          widget: new ChipContainerWidget(primary.id),
          side: -2,
          block: true,
        }).range(lineStart, lineStart)
      )
    } catch (error) {
      debugConsole.debug('invalid chip container position', error)
    }
  }

  return Decoration.set(decorations, true)
}

const chipContainerField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(updateRangesEffect)) {
        next = buildChipContainerDecorations(effect.value, tr.state)
      }
    }
    return next
  },
  provide: f => EditorView.decorations.from(f),
})

// Block decorations must come from a StateField (not a ViewPlugin) per CM6
// rules. We keep agent's full-paragraph delete widgets here, separate from
// the inline decorations produced by the ViewPlugin below.
const agentBlockDeleteField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(updateRangesEffect)) {
        next = buildAgentBlockDecorations(effect.value, tr.state)
      }
    }
    return next
  },
  provide: f => EditorView.decorations.from(f),
})

/**
 * A custom extension that initialises the change manager, passes any updates to it,
 * and produces decorations for tracked changes and comments.
 */
export const ranges = () => [
  rangesDataField,
  chipContainerField,
  agentBlockDeleteField,
  // handle viewportChanged updates
  ViewPlugin.define(() => {
    let timer: number

    return {
      update(update) {
        if (update.viewportChanged) {
          if (timer) {
            window.clearTimeout(timer)
          }

          timer = window.setTimeout(() => {
            dispatchEvent(new Event('editor:viewport-changed'))
          }, 25)
        }
      },
    }
  }),

  // draw change decorations
  ViewPlugin.define<
    PluginValue & {
      decorations: DecorationSet
    }
  >(
    () => {
      return {
        decorations: Decoration.none,
        update(update) {
          for (const transaction of update.transactions) {
            this.decorations = this.decorations.map(transaction.changes)

            for (const effect of transaction.effects) {
              if (effect.is(updateRangesEffect)) {
                this.decorations = buildChangeDecorations(effect.value)
              } else if (
                effect.is(highlightRangesEffect) &&
                isDeleteOperation(effect.value)
              ) {
                this.decorations = updateDeleteWidgetHighlight(
                  this.decorations,
                  widget =>
                    widget.change.op.p === effect.value.p &&
                    widget.highlightType !== 'focus',
                  'highlight'
                )
              } else if (
                effect.is(clearHighlightRangesEffect) &&
                isDeleteOperation(effect.value)
              ) {
                this.decorations = updateDeleteWidgetHighlight(
                  this.decorations,
                  widget =>
                    widget.change.op.p === effect.value.p &&
                    widget.highlightType !== 'focus',
                  null
                )
              }
            }

            if (transaction.selection) {
              this.decorations = updateDeleteWidgetHighlight(
                this.decorations,
                ({ change }) =>
                  isSelectionWithinOp(change.op, update.state.selection.main),
                'focus'
              )
              this.decorations = updateDeleteWidgetHighlight(
                this.decorations,
                ({ change }) =>
                  !isSelectionWithinOp(change.op, update.state.selection.main),
                null
              )
            }
          }
        },
      }
    },
    {
      decorations: value => value.decorations,
    }
  ),

  // draw highlight decorations
  ViewPlugin.define<
    PluginValue & {
      decorations: DecorationSet
    }
  >(
    () => {
      return {
        decorations: Decoration.none,
        update(update) {
          for (const transaction of update.transactions) {
            this.decorations = this.decorations.map(transaction.changes)

            for (const effect of transaction.effects) {
              if (effect.is(highlightRangesEffect)) {
                this.decorations = buildHighlightDecorations(
                  'ol-cm-change-highlight',
                  effect.value
                )
              } else if (effect.is(clearHighlightRangesEffect)) {
                this.decorations = Decoration.none
              }
            }
          }
        },
      }
    },
    {
      decorations: value => value.decorations,
    }
  ),

  // draw focus decorations
  ViewPlugin.define<
    PluginValue & {
      decorations: DecorationSet
    }
  >(
    view => {
      return {
        decorations: Decoration.none,
        update(update) {
          if (
            !update.transactions.some(
              tr =>
                tr.selection ||
                tr.effects.some(effect => effect.is(updateRangesEffect))
            )
          ) {
            this.decorations = this.decorations.map(update.changes)
            return
          }

          this.decorations = Decoration.none
          const rangesData = view.state.field(rangesDataField)

          if (!rangesData?.ranges) {
            return
          }
          const { changes, comments } = rangesData.ranges
          const unresolvedComments = rangesData.threads
            ? comments.filter(
                comment =>
                  comment.op.t &&
                  rangesData.threads[comment.op.t] &&
                  !rangesData.threads[comment.op.t].resolved
              )
            : []

          for (const range of [...changes, ...unresolvedComments]) {
            if (isSelectionWithinOp(range.op, update.state.selection.main)) {
              this.decorations = buildHighlightDecorations(
                'ol-cm-change-focus',
                range.op
              )
              break
            }
          }
        },
      }
    },
    {
      decorations: value => value.decorations,
    }
  ),

  // styles for change decorations
  trackChangesTheme,
]

// Inline-only decorations. Block decorations live in agentBlockDeleteField
// (CM6 forbids block decorations from ViewPlugins).
const buildChangeDecorations = (data: RangesData) => {
  if (!data.ranges) {
    return Decoration.none
  }

  const decorations = []
  const changes = data.ranges.changes

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    try {
      if (isDeleteChange(change)) {
        const preceding = changes[i - 1]
        const isAgent = change.metadata?.source === 'agent'
        if (isAgent) {
          // Handled by agentBlockDeleteField — skip here.
          continue
        }
        const isPaired =
          preceding &&
          isInsertChange(preceding) &&
          canAggregate(
            change as Change<DeleteOperation>,
            preceding as Change<InsertOperation>
          )
        if (isPaired) {
          // User substitution: place the inline widget at insert.p with
          // side=-1 so old text shows immediately before the new text.
          decorations.push(
            ...createInlineDeleteWidget(
              change as Change<DeleteOperation>,
              preceding.op.p,
              -1
            )
          )
        } else {
          // Solo user delete.
          decorations.push(
            ...createInlineDeleteWidget(
              change as Change<DeleteOperation>,
              change.op.p,
              1
            )
          )
        }
      } else {
        decorations.push(...createInsertOrCommentMark(change, data))
      }
    } catch (error) {
      debugConsole.debug('invalid change position', error)
    }
  }

  for (const comment of data.ranges.comments) {
    try {
      decorations.push(...createInsertOrCommentMark(comment, data))
    } catch (error) {
      debugConsole.debug('invalid comment position', error)
    }
  }

  return Decoration.set(decorations, true)
}

// Block + line decorations for agent edits. Returned from a StateField via
// EditorView.decorations (block and line decorations cannot come from a
// ViewPlugin in CM6).
//
// Agent edits operate at paragraph granularity, so we paint the WHOLE line
// containing the change rather than wrapping the inline text — old text is
// a block widget above the new text's line; new text gets a line decoration
// that tints the entire editor line green.
const buildAgentBlockDecorations = (
  data: RangesData,
  state: EditorState
) => {
  if (!data.ranges) {
    return Decoration.none
  }
  const decorations = []
  const changes = data.ranges.changes
  const docLength = state.doc.length

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    if (change.metadata?.source !== 'agent') continue

    if (isDeleteChange(change)) {
      const preceding = changes[i - 1]
      const isPaired =
        preceding &&
        isInsertChange(preceding) &&
        canAggregate(
          change as Change<DeleteOperation>,
          preceding as Change<InsertOperation>
        )
      const refPos = isPaired ? preceding.op.p : change.op.p
      if (refPos < 0 || refPos > docLength) continue

      try {
        const lineStart = state.doc.lineAt(refPos).from
        decorations.push(
          ...createBlockDeleteWidget(
            change as Change<DeleteOperation>,
            lineStart
          )
        )
      } catch (error) {
        debugConsole.debug('invalid block change position', error)
      }
    } else if (isInsertChange(change)) {
      const op = change.op as InsertOperation
      const from = op.p
      const to = op.p + op.i.length
      if (from < 0 || to > docLength) continue

      try {
        const lineFrom = state.doc.lineAt(from)
        const lineTo = state.doc.lineAt(to)
        for (
          let lineNum = lineFrom.number;
          lineNum <= lineTo.number;
          lineNum++
        ) {
          const line = state.doc.line(lineNum)
          decorations.push(
            Decoration.line({
              class: 'ol-cm-line-agent-insert',
            }).range(line.from)
          )
        }
      } catch (error) {
        debugConsole.debug('invalid agent insert position', error)
      }
    }
  }

  return Decoration.set(decorations, true)
}

const updateDeleteWidgetHighlight = (
  decorations: DecorationSet,
  predicate: (widget: ChangeDeletedWidget) => boolean,
  highlightType?: 'focus' | 'highlight' | null
) => {
  // Read the CURRENTLY-MAPPED position from cursor.from instead of any
  // value we stored at widget-construction time. CM6 has been auto-mapping
  // decoration positions through user edits; using a stale stored position
  // causes the widget to jump on hover/focus after the user types.
  const widgetsToReplace: Array<{
    widget: ChangeDeletedWidget
    from: number
    side: number
    block: boolean
  }> = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const widget = cursor.value.spec?.widget
    if (widget instanceof ChangeDeletedWidget && predicate(widget)) {
      widgetsToReplace.push({
        widget,
        from: cursor.from,
        side: cursor.value.spec.side ?? 0,
        block: Boolean(cursor.value.spec.block),
      })
    }
    cursor.next()
  }

  return decorations.update({
    sort: true,
    filter: (from, to, decoration) => {
      const w = decoration.spec?.widget
      return !widgetsToReplace.some(it => it.widget === w)
    },
    add: widgetsToReplace.map(({ widget, from, side, block }) =>
      Decoration.widget({
        widget: new ChangeDeletedWidget(widget.change, block, highlightType),
        side,
        block,
        opType: 'd',
        id: widget.change.id,
        metadata: widget.change.metadata,
      }).range(from, from)
    ),
  })
}

const buildHighlightDecorations = (className: string, op: AnyOperation) => {
  if (isDeleteOperation(op)) {
    // delete indicators are handled in change decorations
    return Decoration.none
  }

  const opFrom = op.p
  const opLength = isInsertOperation(op) ? op.i.length : op.c.length
  const opType = isInsertOperation(op) ? 'i' : 'c'

  if (opLength === 0) {
    return Decoration.none
  }

  return Decoration.set(
    Decoration.mark({
      class: `${className} ${className}-${opType}`,
    }).range(opFrom, opFrom + opLength),
    true
  )
}

class ChangeDeletedWidget extends WidgetType {
  constructor(
    public change: Change<DeleteOperation>,
    public block: boolean = false,
    public highlightType: 'highlight' | 'focus' | null = null
  ) {
    super()
  }

  toDOM() {
    const widget = document.createElement(this.block ? 'div' : 'span')
    widget.classList.add('ol-cm-change')
    widget.classList.add('ol-cm-change-d')
    if (this.block) {
      widget.classList.add('ol-cm-change-d-block')
    }
    if (this.change.metadata?.source === 'agent') {
      widget.classList.add('ol-cm-change-agent')
    }
    if (this.highlightType) {
      widget.classList.add(`ol-cm-change-d-${this.highlightType}`)
    }
    const text = this.change.op.d ?? ''
    if (text.length > 0) {
      const inner = document.createElement('span')
      inner.className = 'ol-cm-change-d-text'
      // textContent preserves \n as a real newline; CSS white-space: pre-wrap
      // on .ol-cm-change-d-text wraps multi-line deletions naturally.
      inner.textContent = text
      widget.appendChild(inner)
    }
    return widget
  }

  eq(old: ChangeDeletedWidget) {
    return (
      old.highlightType === this.highlightType &&
      old.change.id === this.change.id &&
      old.change.op.d === this.change.op.d &&
      old.block === this.block
    )
  }
}

const createInlineDeleteWidget = (
  change: Change<DeleteOperation>,
  position: number,
  side: number
) => {
  const widget = Decoration.widget({
    widget: new ChangeDeletedWidget(change, false),
    side,
    opType: 'd',
    id: change.id,
    metadata: change.metadata,
  })
  return [widget.range(position, position)]
}

const createBlockDeleteWidget = (
  change: Change<DeleteOperation>,
  lineStart: number
) => {
  const widget = Decoration.widget({
    widget: new ChangeDeletedWidget(change, true),
    side: -1,
    block: true,
    opType: 'd',
    id: change.id,
    metadata: change.metadata,
  })
  return [widget.range(lineStart, lineStart)]
}

const createInsertOrCommentMark = (change: Change, data: RangesData) => {
  const { id, metadata, op } = change

  if (isDeleteOperation(op)) {
    return [] // handled by createDeleteWidget
  }

  const from = op.p
  const _isCommentOperation = isCommentOperation(op)

  if (_isCommentOperation) {
    const thread = data.threads[op.t]
    if (!thread || thread.resolved) {
      return []
    }
  }

  const opType = _isCommentOperation ? 'c' : 'i'
  const changedText = _isCommentOperation ? op.c : op.i
  const to = from + changedText.length

  if (from === to) {
    return []
  }

  const sourceClass =
    metadata?.source === 'agent' ? ' ol-cm-change-agent' : ''
  const changeMark = Decoration.mark({
    tagName: 'span',
    class: `ol-cm-change ol-cm-change-${opType}${sourceClass}`,
    opType,
    id,
    metadata,
  })

  return [changeMark.range(from, to)]
}

const trackChangesTheme = EditorView.baseTheme({
  // USER (default) — blue inserts, pink deletes
  '.ol-cm-change-i, .ol-cm-change-highlight-i, .ol-cm-change-focus-i': {
    backgroundColor: 'rgba(56, 122, 224, 0.28)',
  },
  '&light .ol-cm-change-c, &light .ol-cm-change-highlight-c, &light .ol-cm-change-focus-c':
    {
      backgroundColor: 'rgba(243, 177, 17, 0.30)',
    },
  '&dark .ol-cm-change-c, &dark .ol-cm-change-highlight-c, &dark .ol-cm-change-focus-c':
    {
      backgroundColor: 'rgba(194, 93, 11, 0.15)',
    },
  '.ol-cm-change-focus .ol-cm-change': {
    backgroundColor: 'transparent',
  },
  '.ol-cm-change': {
    padding: 'var(--half-leading, 0) 0',
  },
  '.ol-cm-change-highlight': {
    padding: 'var(--half-leading, 0) 0',
  },
  '.ol-cm-change-focus': {
    padding: 'var(--half-leading, 0) 0',
  },
  '.ol-cm-change-d': {
    borderLeft: '2px dotted #d6336c',
    marginLeft: '-1px',
  },
  '.ol-cm-change-d .ol-cm-change-d-text': {
    backgroundColor: 'rgba(214, 51, 108, 0.20)',
    color: 'inherit',
    textDecoration: 'none',
    padding: '0 2px',
    whiteSpace: 'pre-wrap',
  },
  '.ol-cm-change-d-highlight': {
    borderLeft: '3px solid #d6336c',
    marginLeft: '-2px',
  },

  // AGENT — line-wide colors instead of inline. The inline mark stays so
  // we can position the inline-action chip via coordsAtPos, but its
  // background is transparent because the line decoration paints the
  // entire editor line green.
  '.ol-cm-change-agent.ol-cm-change-i, .ol-cm-change-agent.ol-cm-change-highlight-i, .ol-cm-change-agent.ol-cm-change-focus-i':
    {
      backgroundColor: 'transparent',
    },

  // Whole-line tint for agent inserts (provided by Decoration.line).
  '.ol-cm-line-agent-insert': {
    backgroundColor: 'rgba(44, 142, 48, 0.18)',
  },

  // BLOCK delete widget for agent edits — full-width band sitting between
  // lines (no line number), multi-line content preserved. The whole band
  // carries the colour; the inner text is left unstyled so it inherits the
  // band's red tint, mimicking the line tint applied to the new text below.
  '.ol-cm-change-d-block': {
    display: 'block',
    padding: '0 8px',
    margin: 0,
    borderLeft: '3px solid #c5060b',
    backgroundColor: 'rgba(197, 6, 11, 0.18)',
    whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  '.ol-cm-change-d-block .ol-cm-change-d-text': {
    backgroundColor: 'transparent',
    padding: 0,
    whiteSpace: 'pre-wrap',
    textDecoration: 'none',
  },
})
