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
import { debugConsole } from '@/utils/debugging'
import { captureException } from '@/infrastructure/error-reporter'

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

  // Re-query host elements on scroll/resize since CM6 may swap widget DOM nodes
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

  // Find all chip host containers currently rendered by CM6
  const hosts = Array.from(
    view.contentDOM.querySelectorAll<HTMLElement>('.inline-change-chip-host')
  )
  if (hosts.length === 0) return null

  const entryMap = new Map(aggregate(ranges.changes).map(e => [e.primary.id, e]))

  return (
    <>
      {hosts.map(host => {
        const changeId = host.dataset.changeId
        if (!changeId) return null
        const entry = entryMap.get(changeId)
        if (!entry) return null
        const { primary, aggregate: agg } = entry

        const isAgent =
          primary.metadata?.source === 'agent' ||
          agg?.metadata?.source === 'agent'
        const changeType = agg
          ? 'change'
          : isInsertChange(primary)
            ? 'addition'
            : 'deletion'

        const handleAccept = () => {
          const p = agg
            ? actions.acceptChanges(primary, agg)
            : actions.acceptChanges(primary)
          p.catch(err => {
            debugConsole.error('accept changes failed', err)
            captureException(err)
          })
        }
        const handleReject = () => {
          const p = agg
            ? actions.rejectChanges(primary, agg)
            : actions.rejectChanges(primary)
          p.catch(err => {
            debugConsole.error('reject changes failed', err)
            captureException(err)
          })
        }

        // For user chips, offset horizontally to sit above the actual change
        // text rather than the line start.
        let chipStyle: React.CSSProperties | undefined
        if (!isAgent) {
          try {
            const charCoords = view.coordsAtPos(primary.op.p)
            if (charCoords) {
              const hostRect = host.getBoundingClientRect()
              const offset = Math.max(0, charCoords.left - hostRect.left)
              if (offset > 0) chipStyle = { marginLeft: offset }
            }
          } catch {
            // leave chip at line start
          }
        }

        return createPortal(
          <div
            className={`inline-change-actions ${isAgent ? 'agent' : 'user'} ${changeType}`}
            style={chipStyle}
          >
            <span className="inline-change-actions-source">
              {isAgent ? 'Agent' : t('you')}
            </span>
            <span className="inline-change-actions-divider" aria-hidden />
            <button
              type="button"
              className="inline-change-actions-btn accept"
              onClick={handleAccept}
              aria-label={t('accept_change')}
            >
              <MaterialIcon type="check" />
              {isAgent && <span>Accept</span>}
            </button>
            <button
              type="button"
              className="inline-change-actions-btn reject"
              onClick={handleReject}
              aria-label={t('reject_change')}
            >
              <MaterialIcon type="close" />
              {isAgent && <span>Reject</span>}
            </button>
          </div>,
          host,
          changeId
        )
      })}
    </>
  )
})
