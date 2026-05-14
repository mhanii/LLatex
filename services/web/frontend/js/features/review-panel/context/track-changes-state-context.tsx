import { UserId } from '../../../../../types/user'
import {
  createContext,
  FC,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import useSocketListener from '@/features/ide-react/hooks/use-socket-listener'
import { useConnectionContext } from '@/features/ide-react/context/connection-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import { useUserContext } from '@/shared/context/user-context'
import { postJSON } from '@/infrastructure/fetch-json'
import useEventListener from '@/shared/hooks/use-event-listener'
import { ProjectMetadata } from '@/shared/context/types/project-metadata'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { debugConsole } from '@/utils/debugging'

export type TrackChangesState = {
  onForEveryone: boolean
  onForGuests: boolean
  onForMembers: Record<UserId, boolean | undefined>
}

export const TrackChangesStateContext = createContext<
  TrackChangesState | undefined
>(undefined)

type SaveTrackChangesRequestBody = {
  on?: boolean
  on_for?: Record<UserId, boolean | undefined>
  on_for_guests?: boolean
}

type TrackChangesStateActions = {
  saveTrackChanges: (trackChangesBody: SaveTrackChangesRequestBody) => void
  saveTrackChangesForCurrentUser: (trackChanges: boolean) => void
}

const TrackChangesStateActionsContext = createContext<
  TrackChangesStateActions | undefined
>(undefined)

const buildNextTrackChangesState = (
  prev: ProjectMetadata['trackChangesState'],
  trackChangesBody: SaveTrackChangesRequestBody
): ProjectMetadata['trackChangesState'] => {
  if (typeof trackChangesBody.on === 'boolean') {
    return trackChangesBody.on
  }

  const next: Record<string, boolean | undefined> =
    prev !== true && prev !== false ? { ...prev } : { __guests__: prev === true }

  if (trackChangesBody.on_for) {
    for (const [k, v] of Object.entries(trackChangesBody.on_for)) {
      next[k] = v
    }
  }

  if (typeof trackChangesBody.on_for_guests === 'boolean') {
    next.__guests__ = trackChangesBody.on_for_guests
  }

  return next as ProjectMetadata['trackChangesState']
}

export const TrackChangesStateProvider: FC<React.PropsWithChildren> = ({
  children,
}) => {
  const permissions = usePermissionsContext()
  const { socket } = useConnectionContext()
  const { projectId, project, features } = useProjectContext()
  const user = useUserContext()
  const { setWantTrackChanges } = useEditorPropertiesContext()

  // TODO: update project.trackChangesState instead?
  const [trackChangesValue, setTrackChangesValue] = useState<
    ProjectMetadata['trackChangesState']
  >(project?.trackChangesState ?? false)

  useSocketListener(socket, 'toggle-track-changes', setTrackChangesValue)

  useEffect(() => {
    setWantTrackChanges(
      trackChangesValue === true ||
        (trackChangesValue !== false &&
          trackChangesValue[user.id ?? '__guests__'])
    )
  }, [setWantTrackChanges, trackChangesValue, user.id])

  const trackChangesIsObject =
    trackChangesValue !== true && trackChangesValue !== false
  const onForEveryone = trackChangesValue === true
  const onForGuests =
    onForEveryone ||
    (trackChangesIsObject && trackChangesValue.__guests__ === true)

  const onForMembers = useMemo(() => {
    const onForMembers: Record<UserId, boolean | undefined> = {}
    if (trackChangesIsObject) {
      for (const key of Object.keys(trackChangesValue)) {
        if (key !== '__guests__') {
          onForMembers[key as UserId] = trackChangesValue[key as UserId]
        }
      }
    }
    return onForMembers
  }, [trackChangesIsObject, trackChangesValue])

  const saveTrackChanges = useCallback(
    async (trackChangesBody: SaveTrackChangesRequestBody) => {
      let previousState: ProjectMetadata['trackChangesState'] | undefined
      let optimisticState: ProjectMetadata['trackChangesState'] | undefined

      // Apply optimistically so review mode engages immediately, even if our own
      // toggle-track-changes broadcast doesn't echo back to this client.
      setTrackChangesValue(prev => {
        previousState = prev
        optimisticState = buildNextTrackChangesState(prev, trackChangesBody)
        return optimisticState
      })

      try {
        await postJSON(`/project/${projectId}/track_changes`, {
          body: trackChangesBody,
        })
      } catch (error) {
        setTrackChangesValue(current => {
          if (current === optimisticState && previousState !== undefined) {
            return previousState
          }
          return current
        })
        debugConsole.error('Failed to save track changes state', error)
      }
    },
    [projectId]
  )

  const saveTrackChangesForCurrentUser = useCallback(
    async (trackChanges: boolean) => {
      if (user.id) {
        saveTrackChanges({
          on_for: {
            ...onForMembers,
            [user.id]: trackChanges,
          },
        })
      }
    },
    [onForMembers, user.id, saveTrackChanges]
  )

  const actions = useMemo(
    () => ({
      saveTrackChanges,
      saveTrackChangesForCurrentUser,
    }),
    [saveTrackChanges, saveTrackChangesForCurrentUser]
  )

  useEventListener(
    'toggle-track-changes',
    useCallback(() => {
      if (
        user.id &&
        features.trackChanges &&
        permissions.write &&
        !onForEveryone
      ) {
        const value = onForMembers[user.id]
        actions.saveTrackChanges({
          on_for: {
            ...onForMembers,
            [user.id]: !value,
          },
        })
      }
    }, [
      actions,
      onForMembers,
      onForEveryone,
      permissions.write,
      features.trackChanges,
      user.id,
    ])
  )

  const value = useMemo(
    () => ({ onForEveryone, onForGuests, onForMembers }),
    [onForEveryone, onForGuests, onForMembers]
  )

  return (
    <TrackChangesStateActionsContext.Provider value={actions}>
      <TrackChangesStateContext.Provider value={value}>
        {children}
      </TrackChangesStateContext.Provider>
    </TrackChangesStateActionsContext.Provider>
  )
}

export const useTrackChangesStateContext = () => {
  return useContext(TrackChangesStateContext)
}

export const useTrackChangesStateActionsContext = () => {
  const context = useContext(TrackChangesStateActionsContext)
  if (!context) {
    throw new Error(
      'useTrackChangesStateActionsContext is only available inside TrackChangesStateProvider'
    )
  }
  return context
}
