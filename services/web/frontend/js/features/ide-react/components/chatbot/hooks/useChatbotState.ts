import { useState, useRef, useCallback, useEffect } from 'react'
import { ChatbotMessage, AgentConversation } from '../types/chatbot-types'
import { buildMessageGroups } from '../utils/message-grouping'

export const useChatbotState = () => {
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatbotMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [_isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [referenceText, setReferenceText] = useState<string | null>(null)
  const [referenceLines, setReferenceLines] = useState<{
    start: number
    end: number
  } | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true)
  const [expandedStatusGroupIds, setExpandedStatusGroupIds] = useState<string[]>([])
  const [collapsedStatusGroupIds, setCollapsedStatusGroupIds] = useState<string[]>([])

  const counterRef = useRef(0)
  const activeConversationIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const shouldAutoScrollRef = useRef(shouldAutoScroll)

  const messageGroups = buildMessageGroups(messages)

  return {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    messages,
    setMessages,
    input,
    setInput,
    isSending,
    setIsSending,
    _isLoadingMessages,
    setIsLoadingMessages,
    referenceText,
    setReferenceText,
    referenceLines,
    setReferenceLines,
    editingMessageId,
    setEditingMessageId,
    hoveredMessageId,
    setHoveredMessageId,
    shouldAutoScroll,
    setShouldAutoScroll,
    expandedStatusGroupIds,
    setExpandedStatusGroupIds,
    collapsedStatusGroupIds,
    setCollapsedStatusGroupIds,
    counterRef,
    activeConversationIdRef,
    inputRef,
    messagesContainerRef,
    panelRef,
    shouldAutoScrollRef,
    messageGroups,
  }
}
