import { useCallback } from 'react'
import { ChatbotPrefillPayload } from '../types/chatbot-types'

export const useInputUtilities = (
  inputRef: React.RefObject<HTMLTextAreaElement>,
  setInput: (text: string) => void,
  setReferenceText: (text: string | null) => void,
  setReferenceLines: (lines: { start: number; end: number } | null) => void,
  setEditingMessageId: (id: string | null) => void
) => {
  const resizeInput = useCallback(() => {
    const textarea = inputRef.current
    if (!textarea) {
      return
    }

    const minHeight = 52
    const maxHeight = 160

    textarea.style.height = 'auto'
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${Math.max(nextHeight, minHeight)}px`
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [inputRef])

  const focusInputAtEnd = useCallback((text: string) => {
    setInput(text)

    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(text.length, text.length)
    })
  }, [inputRef, setInput])

  const applyPrefill = useCallback(
    (payload: ChatbotPrefillPayload) => {
      const trimmedReferenceText = payload.referenceText?.trim()

      if (trimmedReferenceText) {
        setReferenceText(trimmedReferenceText)
        setReferenceLines(payload.referenceLines ?? null)
        setEditingMessageId(null)
        focusInputAtEnd('')
        return
      }

      const trimmedText = payload.text?.trim()
      if (!trimmedText) {
        return
      }

      setReferenceText(null)
      setReferenceLines(null)
      focusInputAtEnd(trimmedText)
    },
    [setReferenceText, setReferenceLines, setEditingMessageId, focusInputAtEnd]
  )

  return {
    resizeInput,
    focusInputAtEnd,
    applyPrefill,
  }
}
