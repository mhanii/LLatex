import React, { FormEvent, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'

interface ChatbotComposerProps {
  inputValue: string
  onInputChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  inputRef: React.RefObject<HTMLTextAreaElement>
  canSend: boolean
  isGenerating: boolean
  onStopGeneration: () => void
  referenceText: string | null
  referenceLines: { start: number; end: number } | null
  onClearReference: () => void
  isEditing: boolean
  onCancelEdit: () => void
}

export const ChatbotComposer: React.FC<ChatbotComposerProps> = ({
  inputValue,
  onInputChange,
  onKeyDown,
  onSubmit,
  inputRef,
  canSend,
  isGenerating,
  onStopGeneration,
  referenceText,
  referenceLines,
  onClearReference,
  isEditing,
  onCancelEdit,
}) => {
  const { t } = useTranslation()

  const referenceLabel = referenceLines
    ? referenceLines.start === referenceLines.end
      ? `${t('chatbot_reference_line_prefix')} ${referenceLines.start}`
      : `${t('chatbot_reference_lines_prefix')} ${referenceLines.start}-${referenceLines.end}`
    : t('chatbot_reference_label')

  return (
    <>
      {isEditing && (
        <div className="ide-chatbot-panel-editing-banner" role="status">
          <span>{t('chatbot_editing_message')}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm ide-chatbot-panel-cancel-edit"
            onClick={onCancelEdit}
          >
            {t('cancel')}
          </button>
        </div>
      )}

      <div className="ide-chatbot-panel-composer">
        {referenceText && (
          <div
            className="ide-chatbot-panel-reference"
            aria-label={t('chatbot_section_reference')}
          >
            <div className="ide-chatbot-panel-reference-header">
              <div className="ide-chatbot-panel-reference-title">
                {referenceLabel}
              </div>
              <OLTooltip
                id="clear-chatbot-reference"
                description={t('chatbot_stop_referencing_this_text')}
                overlayProps={{ placement: 'bottom' }}
              >
                <OLIconButton
                  onClick={onClearReference}
                  className="ide-chatbot-panel-reference-clear-button"
                  icon="close"
                  accessibilityLabel={t('chatbot_stop_referencing_this_text')}
                  size="sm"
                />
              </OLTooltip>
            </div>
            <div className="ide-chatbot-panel-reference-content">
              {referenceText.length > 50
                ? `${referenceText.slice(0, 25)}...${referenceText.slice(-20)}`
                : referenceText}
            </div>
          </div>
        )}

        <form className="ide-chatbot-panel-form" onSubmit={onSubmit}>
          <textarea
            id="ide-chatbot-input"
            name="ide-chatbot-input"
            ref={inputRef}
            className="ide-chatbot-panel-input"
            value={inputValue}
            onChange={event => onInputChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isGenerating ? t('chatbot_agent_is_thinking') : t('chatbot_ask_anything')}
            aria-label={t('chatbot_chat_input')}
            rows={1}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={isGenerating}
          />
          <div className={`ide-chatbot-panel-send-shell${isGenerating ? ' is-generating' : ''}`}>
            {isGenerating ? (
              <button
                type="button"
                className="btn btn-primary ide-chatbot-panel-send is-generating"
                onClick={onStopGeneration}
                aria-label={t('chatbot_stop_generating_response')}
              >
                <svg
                  className="ide-chatbot-panel-send-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="currentColor"
                >
                  <rect x="4.5" y="4.5" width="15" height="15" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary ide-chatbot-panel-send"
                disabled={!canSend}
                aria-label={isEditing ? t('chatbot_update_message') : t('send_message')}
              >
                <span className="material-symbols ide-chatbot-panel-send-icon" aria-hidden="true">
                  arrow_upward
                </span>
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  )
}
