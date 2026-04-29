import { memo, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import {
  useRangesContext,
  useRangesActionsContext,
} from '../context/ranges-context'
import {
  Change,
  DeleteOperation,
  EditOperation,
  InsertOperation,
} from '../../../../../types/change'
import { isDeleteChange, isInsertChange } from '@/utils/operations'
import { canAggregate } from '../utils/can-aggregate'
import MaterialIcon from '@/shared/components/material-icon'

const VERTICAL_OFFSET_PX = 26
const MIN_PADDING_PX = 8

type Entry = {
  primary: Change<EditOperation>
  aggregate?: Change<DeleteOperation>
}

const aggregate = (changes: Change<EditOperation>[]): Entry[] => {
  const entries: Entry[] = []
  let preceding: Change<EditOperation> | null = null
  for (const change of changes) {
    if (
      preceding &&
      isInsertChange(preceding) &&
      isDeleteChange(change) &&
      canAggregate(change, preceding as Change<InsertOperation>)
    ) {
      // attach the deletion as an aggregate of the previous insert entry
      entries[entries.length - 1].aggregate = change
    } else {
      entries.push({ primary: change })
    }
    preceding = change
  }
  return entries
}

export const InlineChangeActions = memo(function InlineChangeActions() {
  const view = useCodeMirrorViewContext()
  const ranges = useRangesContext()
  const actions = useRangesActionsContext()
  const { t } = useTranslation()
  const [tick, setTick] = useState(0)

  const bump = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    if (!view) return
    const scroll = view.scrollDOM
    scroll.addEventListener('scroll', bump, { passive: true })
    window.addEventListener('resize', bump)
    return () => {
      scroll.removeEventListener('scroll', bump)
      window.removeEventListener('resize', bump)
    }
  }, [view, bump])

  useEffect(() => {
    bump()
  }, [ranges, bump])

  if (!view || !ranges?.changes?.length) return null

  type Item = {
    id: string
    pos: { top: number; left: number }
    isAgent: boolean
    onAccept: () => void
    onReject: () => void
  }

  const items: Item[] = []
  const seenKeys = new Set<string>()

  for (const entry of aggregate(ranges.changes)) {
    const { primary, aggregate: agg } = entry
    let coords: { top: number; left: number } | null = null
    try {
      coords = view.coordsAtPos(primary.op.p)
    } catch {
      continue
    }
    if (!coords) continue
    const key = `${Math.round(coords.top)}:${Math.round(coords.left)}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    const isAgent =
      primary.metadata?.source === 'agent' || agg?.metadata?.source === 'agent'

    items.push({
      id: primary.id,
      pos: {
        top: Math.max(MIN_PADDING_PX, coords.top - VERTICAL_OFFSET_PX),
        left: Math.max(MIN_PADDING_PX, coords.left),
      },
      isAgent,
      onAccept: () =>
        agg
          ? actions.acceptChanges(primary, agg)
          : actions.acceptChanges(primary),
      onReject: () =>
        agg
          ? actions.rejectChanges(primary, agg)
          : actions.rejectChanges(primary),
    })
  }

  if (items.length === 0) return null

  return createPortal(
    <div className="inline-change-actions-layer" data-tick={tick}>
      {items.map(item => (
        <div
          key={item.id}
          className={`inline-change-actions${item.isAgent ? ' agent' : ' user'}`}
          style={{
            position: 'fixed',
            top: item.pos.top,
            left: item.pos.left,
          }}
        >
          <span className="inline-change-actions-source">
            {item.isAgent ? 'Agent' : t('you')}
          </span>
          <button
            type="button"
            className="inline-change-actions-btn accept"
            onClick={item.onAccept}
            aria-label={t('accept_change')}
            title={t('accept_change')}
          >
            <MaterialIcon type="check" />
          </button>
          <button
            type="button"
            className="inline-change-actions-btn reject"
            onClick={item.onReject}
            aria-label={t('reject_change')}
            title={t('reject_change')}
          >
            <MaterialIcon type="close" />
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
})
