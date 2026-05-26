// services/web/frontend/js/features/ide-react/components/chatbot/components/ChatbotMessagesContainer.tsx

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageItem } from './MessageItem'
import { StatusGroup } from './StatusGroup'
import { ChatbotMessageGroup } from '../types/chatbot-types'

interface ChatbotMessagesContainerProps {
  messageGroups: ChatbotMessageGroup[]
  editingMessageId: string | null
  hoveredMessageId: string | null
  onMessageHover: (id: string) => void
  onMessageLeave: (id: string) => void
  onEditMessage: (id: string) => void
  onCopyMessage: (text: string) => void
  onSubmitQuestionAnswer: (answerText: string, questionRunId?: string | null) => void
  activeConversationLastRunId: string | null
  resolvedQuestionRunIds: string[]
  onRollbackMessage?: (id: string) => void
  rollbackDisabled?: boolean
  onToggleStatusGroup: (id: string, isExpanded: boolean) => void
  isStatusGroupExpanded: (groupId: string) => boolean
  shouldShowToggleForGroup: (groupId: string) => boolean
  renderStatusText: (text: string) => React.ReactNode
  messagesContainerRef: React.RefObject<HTMLDivElement>
  shouldAutoScroll: boolean
  onJumpToLatestMessage: () => void
  activeConversationId: string | null
  isLoadingMessages?: boolean
}

export const ChatbotMessagesContainer: React.FC<ChatbotMessagesContainerProps> = ({
  messageGroups,
  editingMessageId,
  hoveredMessageId,
  onMessageHover,
  onMessageLeave,
  onEditMessage,
  onCopyMessage,
  onSubmitQuestionAnswer,
  activeConversationLastRunId,
  resolvedQuestionRunIds,
  onRollbackMessage,
  rollbackDisabled = false,
  onToggleStatusGroup,
  isStatusGroupExpanded,
  shouldShowToggleForGroup,
  renderStatusText,
  messagesContainerRef,
  shouldAutoScroll,
  onJumpToLatestMessage,
  activeConversationId,
  isLoadingMessages = false,
}) => {
  const { t } = useTranslation()
  const seenAssistantMessageIdsRef = useRef(new Set<string>())
  const previousConversationIdRef = useRef<string | null>(null)
  const hasInitializedSeenMessagesRef = useRef(false)
  const [revealingMessageIds, setRevealingMessageIds] = useState<string[]>([])

  // Reset refs when conversation changes (but not on initial load)
  useEffect(() => {
    if (previousConversationIdRef.current !== activeConversationId) {
      // Only reset if we're switching to a different conversation
      seenAssistantMessageIdsRef.current.clear()
      setRevealingMessageIds([])
      previousConversationIdRef.current = activeConversationId
      hasInitializedSeenMessagesRef.current = false
    }
  }, [activeConversationId])

  // Clean up revealingMessageIds after animation completes
  const handleAnimationEnd = useCallback((messageId: string) => {
    setRevealingMessageIds(prev => prev.filter(id => id !== messageId))
  }, [])

  // Handle initial population of seen messages WITHOUT animation after loading completes
  useEffect(() => {
    // Only run this when loading is complete
    if (isLoadingMessages) return
    if (hasInitializedSeenMessagesRef.current) return

    // Get all non-pending assistant message IDs that exist right now
    const existingAssistantMessageIds = messageGroups.flatMap(group =>
      group.type === 'single' && group.message.role === 'assistant' && !group.message.pending
        ? [group.message.id]
        : []
    )

    // Mark all existing messages as "seen" so they won't animate
    existingAssistantMessageIds.forEach(id => seenAssistantMessageIdsRef.current.add(id))
    hasInitializedSeenMessagesRef.current = true
  }, [isLoadingMessages, messageGroups])

  // Detect newly added assistant messages (only after initial population is done)
  useEffect(() => {
    // Don't process animations while loading messages
    if (isLoadingMessages) return
    
    // Wait until we've initialized the seen set
    if (!hasInitializedSeenMessagesRef.current) return

    // Get all non-pending assistant message IDs
    const assistantMessageIds = messageGroups.flatMap(group =>
      group.type === 'single' && group.message.role === 'assistant' && !group.message.pending
        ? [group.message.id]
        : []
    )

    // Find messages we haven't seen before (these are genuinely new)
    const unseenAssistantMessageIds = assistantMessageIds.filter(
      id => !seenAssistantMessageIdsRef.current.has(id)
    )

    if (unseenAssistantMessageIds.length === 0) return

    // Mark them as seen and trigger animation
    unseenAssistantMessageIds.forEach(id => seenAssistantMessageIdsRef.current.add(id))
    setRevealingMessageIds(prev => [...prev, ...unseenAssistantMessageIds.filter(id => !prev.includes(id))])
  }, [messageGroups, isLoadingMessages])

  return (
    <div className="ide-chatbot-panel-messages-wrapper">
      <div
        ref={messagesContainerRef}
        className="ide-chatbot-panel-messages"
        role="log"
        aria-live="polite"
      >
        <>
          {messageGroups.map(group => {
            if (group.type === 'single') {
              const message = group.message
              const isCurrentQuestion = Boolean(
                message.questions?.length &&
                message.runId &&
                message.runId === activeConversationLastRunId &&
                !resolvedQuestionRunIds.includes(message.runId)
              )
              if (message.questions?.length && !isCurrentQuestion) {
                return null
              }
              const shouldReveal = revealingMessageIds.includes(message.id) && !message.isStreaming
              return (
                <MessageItem
                  key={message.id}
                  message={message}
                  shouldReveal={shouldReveal}
                  isEditing={editingMessageId}
                  isHovered={hoveredMessageId === message.id}
                  onMouseEnter={() => onMessageHover(message.id)}
                  onMouseLeave={() => onMessageLeave(message.id)}
                  onEdit={onEditMessage}
                  onCopy={onCopyMessage}
                  onSubmitQuestionAnswer={onSubmitQuestionAnswer}
                  isStreaming={message.isStreaming}
                  streamingText={message.streamingText}
                  onRollback={onRollbackMessage}
                  rollbackDisabled={rollbackDisabled}
                  onAnimationEnd={shouldReveal ? () => handleAnimationEnd(message.id) : undefined}
                />
              )
            }

            const isExpanded = isStatusGroupExpanded(group.id)
            const showToggle = shouldShowToggleForGroup(group.id)

            return (
              <StatusGroup
                key={group.id}
                id={group.id}
                messages={group.messages}
                summary={group.summary}
                isExpanded={isExpanded}
                showToggle={showToggle}
                onToggle={() => onToggleStatusGroup(group.id, isExpanded)}
                renderStatusText={renderStatusText}
              />
            )
          })}
        </>
      </div>

      {!shouldAutoScroll && (
        <button
          type="button"
          className="ide-chatbot-scroll-to-bottom"
          onClick={onJumpToLatestMessage}
          aria-label={t('chatbot_go_to_latest_message')}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 5V18M12 18L7 13M12 18L17 13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}