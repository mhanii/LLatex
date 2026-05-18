import { useCallback, useMemo } from 'react'
import { ChatbotMessage } from '../types/chatbot-types'

export const useStatusGroupUtilities = (
  messageGroups: any[],
  expandedStatusGroupIds: string[],
  collapsedStatusGroupIds: string[],
  setExpandedStatusGroupIds: (fn: (prev: string[]) => string[]) => void,
  setCollapsedStatusGroupIds: (fn: (prev: string[]) => string[]) => void,
  handleMessagesScroll: () => void
) => {
  const statusGroupIds = useMemo(
    () => messageGroups.filter(group => group.type === 'status-group').map(group => group.id),
    [messageGroups]
  )

  const latestStatusGroupId = useMemo(() => {
    for (let index = messageGroups.length - 1; index >= 0; index -= 1) {
      const group = messageGroups[index]
      if (group.type === 'status-group') {
        return group.id
      }
    }

    return null
  }, [messageGroups])

  const isStatusGroupExpanded = useCallback(
    (groupId: string) => {
      if (collapsedStatusGroupIds.includes(groupId)) {
        return false
      }

      if (groupId === latestStatusGroupId) {
        return true
      }

      return expandedStatusGroupIds.includes(groupId)
    },
    [collapsedStatusGroupIds, expandedStatusGroupIds, latestStatusGroupId]
  )

  const toggleStatusGroup = useCallback((groupId: string, isExpanded: boolean) => {
    if (isExpanded) {
      setExpandedStatusGroupIds(prev => prev.filter(id => id !== groupId))
      setCollapsedStatusGroupIds(prev =>
        prev.includes(groupId) ? prev : [...prev, groupId]
      )
    } else {
      setCollapsedStatusGroupIds(prev => prev.filter(id => id !== groupId))
      setExpandedStatusGroupIds(prev =>
        prev.includes(groupId) ? prev : [...prev, groupId]
      )
    }
    
    setTimeout(() => {
      handleMessagesScroll()
    }, 0)
  }, [setExpandedStatusGroupIds, setCollapsedStatusGroupIds, handleMessagesScroll])

  return {
    statusGroupIds,
    latestStatusGroupId,
    isStatusGroupExpanded,
    toggleStatusGroup,
  }
}
