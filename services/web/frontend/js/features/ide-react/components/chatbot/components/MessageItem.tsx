import React, { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { ChatbotMarkdown } from '../chatbot-markdown'
import { ChatbotMessage } from '../types/chatbot-types'
import { QuestionMessage } from './QuestionMessage'

const REVEAL_PIXELS_PER_SECOND = 12000
const REVEAL_MIN_DURATION_MS = 80
const REVEAL_MAX_DURATION_MS = 2000

type QuestionAnswerBlock = {
  eyebrow?: string
  title: string
  body: string
}

function parseQuestionAnswerBlocks(text: string): QuestionAnswerBlock[] {
  return text
    .split(/\n\s*\n/)
    .map(block => {
      const lines = block
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.trim().length > 0)

      if (lines.length === 0) return null

      const selectedLineIndex = lines.findIndex(
        line => /^Selected: /.test(line) || /^Answer: /.test(line)
      )
      if (selectedLineIndex === -1) return null

      if (lines[0].endsWith(':') && lines.length > 1) {
        return {
          eyebrow: lines[0].slice(0, -1),
          title: lines[1],
          body: lines.slice(2).join('\n').trim(),
        }
      }

      return {
        title: lines[0],
        body: lines.slice(1).join('\n').trim(),
      }
    })
    .filter((block): block is QuestionAnswerBlock => Boolean(block))
}

interface MessageItemProps {
  message: ChatbotMessage
  shouldReveal?: boolean
  isEditing: string | null
  isHovered: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onEdit: (id: string) => void
  onCopy: (text: string) => void
  onSubmitQuestionAnswer: (
    answerText: string,
    questionRunId?: string | null,
    options?: { visible?: boolean }
  ) => void
  onRollback?: (id: string) => void
  rollbackDisabled?: boolean
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
  onSubmitQuestionAnswer,
  onRollback,
  rollbackDisabled = false,
  onAnimationEnd,
  isStreaming = false,
  streamingText,
}) => {
  const { t } = useTranslation()
  const messageContentRef = useRef<HTMLDivElement | null>(null)
  const hasCalculatedDurationRef = useRef(false)
  const [revealDurationMs, setRevealDurationMs] = React.useState<number | null>(null)

  const isMessageStreaming = isStreaming || Boolean(message.isStreaming)
  const currentStreamingText = streamingText ?? message.streamingText ?? ''

  const isAssistantReveal = message.role === 'assistant' && !message.pending && shouldReveal && !isMessageStreaming
  const questionAnswerBlocks =
    message.role === 'user' ? parseQuestionAnswerBlocks(message.text) : []
  const hasQuestionAnswerLayout = questionAnswerBlocks.length > 0

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
    if (hasQuestionAnswerLayout) classes.push('ide-chatbot-message-user-question-answer')
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
          message.questions?.length ? (
            <div
              ref={messageContentRef}
              className="ide-chatbot-message-content ide-chatbot-message-content-question"
              style={
                revealDurationMs && isAssistantReveal
                  ? ({
                      '--ide-chatbot-message-reveal-duration': `${revealDurationMs}ms`,
                      animationDuration: `${revealDurationMs}ms`,
                    } as React.CSSProperties)
                  : undefined
              }
              onAnimationEnd={isAssistantReveal ? handleLocalAnimationEnd : undefined}
            >
              <QuestionMessage
                message={message}
                onSubmitAnswer={onSubmitQuestionAnswer}
              />
            </div>
          ) : (
            <div
              ref={messageContentRef}
              className={`ide-chatbot-message-content${isAssistantReveal ? ' ide-chatbot-message-content-reveal' : ''}`}
              style={
                revealDurationMs && isAssistantReveal
                  ? ({
                      '--ide-chatbot-message-reveal-duration': `${revealDurationMs}ms`,
                      animationDuration: `${revealDurationMs}ms`,
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
          )
        ) : (
          hasQuestionAnswerLayout ? (
            <div className="ide-chatbot-message-question-answer">
              {questionAnswerBlocks.map((block, blockIndex) => (
                <section
                  key={`${message.id}-${blockIndex}`}
                  className="ide-chatbot-message-question-answer-block"
                >
                  {block.eyebrow && (
                    <div className="ide-chatbot-message-question-answer-eyebrow">
                      {block.eyebrow}
                    </div>
                  )}
                  <div className="ide-chatbot-message-question-answer-title">
                    {block.title}
                  </div>
                  {block.body && (
                    <div className="ide-chatbot-message-question-answer-body">
                      {block.body}
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <p className="ide-chatbot-message-content">{message.text}</p>
          )
        )}
        {message.role === 'user' && !message.pending && !hasQuestionAnswerLayout && (
          <div className="ide-chatbot-message-footer">
            <OLTooltip id={`edit-chatbot-message-${message.id}`} description={t('edit')} overlayProps={{ placement: 'bottom' }}>
              <OLIconButton onClick={() => onEdit(message.id)} className="ide-chatbot-message-footer-button" icon="edit" accessibilityLabel={t('edit')} size="sm" />
            </OLTooltip>
            <OLTooltip id={`copy-chatbot-message-${message.id}`} description={t('copy')} overlayProps={{ placement: 'bottom' }}>
              <OLIconButton onClick={() => onCopy(message.text)} className="ide-chatbot-message-footer-button" icon="content_copy" accessibilityLabel={t('copy')} size="sm" />
            </OLTooltip>
            {onRollback && typeof message.projectVersionBefore === 'number' && (
              <OLTooltip
                id={`rollback-chatbot-message-${message.id}`}
                description={
                  rollbackDisabled
                    ? 'Rollback unavailable while the agent is running'
                    : 'Roll back to here (discards this message, the agent reply, and project changes since)'
                }
                overlayProps={{ placement: 'bottom' }}
              >
                <OLIconButton
                  onClick={() => onRollback(message.id)}
                  className="ide-chatbot-message-footer-button"
                  icon="history"
                  accessibilityLabel="Roll back to here"
                  size="sm"
                  disabled={rollbackDisabled}
                />
              </OLTooltip>
            )}
          </div>
        )}
        {message.role !== 'user' && isHovered && message.role !== 'status' && !message.questions?.length && (
          <div className="ide-chatbot-message-actions">
            <OLTooltip id={`copy-chatbot-message-${message.id}`} description={t('copy')} overlayProps={{ placement: 'bottom' }}>
              <OLIconButton onClick={() => onCopy(message.text)} className="ide-chatbot-message-copy-button" icon="content_copy" accessibilityLabel={t('copy')} size="sm" />
            </OLTooltip>
          </div>
        )}
        {message.error && (
          <div className="ide-chatbot-message-error">
            <span className="ide-chatbot-message-error-icon">⚠️</span>
            {message.error}
            {message.role === 'user' && (
              <button 
                onClick={() => onEdit(message.id)}
                className="ide-chatbot-message-error-retry"
              >
                {t('retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
