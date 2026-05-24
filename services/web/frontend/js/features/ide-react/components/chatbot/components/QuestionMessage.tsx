import React, { useMemo, useState } from 'react'
import { ChatbotMessage } from '../types/chatbot-types'

interface QuestionMessageProps {
  message: ChatbotMessage
  onSubmitAnswer: (
    answerText: string,
    questionRunId?: string | null,
    options?: { visible?: boolean }
  ) => void
}

type SelectionState = Record<number, Set<number>>
type TextState = Record<number, string>
const CUSTOM_ANSWER_LABEL = 'Answer another thing'

function formatAnswer(
  message: ChatbotMessage,
  selections: SelectionState,
  freeText: TextState
) {
  return (message.questions ?? [])
    .map((question, questionIndex) => {
      const selectedOptions = Array.from(selections[questionIndex] ?? [])
        .sort((left, right) => left - right)
        .map(optionIndex => question.options[optionIndex]?.label)
        .filter((label): label is string => Boolean(label))

      const lines = [
        question.header ? `${question.header}:` : null,
        question.question,
        selectedOptions.length > 0 ? `Selected: ${selectedOptions.join(', ')}` : null,
        freeText[questionIndex]?.trim() ? `Answer: ${freeText[questionIndex].trim()}` : null,
      ].filter((line): line is string => Boolean(line))

      return lines.join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

export const QuestionMessage: React.FC<QuestionMessageProps> = ({
  message,
  onSubmitAnswer,
}) => {
  const questions = message.questions ?? []
  const [selections, setSelections] = useState<SelectionState>({})
  const [freeText, setFreeText] = useState<TextState>({})
  const [customAnswerOpen, setCustomAnswerOpen] = useState<Record<number, boolean>>({})

  const formattedAnswer = useMemo(
    () => formatAnswer(message, selections, freeText),
    [freeText, message, selections]
  )

  const toggleOption = (
    questionIndex: number,
    optionIndex: number,
    multiSelect = false
  ) => {
    setSelections(currentSelections => {
      const current = new Set(currentSelections[questionIndex] ?? [])

      if (multiSelect) {
        if (current.has(optionIndex)) {
          current.delete(optionIndex)
        } else {
          current.add(optionIndex)
        }
      } else if (current.has(optionIndex) && current.size === 1) {
        current.clear()
      } else {
        current.clear()
        current.add(optionIndex)
      }

      return {
        ...currentSelections,
        [questionIndex]: current,
      }
    })

    setCustomAnswerOpen(current => {
      if (!current[questionIndex]) return current
      return {
        ...current,
        [questionIndex]: false,
      }
    })

    setFreeText(currentText => {
      if (currentText[questionIndex] == null) return currentText
      const nextText = { ...currentText }
      delete nextText[questionIndex]
      return nextText
    })
  }

  const openCustomAnswer = (questionIndex: number) => {
    setSelections(currentSelections => {
      if (!currentSelections[questionIndex]?.size) return currentSelections
      const nextSelections = { ...currentSelections }
      delete nextSelections[questionIndex]
      return nextSelections
    })
    setCustomAnswerOpen(current => ({
      ...current,
      [questionIndex]: true,
    }))
  }

  const handleSubmit = () => {
    const answer = formattedAnswer.trim()
    if (!answer) return
    onSubmitAnswer(answer, message.runId ?? null, { visible: false })
    setSelections({})
    setFreeText({})
    setCustomAnswerOpen({})
  }

  return (
    <div className="ide-chatbot-question-card" role="group" aria-label="Question prompt">
      {questions.map((question, questionIndex) => {
        const selectedOptions = selections[questionIndex] ?? new Set<number>()

        return (
          <section className="ide-chatbot-question-block" key={`${message.id}-${questionIndex}`}>
            {question.header && (
              <div className="ide-chatbot-question-header">{question.header}</div>
            )}
            <div className="ide-chatbot-question-text">{question.question}</div>

            <div className="ide-chatbot-question-options" role="list">
              {question.options.map((option, optionIndex) => {
                const isSelected = selectedOptions.has(optionIndex)
                return (
                  <button
                    key={`${message.id}-${questionIndex}-${optionIndex}`}
                    type="button"
                    className={`ide-chatbot-question-option${isSelected ? ' is-selected' : ''}`}
                    onClick={() => toggleOption(questionIndex, optionIndex, Boolean(question.multiSelect))}
                    aria-pressed={isSelected}
                  >
                    <span className="ide-chatbot-question-option-label">{option.label}</span>
                    {option.description && (
                      <span className="ide-chatbot-question-option-description">
                        {option.description}
                      </span>
                    )}
                  </button>
                )
              })}
              <button
                type="button"
                className={`ide-chatbot-question-option${customAnswerOpen[questionIndex] ? ' is-selected' : ''}`}
                onClick={() => openCustomAnswer(questionIndex)}
                aria-pressed={customAnswerOpen[questionIndex] ?? false}
              >
                <span className="ide-chatbot-question-option-label">{CUSTOM_ANSWER_LABEL}</span>
                <span className="ide-chatbot-question-option-description">
                  Type a custom response below
                </span>
              </button>
            </div>

            {customAnswerOpen[questionIndex] && (
              <textarea
                className="ide-chatbot-question-input"
                value={freeText[questionIndex] ?? ''}
                onChange={event =>
                  setFreeText(currentText => ({
                    ...currentText,
                    [questionIndex]: event.target.value,
                  }))
                }
                placeholder="Type your answer"
                aria-label={`Answer for question ${questionIndex + 1}`}
                rows={3}
              />
            )}
          </section>
        )
      })}

      <div className="ide-chatbot-question-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={!formattedAnswer.trim()}
        >
          Send answer
        </button>
      </div>
    </div>
  )
}