import React, { FormEvent, KeyboardEvent } from 'react'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'

interface ChatbotComposerProps {
  inputValue: string
  onInputChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  inputRef: React.RefObject<HTMLTextAreaElement>
  canSend: boolean
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
  referenceText,
  referenceLines,
  onClearReference,
  isEditing,
  onCancelEdit,
}) => {
  const referenceLabel = referenceLines
    ? referenceLines.start === referenceLines.end
      ? `Line ${referenceLines.start}`
      : `Lines ${referenceLines.start}-${referenceLines.end}`
    : null

  return (
    <>
      {isEditing && (
        <div className="ide-chatbot-panel-editing-banner" role="status">
          <span>Editing message</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm ide-chatbot-panel-cancel-edit"
            onClick={onCancelEdit}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="ide-chatbot-panel-composer">
        {referenceText && (
          <div
            className="ide-chatbot-panel-reference"
            aria-label="Section reference"
          >
            <div className="ide-chatbot-panel-reference-header">
              <div className="ide-chatbot-panel-reference-title">
                {referenceLabel ?? 'Reference:'}
              </div>
              <OLTooltip
                id="clear-chatbot-reference"
                description="Stop referencing this text"
                overlayProps={{ placement: 'bottom' }}
              >
                <OLIconButton
                  onClick={onClearReference}
                  className="ide-chatbot-panel-reference-clear-button"
                  icon="close"
                  accessibilityLabel="Stop referencing this text"
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
            placeholder="Ask anything..."
            aria-label="Chat input"
            rows={1}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="btn btn-primary ide-chatbot-panel-send"
            disabled={!canSend}
            aria-label={isEditing ? 'Update message' : 'Send message'}
          >
            <span>Send</span>
            <span className="material-symbols" aria-hidden="true">
              {isEditing ? 'edit' : 'keyboard_return'}
            </span>
          </button>
        </form>
      </div>
    </>
  )
}
