import { useCallback } from 'react'
import { ChatbotMessage, AgentServerMessage } from '../types/chatbot-types'

export const useMessageUtilities = (
  user: any,
  messages: ChatbotMessage[],
  setMessages: (fn: (prev: ChatbotMessage[]) => ChatbotMessage[]) => void,
  counterRef: React.MutableRefObject<number>,
  shouldAutoScroll: boolean,
  scrollToLatestStatusMessage: () => void
) => {
  const createMessageId = useCallback(
    (prefix: 'user' | 'assistant' | 'status') => {
      counterRef.current += 1
      return `${prefix}-${counterRef.current}`
    },
    []
  )

  const toChatbotMessage = useCallback(
    (message: AgentServerMessage, conversationId?: string): ChatbotMessage => ({
      id: message.id,
      role:
        message.role ?? (message.user_id === user.id ? 'user' : 'assistant'),
      text: message.content,
      ...(conversationId ? { conversationId } : {}),
    }),
    [user.id]
  )

  const appendMessage = useCallback((message: ChatbotMessage) => {
    setMessages(prev => {
      const existingIndex = prev.findIndex(existing => existing.id === message.id)
      if (existingIndex !== -1) {
        if (message.role === 'status') {
          const nextMessages = [...prev]
          nextMessages[existingIndex] = {
            ...nextMessages[existingIndex],
            ...message,
          }
          return nextMessages
        }
        return prev
      }
      return [...prev, message]
    })
    
    if (message.role === 'status' && shouldAutoScroll) {
      setTimeout(() => {
        scrollToLatestStatusMessage()
      }, 10)
    }
  }, [setMessages, shouldAutoScroll, scrollToLatestStatusMessage])

  const clearReference = useCallback(
    (setReferenceText: (val: null) => void, setReferenceLines: (val: null) => void) => {
      setReferenceText(null)
      setReferenceLines(null)
    },
    []
  )

  const clearHoveredMessage = useCallback(
    (messageId: string, setHoveredMessageId: (fn: (current: string | null) => string | null) => void) => {
      setHoveredMessageId(currentMessageId =>
        currentMessageId === messageId ? null : currentMessageId
      )
    },
    []
  )

  const copyMessage = useCallback((content: string) => {
    navigator.clipboard?.writeText(content).catch(() => {})
  }, [])

  return {
    createMessageId,
    toChatbotMessage,
    appendMessage,
    clearReference,
    clearHoveredMessage,
    copyMessage,
  }
}
