import { useCallback } from 'react'
import { AgentConversation } from '../types/chatbot-types'
import { postJSON, deleteJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

export const useConversationUtilities = (
  apiPath: (path: string) => string,
  setConversations: (fn: (prev: AgentConversation[]) => AgentConversation[]) => void,
  activeConversationId: string | null,
  setActiveConversationId: (id: string | null) => void,
  setMessages: (fn: (prev: any[]) => any[]) => void,
  conversations: AgentConversation[]
) => {
  const sortConversations = useCallback((items: AgentConversation[]) => {
    return [...items].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [])

  const upsertConversation = useCallback(
    (conversation: AgentConversation) => {
      setConversations(prev => {
        const index = prev.findIndex(item => item.id === conversation.id)
        if (index === -1) {
          return sortConversations([conversation, ...prev])
        }
        const next = [...prev]
        next[index] = { ...next[index], ...conversation }
        return sortConversations(next)
      })
    },
    [setConversations, sortConversations]
  )

  const createConversation = useCallback(async () => {
    const conversation = await postJSON<AgentConversation>(
      apiPath('/conversations')
    )
    upsertConversation(conversation)
    setActiveConversationId(conversation.id)
    setMessages([])
    return conversation
  }, [apiPath, upsertConversation, setActiveConversationId, setMessages])

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      const conversation = conversations.find(c => c.id === conversationId)
      if (!conversation) return

      // Check if the conversation being deleted has content (not the current one)
      const hasContent = conversation.lastMessageAt !== null
      
      // If conversation has content, ask for confirmation
      if (hasContent) {
        const confirmed = window.confirm(
          `Are you sure you want to delete "${conversation.title}"? This cannot be undone.`
        )
        if (!confirmed) return
      }

      try {
        await deleteJSON(apiPath(`/conversations/${conversationId}`))
        
        // Calculate remaining conversations
        const remainingConversations = conversations.filter(
          c => c.id !== conversationId
        )
        
        // Remove from conversations list
        setConversations(() => remainingConversations)
        
        // If this was the active conversation, switch to another or create new
        if (activeConversationId === conversationId) {
          if (remainingConversations.length > 0) {
            setActiveConversationId(remainingConversations[0].id)
          } else {
            await createConversation()
          }
        }
      } catch (error) {
        debugConsole.error(error)
      }
    },
    [apiPath, conversations, activeConversationId, createConversation, setConversations, setActiveConversationId]
  )

  return {
    sortConversations,
    upsertConversation,
    createConversation,
    handleDeleteConversation,
  }
}
