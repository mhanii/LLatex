import React from 'react'
import { MessageItem } from './MessageItem'
import { StatusGroup } from './StatusGroup'
import { ChatbotMessageGroup, ChatbotMessage } from '../types/chatbot-types'

interface ChatbotMessagesContainerProps {
  messageGroups: ChatbotMessageGroup[]
  editingMessageId: string | null
  hoveredMessageId: string | null
  onMessageHover: (id: string) => void
  onMessageLeave: (id: string) => void
  onEditMessage: (id: string) => void
  onCopyMessage: (text: string) => void
  onToggleStatusGroup: (id: string, isExpanded: boolean) => void
  isStatusGroupExpanded: (groupId: string) => boolean
  shouldShowToggleForGroup: (groupId: string) => boolean
  renderStatusText: (text: string) => React.ReactNode
  messagesContainerRef: React.RefObject<HTMLDivElement>
  shouldAutoScroll: boolean
  onJumpToLatestMessage: () => void
}

export const ChatbotMessagesContainer: React.FC<ChatbotMessagesContainerProps> = ({
  messageGroups,
  editingMessageId,
  hoveredMessageId,
  onMessageHover,
  onMessageLeave,
  onEditMessage,
  onCopyMessage,
  onToggleStatusGroup,
  isStatusGroupExpanded,
  shouldShowToggleForGroup,
  renderStatusText,
  messagesContainerRef,
  shouldAutoScroll,
  onJumpToLatestMessage,
}) => {
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
              return (
                <MessageItem
                  key={message.id}
                  message={message}
                  isEditing={editingMessageId}
                  isHovered={hoveredMessageId === message.id}
                  onMouseEnter={() => onMessageHover(message.id)}
                  onMouseLeave={() => onMessageLeave(message.id)}
                  onEdit={onEditMessage}
                  onCopy={onCopyMessage}
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
          aria-label="Go to latest message"
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
