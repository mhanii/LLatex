import React from 'react'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { ChatbotMarkdown } from '../chatbot-markdown'
import { ChatbotMessage } from '../types/chatbot-types'

interface MessageItemProps {
  message: ChatbotMessage
  isEditing: string | null
  isHovered: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onEdit: (id: string) => void
  onCopy: (text: string) => void
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isEditing,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onEdit,
  onCopy,
}) => {
  const getClassNames = () => {
    const classes = ['ide-chatbot-message']
    if (message.role === 'user') classes.push('ide-chatbot-message-user')
    if (message.role === 'assistant') classes.push('ide-chatbot-message-bot')
    if (message.id === isEditing) classes.push('ide-chatbot-message-editing')
    if (message.pending) classes.push('ide-chatbot-message-pending')
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
          <div className="ide-chatbot-message-content">
            <ChatbotMarkdown text={message.text} />
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
