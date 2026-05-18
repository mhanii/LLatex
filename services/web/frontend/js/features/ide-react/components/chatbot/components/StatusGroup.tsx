import React from 'react'
import { ChatbotMessage } from '../types/chatbot-types'
import { renderStatusIcon } from '../utils/tool-utils'

interface StatusGroupProps {
  id: string
  messages: ChatbotMessage[]
  summary: string
  isExpanded: boolean
  showToggle: boolean
  onToggle: () => void
  renderStatusText: (text: string) => React.ReactNode
}

export const StatusGroup: React.FC<StatusGroupProps> = ({
  id,
  messages,
  summary,
  isExpanded,
  showToggle,
  onToggle,
  renderStatusText,
}) => {
  return (
    <div key={id} className="ide-chatbot-status-wrapper">
      {showToggle && (
        <button
          type="button"
          className={`ide-chatbot-status-group-toggle ${!isExpanded ? 'ide-chatbot-status-group-toggle-collapsed' : ''}`}
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Collapse status messages' : 'Expand status messages'}
        >
          <span className="ide-chatbot-status-group-toggle-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isExpanded ? <path d="M6 14l6-6 6 6" /> : <path d="M6 10l6 6 6-6" />}
            </svg>
          </span>
          <span className="ide-chatbot-status-group-toggle-text">{summary}</span>
          {messages.some(message => message.status === 'running') && (
            <span className="ide-chatbot-status-group-badge">In progress...</span>
          )}
        </button>
      )}

      {isExpanded && (
        <div className="ide-chatbot-status-messages-list">
          {messages.map((message, messageIndex) => (
            <article
              key={message.id}
              className={`ide-chatbot-message ide-chatbot-message-status ${
                message.text.includes('Could not') || message.text.includes('Failed')
                  ? 'ide-chatbot-message-status-error'
                  : ''
              } ${message.status === 'running' ? 'is-pending' : ''}`}
              data-status={message.status ?? 'running'}
            >
              {renderStatusIcon(message, messageIndex === messages.length - 1)}
              <div className="ide-chatbot-message-body">
                <p className="ide-chatbot-message-content status-text">{renderStatusText(message.text)}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
