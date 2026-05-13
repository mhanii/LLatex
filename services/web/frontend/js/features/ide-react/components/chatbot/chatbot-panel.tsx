import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import classNames from 'classnames'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { useIdeContext } from '@/shared/context/ide-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '@/shared/context/user-context'
import { debugConsole } from '@/utils/debugging'
import {
  consumePendingChatbotPrefill,
  listenToChatbotPrefill,
} from './chatbot-prefill-events'
import { resolveChatDockSide } from '../../util/chat-dock'
import { ChatbotMarkdown } from './chatbot-markdown'

type ChatbotMessage = {
  id: string
  role: 'user' | 'assistant' | 'status'
  text: string
  pending?: boolean
  conversationId?: string
}

type AgentConversation = {
  id: string
  createdBy: string
  title: string
  createdAt: number
  updatedAt: number
  lastMessageAt: number | null
  lastRunId: string | null
}

type AgentServerMessage = {
  id: string
  content: string
  timestamp: number
  user_id: string
  role?: 'user' | 'assistant'
}

type AgentToolCallEvent = {
  conversationId: string
  runId: string
  toolCallId?: string
  toolName: string
  status: 'running' | 'completed' | 'error'
  input?: Record<string, unknown>
  error?: string
  timestamp: number
}

type ChatbotPrefillPayload = {
  text?: string
  referenceText?: string
  referenceLines?: {
    start: number
    end: number
  } | null
}

export default function ChatbotPanel() {
  const { projectId } = useProjectContext()
  const user = useUserContext()
  const { socket } = useIdeContext()
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  )
  const [messages, setMessages] = useState<ChatbotMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [referenceText, setReferenceText] = useState<string | null>(null)
  const [referenceLines, setReferenceLines] = useState<{
    start: number
    end: number
  } | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true)
  const counterRef = useRef(0)
  const activeConversationIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const dragStartXRef = useRef<number | null>(null)
  const dragStartCenterXRef = useRef<number | null>(null)
  activeConversationIdRef.current = activeConversationId
  const {
    setChatIsOpen,
    chatDockSide,
    chatDockDragging,
    setChatDockSide,
    setChatDockDragging,
    setChatDockDragOffset,
    setChatPanelSizeLeft,
    setChatPanelSizeRight,
  } = useLayoutContext()

  const apiPath = useCallback(
    (path: string) => `/project/${projectId}/agent${path}`,
    [projectId]
  )

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId
  }, [activeConversationId])

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
  }, [])

  const canSend = useMemo(
    () => input.trim().length > 0 && !isSending,
    [input, isSending]
  )
  const isEditing = editingMessageId !== null
  const referenceLabel = useMemo(() => {
    if (!referenceLines) {
      return null
    }

    return referenceLines.start === referenceLines.end
      ? `Line ${referenceLines.start}`
      : `Lines ${referenceLines.start}-${referenceLines.end}`
  }, [referenceLines])

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
      if (prev.some(existing => existing.id === message.id)) {
        return prev
      }
      return [...prev, message]
    })
  }, [])

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
    [sortConversations]
  )

  const createConversation = useCallback(async () => {
    const conversation = await postJSON<AgentConversation>(
      apiPath('/conversations')
    )
    upsertConversation(conversation)
    setActiveConversationId(conversation.id)
    setMessages([])
    return conversation
  }, [apiPath, upsertConversation])

  const closeChatbot = useCallback(() => {
    setChatIsOpen(false)
  }, [setChatIsOpen])

  const clearReference = useCallback(() => {
    setReferenceText(null)
    setReferenceLines(null)
  }, [])

  const finishChatDockDrag = useCallback(
    (clientX: number) => {
      const dragStartX = dragStartXRef.current
      const dragStartCenterX = dragStartCenterXRef.current

      if (dragStartX == null || dragStartCenterX == null) {
        setChatDockDragging(false)
        setChatDockDragOffset(0)
        return
      }

      const dragOffset = clientX - dragStartX
      const dropCenterX = dragStartCenterX + dragOffset
      const nextSide = resolveChatDockSide(dropCenterX, window.innerWidth)

      setChatDockSide(nextSide)
      setChatDockDragging(false)
      setChatDockDragOffset(0)
      dragStartXRef.current = null
      dragStartCenterXRef.current = null
    },
    [setChatDockDragOffset, setChatDockDragging, setChatDockSide]
  )

  const handleChatHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return
      }

      if (
        event.target instanceof Element &&
        (event.target.closest('button') || event.target.closest('select'))
      ) {
        return
      }

      const panelElement = panelRef.current
      if (!panelElement) {
        return
      }

      const rect = panelElement.getBoundingClientRect()
      dragStartXRef.current = event.clientX
      dragStartCenterXRef.current = rect.left + rect.width / 2
      setChatDockDragging(true)
      setChatDockDragOffset(0)
      event.preventDefault()
    },
    [setChatDockDragOffset, setChatDockDragging]
  )

  const focusInputAtEnd = useCallback((text: string) => {
    setInput(text)

    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(text.length, text.length)
    })
  }, [])

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
    [focusInputAtEnd]
  )

  const startEditingMessage = useCallback(
    (messageId: string) => {
      const message = messages.find(
        message => message.id === messageId && message.role === 'user'
      )

      if (!message) {
        return
      }

      setEditingMessageId(message.id)
      focusInputAtEnd(message.text)
    },
    [focusInputAtEnd, messages]
  )

  const cancelEditing = useCallback(() => {
    setEditingMessageId(null)
    focusInputAtEnd('')
  }, [focusInputAtEnd])

  const clearHoveredMessage = useCallback((messageId: string) => {
    setHoveredMessageId(currentMessageId =>
      currentMessageId === messageId ? null : currentMessageId
    )
  }, [])

  const copyMessage = useCallback((content: string) => {
    navigator.clipboard?.writeText(content).catch(() => {})
  }, [])

  const toolSubject = useCallback(
    (toolName: string, toolInput?: Record<string, unknown>) => {
      const path = toolInput?.path ?? toolInput?.oldPath ?? toolInput?.file
      const newPath = toolInput?.newPath
      const page = toolInput?.page
      switch (toolName) {
        case 'list_files':
          return 'scanning project files'
        case 'read_file':
          return path ? `reading ${path}` : 'reading a file'
        case 'create_file':
          return path ? `creating ${path}` : 'creating a file'
        case 'edit_file':
          return path ? `editing ${path}` : 'editing a file'
        case 'delete_file':
          return path ? `deleting ${path}` : 'deleting a file'
        case 'move_file':
          return path && newPath
            ? `moving ${path} to ${newPath}`
            : 'moving a file'
        case 'get_outline':
          return 'reading the outline'
        case 'check_syntax':
          return 'checking syntax'
        case 'compile_and_check':
          return 'compiling'
        case 'get_pdf_page':
          return page ? `reading PDF page ${page}` : 'reading the PDF'
        case 'list_skills':
          return 'checking available skills'
        case 'read_skill':
          return path ? `reading skill ${path}` : 'reading a skill'
        default:
          return toolName.replaceAll('_', ' ')
      }
    },
    []
  )

  const toolEventToMessage = useCallback(
    (event: AgentToolCallEvent): ChatbotMessage => {
      const subject = toolSubject(event.toolName, event.input)
      const text =
        event.status === 'running'
          ? `Agent is ${subject}...`
          : event.status === 'completed'
            ? `Finished ${subject}.`
            : `Could not finish ${subject}${event.error ? `: ${event.error}` : '.'}`

      return {
        id: createMessageId('status'),
        role: 'status',
        text,
        conversationId: event.conversationId,
      }
    },
    [createMessageId, toolSubject]
  )

  useEffect(() => {
    let cancelled = false

    getJSON<AgentConversation[]>(apiPath('/conversations'))
      .then(async fetchedConversations => {
        if (cancelled) return
        const sortedConversations = sortConversations(fetchedConversations)
        setConversations(sortedConversations)
        if (sortedConversations[0]) {
          setActiveConversationId(sortedConversations[0].id)
        } else {
          await createConversation()
        }
      })
      .catch(error => {
        debugConsole.error(error)
      })

    return () => {
      cancelled = true
    }
  }, [apiPath, createConversation, sortConversations])

  useEffect(() => {
    if (!activeConversationId) {
      return
    }

    const controller = new AbortController()
    setIsLoadingMessages(true)
    setMessages(prev =>
      prev.filter(
        message =>
          (message.pending || message.role === 'status') &&
          message.conversationId === activeConversationId
      )
    )
    getJSON<AgentServerMessage[]>(
      apiPath(`/conversations/${activeConversationId}/messages`),
      { signal: controller.signal }
    )
      .then(serverMessages => {
        if (controller.signal.aborted) return
        const loadedMessages = serverMessages.map(m =>
          toChatbotMessage(m, activeConversationId)
        )
        setMessages(prev => {
          const loadedIds = new Set(loadedMessages.map(message => message.id))
          const localMessages = prev.filter(
            message =>
              (message.pending || message.role === 'status') &&
              message.conversationId === activeConversationId
          )
          return [
            ...loadedMessages,
            ...localMessages.filter(message => !loadedIds.has(message.id)),
          ]
        })
      })
      .catch(error => {
        if (controller.signal.aborted) return
        debugConsole.error(error)
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingMessages(false)
        }
      })

    return () => controller.abort()
  }, [activeConversationId, apiPath, toChatbotMessage])

  useEffect(() => {
    if (!socket) return

    function receivedAgentMessage(payload: {
      conversationId: string
      conversation?: AgentConversation
      message: AgentServerMessage
    }) {
      if (
        payload.conversation &&
        payload.conversation.createdBy !== user.id
      ) {
        return
      }
      if (payload.conversation) {
        upsertConversation(payload.conversation)
      }
      if (payload.conversationId !== activeConversationIdRef.current) {
        return
      }
      appendMessage(toChatbotMessage(payload.message, payload.conversationId))
    }

    function receivedToolCall(payload: AgentToolCallEvent) {
      if (payload.conversationId !== activeConversationIdRef.current) {
        return
      }
      appendMessage(toolEventToMessage(payload))
    }

    socket.on('agent:message', receivedAgentMessage)
    socket.on('agent:tool-call', receivedToolCall)

    return () => {
      socket.removeListener('agent:message', receivedAgentMessage)
      socket.removeListener('agent:tool-call', receivedToolCall)
    }
  }, [
    appendMessage,
    socket,
    toChatbotMessage,
    toolEventToMessage,
    upsertConversation,
    user.id,
  ])

  useEffect(() => {
    const pendingText = consumePendingChatbotPrefill()
    if (pendingText) {
      applyPrefill(pendingText)
    }

    return listenToChatbotPrefill(applyPrefill)
  }, [applyPrefill])

  useEffect(() => {
    resizeInput()
  }, [input, resizeInput])

  useEffect(() => {
    if (!panelRef.current) return
    let timeout: number | null = null
    const saveSize = () => {
      const el = panelRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const container = el.parentElement ?? document.documentElement
      const containerRect = container.getBoundingClientRect()
      const percent = Math.max(
        5,
        Math.min(90, (rect.width / containerRect.width) * 100)
      )
      if (chatDockSide === 'left') {
        setChatPanelSizeLeft?.(percent)
      } else {
        setChatPanelSizeRight?.(percent)
      }
    }

    const ro = new (window as any).ResizeObserver(() => {
      if (timeout) {
        window.clearTimeout(timeout)
      }
      timeout = window.setTimeout(() => {
        if (!chatDockDragging) saveSize()
      }, 120)
    })

    ro.observe(panelRef.current)
    const onWindowResize = () => {
      if (timeout) window.clearTimeout(timeout)
      timeout = window.setTimeout(() => {
        if (!chatDockDragging) saveSize()
      }, 120)
    }
    window.addEventListener('resize', onWindowResize)

    if (!chatDockDragging) saveSize()

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWindowResize)
      if (timeout) window.clearTimeout(timeout)
    }
  }, [chatDockSide, chatDockDragging, setChatPanelSizeLeft, setChatPanelSizeRight])

  const submitMessage = async () => {
    const trimmed = input.trim()
    if (!trimmed || isSending) {
      return
    }

    const conversation =
      activeConversationId == null
        ? await createConversation()
        : conversations.find(item => item.id === activeConversationId) ?? null
    const conversationId = conversation?.id ?? activeConversationId
    if (!conversationId) {
      return
    }

    const pendingId = createMessageId('user')
    const pendingMessage: ChatbotMessage = {
      id: pendingId,
      role: 'user',
      text: trimmed,
      pending: true,
      conversationId,
    }

    if (isEditing && editingMessageId) {
      setMessages(prev => {
        const messageIndex = prev.findIndex(
          message => message.id === editingMessageId
        )

        if (messageIndex < 0) {
          return prev
        }

        return [
          ...prev.slice(0, messageIndex),
          {
            ...prev[messageIndex],
            text: trimmed,
            pending: true,
          },
        ]
      })
      setEditingMessageId(null)
    } else {
      appendMessage(pendingMessage)
    }

    setInput('')
    setReferenceText(null)
    setReferenceLines(null)
    setIsSending(true)

    try {
      const result = await postJSON<{
        runId: string
        messageId: string
        conversationId: string
      }>(apiPath('/message'), {
        body: {
          message: trimmed,
          conversationId,
          ...(referenceText
            ? {
                selection: {
                  content: referenceText,
                  ...(referenceLines
                    ? {
                        fromLine: referenceLines.start - 1,
                        toLine: referenceLines.end - 1,
                      }
                    : {}),
                },
              }
            : {}),
        },
      })

      setActiveConversationId(result.conversationId)
      setMessages(prev => {
        if (
          prev.some(
            message =>
              message.id === result.messageId &&
              message.conversationId === result.conversationId
          )
        ) {
          return prev.filter(
            message =>
              !(
                message.id === pendingId &&
                message.conversationId === result.conversationId
              )
          )
        }
        return prev.map(message =>
          (message.id === pendingId || message.id === editingMessageId) &&
          message.conversationId === result.conversationId
            ? { ...message, id: result.messageId, pending: false }
            : message
        )
      })
    } catch (error) {
      debugConsole.error(error)
      setMessages(prev =>
        prev.map(message =>
          (message.id === pendingId || message.id === editingMessageId) &&
          message.conversationId === conversationId
            ? {
                ...message,
                pending: false,
                text: `${message.text}\n\nFailed to send.`,
              }
            : message
        )
      )
    } finally {
      setIsSending(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitMessage()
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitMessage()
    }
  }

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) {
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = container
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
    setShouldAutoScroll(isNearBottom)
  }, [])

  const jumpToLatestMessage = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
    setShouldAutoScroll(true)
  }, [])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) {
      return
    }

    container.addEventListener('scroll', handleMessagesScroll)
    return () => {
      container.removeEventListener('scroll', handleMessagesScroll)
    }
  }, [handleMessagesScroll])

  useEffect(() => {
    if (!shouldAutoScroll) {
      return
    }

    const container = messagesContainerRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }, [messages, shouldAutoScroll])

  useEffect(() => {
    if (!chatDockDragging) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (dragStartXRef.current == null) {
        return
      }

      setChatDockDragOffset(event.clientX - dragStartXRef.current)
    }

    const handlePointerUp = (event: PointerEvent) => {
      finishChatDockDrag(event.clientX)
    }

    const handlePointerCancel = () => {
      setChatDockDragging(false)
      setChatDockDragOffset(0)
      dragStartXRef.current = null
      dragStartCenterXRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [
    chatDockDragging,
    finishChatDockDrag,
    setChatDockDragOffset,
    setChatDockDragging,
  ])

  return (
    <section
      ref={panelRef}
      className="ide-chatbot-panel"
      aria-label="Chatbot panel"
      data-chat-dock-side={chatDockSide}
    >
      <header
        className="ide-chatbot-panel-header"
        onPointerDown={handleChatHeaderPointerDown}
      >
        <div className="ide-chatbot-panel-title-row">
          <h3 className="ide-chatbot-panel-title">Chatbot</h3>
          <select
            className="ide-chatbot-panel-conversation-select"
            value={activeConversationId ?? ''}
            onChange={event => setActiveConversationId(event.target.value)}
            aria-label="Agent conversation"
          >
            {conversations.map(conversation => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
        </div>
        <OLTooltip
          id="new-chatbot-conversation"
          description="New chat"
          overlayProps={{ placement: 'bottom' }}
        >
          <OLIconButton
            onClick={() => {
              createConversation().catch(debugConsole.error)
            }}
            className="ide-chatbot-panel-header-button-subdued"
            icon="add"
            accessibilityLabel="New chat"
            size="sm"
          />
        </OLTooltip>
        <OLTooltip
          id="close-chatbot-panel"
          description="Close chatbot"
          overlayProps={{ placement: 'bottom' }}
        >
          <OLIconButton
            onClick={closeChatbot}
            className="ide-chatbot-panel-header-button-subdued"
            icon="close"
            accessibilityLabel="Close chatbot"
            size="sm"
          />
        </OLTooltip>
      </header>

      <div className="ide-chatbot-panel-messages-wrapper">
        <div
          ref={messagesContainerRef}
          className="ide-chatbot-panel-messages"
          role="log"
          aria-live="polite"
        >
          {messages.map(message => (
            <article
              key={message.id}
              className={classNames('ide-chatbot-message', {
                'ide-chatbot-message-user': message.role === 'user',
                'ide-chatbot-message-bot': message.role === 'assistant',
                'ide-chatbot-message-status': message.role === 'status',
                'ide-chatbot-message-editing': message.id === editingMessageId,
                'ide-chatbot-message-pending': message.pending,
              })}
              onMouseEnter={() => setHoveredMessageId(message.id)}
              onMouseLeave={() => clearHoveredMessage(message.id)}
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
                    <OLTooltip
                      id={`edit-chatbot-message-${message.id}`}
                      description="Edit message"
                      overlayProps={{ placement: 'bottom' }}
                    >
                      <OLIconButton
                        onClick={() => startEditingMessage(message.id)}
                        className="ide-chatbot-message-footer-button"
                        icon="edit"
                        accessibilityLabel="Edit message"
                        size="sm"
                      />
                    </OLTooltip>
                    <OLTooltip
                      id={`copy-chatbot-message-${message.id}`}
                      description="Copy message"
                      overlayProps={{ placement: 'bottom' }}
                    >
                      <OLIconButton
                        onClick={() => copyMessage(message.text)}
                        className="ide-chatbot-message-footer-button"
                        icon="content_copy"
                        accessibilityLabel="Copy message"
                        size="sm"
                      />
                    </OLTooltip>
                  </div>
                )}
                {message.role !== 'user' &&
                  hoveredMessageId === message.id &&
                  message.role !== 'status' && (
                    <div className="ide-chatbot-message-actions">
                      <OLTooltip
                        id={`copy-chatbot-message-${message.id}`}
                        description="Copy message"
                        overlayProps={{ placement: 'bottom' }}
                      >
                        <OLIconButton
                          onClick={() => copyMessage(message.text)}
                          className="ide-chatbot-message-copy-button"
                          icon="content_copy"
                          accessibilityLabel="Copy message"
                          size="sm"
                        />
                      </OLTooltip>
                    </div>
                  )}
              </div>
            </article>
          ))}
          {isLoadingMessages && (
            <article className="ide-chatbot-message ide-chatbot-message-status">
              <div className="ide-chatbot-message-body">
                <p className="ide-chatbot-message-content">Loading...</p>
              </div>
            </article>
          )}
        </div>

        {!shouldAutoScroll && (
          <button
            type="button"
            className="ide-chatbot-scroll-to-bottom"
            onClick={jumpToLatestMessage}
            aria-label="Go to latest message"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M12 5V18M12 18L7 13M12 18L17 13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      {isEditing && (
        <div className="ide-chatbot-panel-editing-banner" role="status">
          <span>Editing message</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm ide-chatbot-panel-cancel-edit"
            onClick={cancelEditing}
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
                  onClick={clearReference}
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

        <form className="ide-chatbot-panel-form" onSubmit={handleSubmit}>
          <textarea
            id="ide-chatbot-input"
            name="ide-chatbot-input"
            ref={inputRef}
            className="ide-chatbot-panel-input"
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
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
    </section>
  )
}
