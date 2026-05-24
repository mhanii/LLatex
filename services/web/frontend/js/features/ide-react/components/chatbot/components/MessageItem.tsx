import React, { useLayoutEffect, useRef } from 'react'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { ChatbotMarkdown } from '../chatbot-markdown'
import { ChatbotMessage } from '../types/chatbot-types'

const REVEAL_PIXELS_PER_SECOND = 12000
const REVEAL_MIN_DURATION_MS = 80
const REVEAL_MAX_DURATION_MS = 2000

interface MessageItemProps {
  message: ChatbotMessage
  shouldReveal?: boolean
  isEditing: string | null
  isHovered: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onEdit: (id: string) => void
  onCopy: (text: string) => void
  onAnimationEnd?: () => void
  isStreaming?: boolean
  streamingText?: string
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  shouldReveal = false,
  isEditing,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onEdit,
  onCopy,
  onAnimationEnd,
  isStreaming = false,
  streamingText,
}) => {
  const messageContentRef = useRef<HTMLDivElement | null>(null)
  const hasCalculatedDurationRef = useRef(false)
  const [revealDurationMs, setRevealDurationMs] = React.useState<number | null>(null)

  const isMessageStreaming = isStreaming || Boolean(message.isStreaming)
  const currentStreamingText = streamingText ?? message.streamingText ?? ''

  const isAssistantReveal = message.role === 'assistant' && !message.pending && shouldReveal && !isMessageStreaming

  useLayoutEffect(() => {
    if (!isAssistantReveal || hasCalculatedDurationRef.current) {
      return
    }

    const contentElement = messageContentRef.current
    if (!contentElement) return

    const contentHeight = contentElement.getBoundingClientRect().height
    const nextDurationMs = Math.max(
      REVEAL_MIN_DURATION_MS,
      Math.min(REVEAL_MAX_DURATION_MS, Math.ceil((contentHeight / REVEAL_PIXELS_PER_SECOND) * 1000))
    )

    setRevealDurationMs(nextDurationMs)
    hasCalculatedDurationRef.current = true
    
    contentElement.getBoundingClientRect()
  }, [isAssistantReveal])

  const handleLocalAnimationEnd = () => {
    onAnimationEnd?.()
  }

  const getClassNames = () => {
    const classes = ['ide-chatbot-message']
    if (message.role === 'user') classes.push('ide-chatbot-message-user')
    if (message.role === 'assistant') classes.push('ide-chatbot-message-bot')
    if (message.id === isEditing) classes.push('ide-chatbot-message-editing')
    if (message.pending) classes.push('ide-chatbot-message-pending')
    if (isMessageStreaming) classes.push('ide-chatbot-message-streaming')
    return classes.join(' ')
  }

  return (
    <article
      className={getClassNames()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="ide-chatbot-message-body">
        {message.role === 'assistant' ? (
          <div
            ref={messageContentRef}
            className={`ide-chatbot-message-content${isAssistantReveal ? ' ide-chatbot-message-content-reveal' : ''}`}
            style={
              revealDurationMs && isAssistantReveal
                ? ({ 
                    '--ide-chatbot-message-reveal-duration': `${revealDurationMs}ms`,
                    animationDuration: `${revealDurationMs}ms`
                  } as React.CSSProperties)
                : undefined
            }
            onAnimationEnd={isAssistantReveal ? handleLocalAnimationEnd : undefined}
          >
            <ChatbotMarkdown text={isMessageStreaming ? currentStreamingText : message.text} />
            {isMessageStreaming && (
              <span className="ide-chatbot-streaming-cursor" aria-hidden="true">
                ▍
              </span>
            )}
          </div>
        ) : (
          <p className="ide-chatbot-message-content">{message.text}</p>
        )}
        {message.role === 'user' && !message.pending && (
          <div className="ide-chatbot-message-footer">
            <OLTooltip id={`edit-chatbot-message-${message.id}`} description="Edit message" overlayProps={{ placement: 'bottom' }}>
              <OLIconButton onClick={() => onEdit(message.id)} className="ide-chatbot-message-footer-button" icon="edit" accessibilityLabel="Edit message" size="sm" />
            </OLTooltip>
            <OLTooltip id={`copy-chatbot-message-${message.id}`} description="Copy message" overlayProps={{ placement: 'bottom' }}>
              <OLIconButton onClick={() => onCopy(message.text)} className="ide-chatbot-message-footer-button" icon="content_copy" accessibilityLabel="Copy message" size="sm" />
            </OLTooltip>
          </div>
        )}
        {message.role !== 'user' && isHovered && message.role !== 'status' && (
          <div className="ide-chatbot-message-actions">
            <OLTooltip id={`copy-chatbot-message-${message.id}`} description="Copy message" overlayProps={{ placement: 'bottom' }}>
              <OLIconButton onClick={() => onCopy(message.text)} className="ide-chatbot-message-copy-button" icon="content_copy" accessibilityLabel="Copy message" size="sm" />
            </OLTooltip>
          </div>
        )}
      </div>
    </article>
  )
}
