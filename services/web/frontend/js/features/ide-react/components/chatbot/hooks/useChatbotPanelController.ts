import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef } from 'react'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import { resolveChatDockSide } from '../../../util/chat-dock'
import { ChatbotMessage, AgentConversation, AgentServerMessage, AgentToolCallEvent } from '../types/chatbot-types'
import { toolEventToMessage } from '../utils/tool-utils'
import { isSafeToStream, splitStreamingMarkdown } from '../utils/streaming-utils'
import { renderStatusText } from '../utils/render-utils'
import { getFullFilePathForTooltip, openEntityByPathUtil } from '../utils/file-operations'
import { useStatusGroupUtilities } from './useStatusGroupUtilities'

export type ChatbotPanelControllerArgs = {
  projectId: string
  userId: string | null
  socket: any
  conversations: AgentConversation[]
  setConversations: React.Dispatch<React.SetStateAction<AgentConversation[]>>
  activeConversationId: string | null
  setActiveConversationId: React.Dispatch<React.SetStateAction<string | null>>
  messages: ChatbotMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ChatbotMessage[]>>
  input: string
  setInput: React.Dispatch<React.SetStateAction<string>>
  isSending: boolean
  setIsSending: React.Dispatch<React.SetStateAction<boolean>>
  isAwaitingAgentResponse: boolean
  setIsAwaitingAgentResponse: React.Dispatch<React.SetStateAction<boolean>>
  setIsLoadingMessages: React.Dispatch<React.SetStateAction<boolean>>
  isLoadingMessages: boolean
  referenceText: string | null
  setReferenceText: React.Dispatch<React.SetStateAction<string | null>>
  referenceLines: { start: number; end: number } | null
  setReferenceLines: React.Dispatch<React.SetStateAction<{ start: number; end: number } | null>>
  editingMessageId: string | null
  setEditingMessageId: React.Dispatch<React.SetStateAction<string | null>>
  shouldAutoScroll: boolean
  setShouldAutoScroll: React.Dispatch<React.SetStateAction<boolean>>
  expandedStatusGroupIds: string[]
  setExpandedStatusGroupIds: React.Dispatch<React.SetStateAction<string[]>>
  collapsedStatusGroupIds: string[]
  setCollapsedStatusGroupIds: React.Dispatch<React.SetStateAction<string[]>>
  shouldAutoScrollRef: React.MutableRefObject<boolean>
  activeConversationIdRef: React.MutableRefObject<string | null>
  inputRef: React.RefObject<HTMLTextAreaElement>
  messagesContainerRef: React.RefObject<HTMLDivElement>
  panelRef: React.RefObject<HTMLElement>
  counterRef: React.MutableRefObject<number>
  apiPath: (path: string) => string
  createConversation: () => Promise<AgentConversation>
  appendMessage: (message: ChatbotMessage) => void
  toChatbotMessage: (message: AgentServerMessage, conversationId?: string) => ChatbotMessage
  createMessageId: (prefix: 'user' | 'assistant' | 'status') => string
  resizeInput: () => void
  applyPrefill: (payload: { text?: string; referenceText?: string; referenceLines?: { start: number; end: number } | null }) => void
  handleMessagesScroll: () => void
  setChatIsOpen: (open: boolean) => void
  chatDockSide: string
  chatDockDragging: boolean
  setChatDockSide: (side: any) => void
  setChatDockDragging: (dragging: boolean) => void
  setChatDockDragOffset: (offset: number) => void
  setChatPanelSizeLeft?: (size: number) => void
  setChatPanelSizeRight?: (size: number) => void
  setEditorPanelOpen: (open: boolean) => void
  setView: (view: any) => void
  autoCompactedGroupIds: string[]
  setAutoCompactedGroupIds: React.Dispatch<React.SetStateAction<string[]>>
  fileTreeData?: any
  editorManager?: any
  setHoveredMessageId?: React.Dispatch<React.SetStateAction<string | null>>
  messageGroups: any[]
}

export function useChatbotPanelController(args: ChatbotPanelControllerArgs) {
  const {
    userId,
    socket,
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
    isAwaitingAgentResponse,
    setIsAwaitingAgentResponse,
    setIsLoadingMessages,
    isLoadingMessages,
    referenceText,
    setReferenceText,
    referenceLines,
    setReferenceLines,
    editingMessageId,
    setEditingMessageId,
    shouldAutoScroll,
    setShouldAutoScroll,
    expandedStatusGroupIds,
    setExpandedStatusGroupIds,
    collapsedStatusGroupIds,
    setCollapsedStatusGroupIds,
    shouldAutoScrollRef,
    activeConversationIdRef,
    inputRef,
    messagesContainerRef,
    panelRef,
    apiPath,
    createConversation,
    appendMessage,
    toChatbotMessage,
    createMessageId,
    handleMessagesScroll,
    setChatIsOpen,
    chatDockSide,
    chatDockDragging,
    setChatDockSide,
    setChatDockDragging,
    setChatDockDragOffset,
    setChatPanelSizeLeft,
    setChatPanelSizeRight,
    setEditorPanelOpen,
    setView,
    autoCompactedGroupIds,
    setAutoCompactedGroupIds,
  } = args
  const { fileTreeData, editorManager, setHoveredMessageId, messageGroups } = args

  const dragStartXRef = useRef<number | null>(null)
  const dragStartCenterXRef = useRef<number | null>(null)
  const messagesRef = useRef<ChatbotMessage[]>(messages)
  const pendingStatusEventsRef = useRef<Record<string, AgentToolCallEvent[]>>({})
  const submitAbortControllerRef = useRef<AbortController | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const activeRunConversationIdRef = useRef<string | null>(null)
  const canceledRunIdsRef = useRef<Set<string>>(new Set())
  const generationStoppedRef = useRef(false)
  // pendingCancelRef holds an in-flight stop request waiting on a runId — the
  // user clicked Stop before the POST /agent/message round-trip returned, so
  // we have no runId to send to the backend yet. Once the runId arrives in
  // submitMessage we cancel immediately.
  const pendingCancelRef = useRef<{ conversationId: string } | null>(null)
  const simulationStopRef = useRef(false)
  const simulationConversationIdRef = useRef<string | null>(null)
  const initialScrollConversationIdRef = useRef<string | null>(null)
  const prevIsAwaitingRef = useRef(isAwaitingAgentResponse);
  const activeStreamingTokenRef = useRef(0)

  const setMessagesWithRef = useCallback((newMessages: ChatbotMessage[] | ((prev: ChatbotMessage[]) => ChatbotMessage[])) => {
    setMessages(prev => {
      const next = typeof newMessages === 'function' ? newMessages(prev) : newMessages
      messagesRef.current = next
      return next
    })
  }, [setMessages])

  const cancelActiveStreaming = useCallback(() => {
    activeStreamingTokenRef.current += 1
  }, [])

  useEffect(() => {
    return () => {
      cancelActiveStreaming()
    }
  }, [cancelActiveStreaming])

  // Belt-and-suspenders sync for messagesRef. setMessagesWithRef updates the
  // ref synchronously inside its updater, but appendMessage (from
  // useMessageUtilities) bypasses it and uses setMessages directly. Without
  // this effect, code that reads messagesRef.current in async handlers
  // (notably flushPendingStatusMessages) would not see appendMessage's
  // inserts and the synthesis branch would be unreachable.
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  
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
    [panelRef, setChatDockDragOffset, setChatDockDragging]
  )

  const finishChatDockDragLocal = useCallback(
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

  const scrollToLatestStatusMessage = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    setTimeout(() => {
      const statusWrappers = container.querySelectorAll('.ide-chatbot-status-wrapper')
      if (statusWrappers.length === 0) return

      const lastWrapper = statusWrappers[statusWrappers.length - 1]
      const messagesList = lastWrapper.querySelector('.ide-chatbot-status-messages-list')
      if (messagesList && messagesList.children.length > 0) {
        const lastMessage = messagesList.children[messagesList.children.length - 1]
        lastMessage.scrollIntoView({ behavior: 'auto', block: 'nearest' })
      } else {
        lastWrapper.scrollIntoView({ behavior: 'auto', block: 'end' })
      }
    }, 10)
  }, [messagesContainerRef])

  const flushPendingStatusMessages = useCallback(
    (conversationId: string) => {
      const pendingEvents = pendingStatusEventsRef.current[conversationId] || []
      if (!pendingEvents || pendingEvents.length === 0) {
        return
      }

      delete pendingStatusEventsRef.current[conversationId]

      for (const pendingEvent of pendingEvents) {
        const pendingMsgId = pendingEvent.toolCallId ?? `${pendingEvent.runId}-${pendingEvent.toolName}`
        const existingMessage = messagesRef.current.find(message => message.id === pendingMsgId)

        if (existingMessage) {
          appendMessage(
            toolEventToMessage(
              pendingEvent.status === 'completed' || pendingEvent.status === 'error'
                ? pendingEvent
                : {
                    conversationId: existingMessage.conversationId ?? conversationId,
                    runId: existingMessage.id,
                    toolCallId: existingMessage.id,
                    toolName: existingMessage.toolName ?? pendingEvent.toolName,
                    input: existingMessage.toolInput,
                    status: 'completed',
                    timestamp: pendingEvent.timestamp,
                  }
            )
          )
          continue
        }

        appendMessage(toolEventToMessage(pendingEvent))
      }
    },
    [appendMessage]
  )

  const handleToolCallEvent = useCallback(
    (payload: AgentToolCallEvent) => {
      if (payload.conversationId !== activeConversationIdRef.current) return
      if (canceledRunIdsRef.current.has(payload.runId)) return
      if (generationStoppedRef.current) return

      const statusId = payload.toolCallId ?? `${payload.runId}-${payload.toolName}`

      if (payload.status === 'running') {
        flushPendingStatusMessages(payload.conversationId)
        appendMessage(toolEventToMessage(payload))

        const pendingEvents = pendingStatusEventsRef.current[payload.conversationId] ?? []
        pendingEvents.push(payload)
        pendingStatusEventsRef.current[payload.conversationId] = pendingEvents
        return
      }

      if (payload.status === 'error') {
        flushPendingStatusMessages(payload.conversationId)
        appendMessage(toolEventToMessage(payload))
        return
      }

      const pendingEvents = pendingStatusEventsRef.current[payload.conversationId] ?? []
      const nextPendingEvents = pendingEvents.filter(event => {
        const pendingId = event.toolCallId ?? `${event.runId}-${event.toolName}`
        return pendingId !== statusId
      })

      nextPendingEvents.push(payload)
      pendingStatusEventsRef.current[payload.conversationId] = nextPendingEvents
    },
    [activeConversationIdRef, appendMessage, flushPendingStatusMessages]
  )

  const focusInputAtEnd = useCallback((text: string) => {
    setInput(text)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(text.length, text.length)
    })
  }, [inputRef, setInput])

  const openEntityByPath = useCallback(
    (fileName: string) => {
      if (!fileTreeData || !editorManager) {
        debugConsole.warn('fileTreeData or editorManager not available')
        return
      }

      openEntityByPathUtil(fileName, fileTreeData, editorManager, setEditorPanelOpen, setView)
    },
    [editorManager, fileTreeData, setEditorPanelOpen, setView]
  )

  const getFullFilePathForTooltipLocal = useCallback(
    (fileName: string) => {
      return getFullFilePathForTooltip(fileName, fileTreeData)
    },
    [fileTreeData]
  )

  const renderStatusTextLocal = useCallback(
    (text: string) => renderStatusText(text, openEntityByPath, getFullFilePathForTooltipLocal),
    [getFullFilePathForTooltipLocal, openEntityByPath]
  )

  const toLoadedChatbotMessages = useCallback(
    (message: AgentServerMessage, conversationId?: string): ChatbotMessage[] => {
      const chatbotMessage = toChatbotMessage(message, conversationId)
      const toolEvents = message.toolEvents ?? []

      if (toolEvents.length === 0) {
        return [chatbotMessage]
      }

      return [...toolEvents.map(toolEvent => toolEventToMessage(toolEvent)), chatbotMessage]
    },
    [toChatbotMessage]
  )

  const startEditingMessage = useCallback(
    (messageId: string) => {
      const message = messages.find(
        candidate => candidate.id === messageId && candidate.role === 'user'
      )
      if (!message) return
      setEditingMessageId(message.id)
      focusInputAtEnd(message.text)
    },
    [focusInputAtEnd, messages, setEditingMessageId]
  )

  const cancelEditing = useCallback(() => {
    setEditingMessageId(null)
    focusInputAtEnd('')
  }, [focusInputAtEnd, setEditingMessageId])

  const clearHoveredMessage = useCallback((messageId: string) => {
    setHoveredMessageId?.((currentMessageId: string | null) =>
      currentMessageId === messageId ? null : currentMessageId
    )
  }, [setHoveredMessageId])

  const copyMessage = useCallback((content: string) => {
    navigator.clipboard?.writeText(content).catch(() => {})
  }, [])

  const streamAssistantMessage = useCallback(async (
    messageId: string,
    conversationId: string,
    fullText: string
  ) => {
    const streamToken = ++activeStreamingTokenRef.current
    
    const cleanupOnCancel = () => {
      setMessagesWithRef(prev => prev.map(message => {
        if (message.id !== messageId || message.conversationId !== conversationId) {
          return message
        }
        return {
          ...message,
          isStreaming: false,
          streamingText: undefined,
          text: fullText,
        }
      }))
    }

    const chunks = splitStreamingMarkdown(fullText)
    let bufferedText = ''
    let renderedText = ''

    const updateStreamingMessage = (nextText: string, isStreaming: boolean) => {
      setMessagesWithRef(prev => prev.map(message => {
        if (message.id !== messageId || message.conversationId !== conversationId) {
          return message
        }

        return {
          ...message,
          text: fullText,
          streamingText: nextText,
          isStreaming,
        }
      }))

      if (shouldAutoScrollRef.current && messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      }
    }

    updateStreamingMessage('', true)

    for (const chunk of chunks) {
      if (streamToken !== activeStreamingTokenRef.current) {
        cleanupOnCancel()
        return false
      }

      bufferedText += chunk

      const chunkDelayMs = chunk.includes('\n')
        ? 72
        : /[.!?]\s*$/.test(chunk)
          ? 48
          : chunk.trim().length < 8
            ? 18
            : 24

      const shouldFlushBufferedText =
        bufferedText.length > 0 &&
        isSafeToStream(bufferedText) &&
        (chunk.includes('\n') || /[.!?]\s*$/.test(bufferedText) || bufferedText.length >= 32)

      if (shouldFlushBufferedText) {
        renderedText += bufferedText
        bufferedText = ''
        updateStreamingMessage(renderedText, true)
      }

      await new Promise(resolve => setTimeout(resolve, chunkDelayMs))
    }

    // Check again after the loop completes (cancellation could have happened during final delay)
    if (streamToken !== activeStreamingTokenRef.current) {
      cleanupOnCancel()
      return false
    }

    renderedText += bufferedText
    updateStreamingMessage(renderedText, false)
    return true
  }, [setMessagesWithRef, shouldAutoScrollRef, messagesContainerRef])

  const clearReference = useCallback(() => {
    setReferenceText(null)
    setReferenceLines(null)
  }, [setReferenceLines, setReferenceText])

  const closeChatbot = useCallback(() => {
    setChatIsOpen(false)
  }, [setChatIsOpen])

  const handleNewChat = useCallback(async () => {
    const hasUserMessages = messages.some(msg => msg.role === 'user')
    if (!hasUserMessages) return
    await createConversation().catch(debugConsole.error)
  }, [createConversation, messages])

  const simulateToolCall = useCallback(
    (
      toolName: string,
      input?: Record<string, unknown>,
      status: 'running' | 'completed' | 'error' = 'running',
      durationMs: number = 1500
    ) => {
      const baseEvent = {
        conversationId: activeConversationId || 'debug-conversation',
        runId: `debug-run-${Date.now()}`,
        toolName,
        input,
        timestamp: Date.now(),
      }

      const statusId = `${baseEvent.runId}-${toolName}`
      const run = () => handleToolCallEvent({ ...baseEvent, toolCallId: statusId, status })

      if (status === 'running') {
        run()
        if (shouldAutoScroll) {
          setTimeout(scrollToLatestStatusMessage, 10)
        }
        return
      }

      handleToolCallEvent({ ...baseEvent, toolCallId: statusId, status: 'running' })
      if (shouldAutoScroll) {
        setTimeout(scrollToLatestStatusMessage, 10)
      }

      setTimeout(() => {
        handleToolCallEvent(
          status === 'completed'
            ? { ...baseEvent, toolCallId: statusId, status: 'completed' }
            : {
                ...baseEvent,
                toolCallId: statusId,
                status: 'error',
                error: 'File not found or permission denied',
              }
        )
        if (shouldAutoScroll) {
          scrollToLatestStatusMessage()
        }
      }, durationMs)
    },
    [activeConversationId, handleToolCallEvent, scrollToLatestStatusMessage, shouldAutoScroll]
  )

  const submitMessage = useCallback(async () => {
    const trimmed = input.trim()
    const isGenerating = isSending || isAwaitingAgentResponse
    if (!trimmed || isGenerating) return

    const conversation =
      activeConversationId == null
        ? await createConversation()
        : conversations.find(item => item.id === activeConversationId) ?? null
    const conversationId = conversation?.id ?? activeConversationId
    if (!conversationId) return

    const pendingId = createMessageId('user')
    const pendingMessage: ChatbotMessage = {
      id: pendingId,
      role: 'user',
      text: trimmed,
      pending: true,
      conversationId,
    }

    if (editingMessageId) {
      setMessagesWithRef(prev => {
        const messageIndex = prev.findIndex(message => message.id === editingMessageId)
        if (messageIndex < 0) return prev
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

    const abortController = new AbortController()
    submitAbortControllerRef.current = abortController

    try {
      const result = await postJSON<{ runId: string; messageId: string; conversationId: string }>(apiPath('/message'), {
        signal: abortController.signal,
        swallowAbortError: false,
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

      if (abortController.signal.aborted) return

      setActiveConversationId(result.conversationId)
      activeRunIdRef.current = result.runId
      activeRunConversationIdRef.current = result.conversationId
      setIsAwaitingAgentResponse(true)

      // The user clicked Stop before we knew the runId. Fire the cancel now.
      // The generating-state stays on; the agent:cancelled socket event will
      // clear it once the backend confirms.
      if (pendingCancelRef.current?.conversationId === result.conversationId) {
        pendingCancelRef.current = null
        canceledRunIdsRef.current.add(result.runId)
        postJSON(
          apiPath(
            `/conversations/${result.conversationId}/runs/${result.runId}/cancel`
          ),
          { body: {} }
        ).catch(debugConsole.error)
      }
      setMessagesWithRef(prev => {
        if (
          prev.some(
            message => message.id === result.messageId && message.conversationId === result.conversationId
          )
        ) {
          return prev.filter(
            message => !(message.id === pendingId && message.conversationId === result.conversationId)
          )
        }
        return prev.map(message =>
          (message.id === pendingId || message.id === editingMessageId) && message.conversationId === result.conversationId
            ? { ...message, id: result.messageId, pending: false }
            : message
        )
      })
    } catch (error) {
      if (abortController.signal.aborted) {
        return
      }
      debugConsole.error(error)
      setMessagesWithRef(prev =>
        prev.map(message =>
          (message.id === pendingId || message.id === editingMessageId) && message.conversationId === conversationId
            ? { ...message, pending: false, text: `${message.text}\n\nFailed to send.` }
            : message
        )
      )
    } finally {
      if (submitAbortControllerRef.current === abortController) {
        submitAbortControllerRef.current = null
      }
      setIsSending(false)
    }
  }, [
    activeConversationId,
    apiPath,
    appendMessage,
    conversations,
    createConversation,
    createMessageId,
    editingMessageId,
    input,
    isSending,
    isAwaitingAgentResponse,
    referenceLines,
    referenceText,
    setActiveConversationId,
    setInput,
    setIsSending,
    setIsAwaitingAgentResponse,
    setMessagesWithRef,
    setReferenceLines,
    setReferenceText,
    setEditingMessageId,
  ])

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitMessage()
  }, [submitMessage])

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitMessage()
    }
  }, [submitMessage])

  const jumpToLatestMessage = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
    setShouldAutoScroll(true)
  }, [messagesContainerRef, setShouldAutoScroll])

  const shouldShowToggleForGroup = useMemo(() => (groupId: string) => autoCompactedGroupIds.includes(groupId), [autoCompactedGroupIds])

  const {
    statusGroupIds: computedStatusGroupIds,
    latestStatusGroupId,
    isStatusGroupExpanded,
    toggleStatusGroup,
  } = useStatusGroupUtilities(
    messageGroups,
    expandedStatusGroupIds,
    collapsedStatusGroupIds,
    setExpandedStatusGroupIds,
    setCollapsedStatusGroupIds,
    handleMessagesScroll
  )

  const cleanupPendingToolsForConversation = useCallback((conversationId: string) => {
    // Clean up pending status events
    if (pendingStatusEventsRef.current[conversationId]) {
      delete pendingStatusEventsRef.current[conversationId]
    }
    
    // Clean up any messages that are still in 'running' state for this conversation
    setMessagesWithRef(prev => {
      let hasChanges = false
      const next = prev.map(message => {
        if (message.conversationId === conversationId && 
            message.role === 'status' && 
            message.status === 'running') {
          hasChanges = true
          return {
            ...message,
            status: 'error' as const,
            text: `${message.text} (interrupted)`
          }
        }
        return message
      })
      return hasChanges ? next : prev
    })
  }, [setMessagesWithRef])

  const completePendingToolsForConversation = useCallback((conversationId: string) => {
    // Clear stale pending events first
    if (pendingStatusEventsRef.current[conversationId]) {
      delete pendingStatusEventsRef.current[conversationId]
    }
    
    // Complete any pending status messages for this conversation
    setMessagesWithRef(prev => {
      let hasChanges = false
      const next = prev.map(message => {
        if (message.conversationId === conversationId && 
            message.role === 'status' && 
            message.status === 'running') {
          hasChanges = true
          return {
            ...message,
            status: 'completed' as const,
            text: message.text.replace(/^Agent is (.*?)\.\.\.$/, 'Finished $1.')
          }
        }
        return message
      })
      return hasChanges ? next : prev
    })
  }, [setMessagesWithRef])

  const stopGeneration = useCallback(() => {
    // Local debug simulation: halt the simulated stream immediately and clear
    // generating state. This path never talks to the backend.
    if (simulationConversationIdRef.current) {
      simulationStopRef.current = true
      cancelActiveStreaming()
      const conversationId = simulationConversationIdRef.current
      cleanupPendingToolsForConversation(conversationId)
      simulationConversationIdRef.current = null
      setIsAwaitingAgentResponse(false)
      setIsSending(false)
      return
    }

    // Real run: send the cancel request but KEEP isSending /
    // isAwaitingAgentResponse on. The generating button + animation remain
    // visible until the backend confirms by emitting agent:cancelled — that
    // socket event is what clears the generating state.
    //
    // The button stays clickable on purpose. Backend cancellation is
    // idempotent (cancelling a finished/cancelled run is a no-op), so a user
    // whose first POST silently dropped can simply click again. Disabling
    // the button on first click would risk freezing the UI for the lifetime
    // of the run if the cancel callback never arrives.
    const runId = activeRunIdRef.current
    const conversationId =
      activeRunConversationIdRef.current ?? activeConversationIdRef.current

    if (!conversationId) return

    if (!runId) {
      // POST /agent/message hasn't returned yet; we don't know the runId.
      // Queue the cancellation and let submitMessage fire it when the runId
      // arrives.
      pendingCancelRef.current = { conversationId }
      return
    }

    canceledRunIdsRef.current.add(runId)
    postJSON(
      apiPath(`/conversations/${conversationId}/runs/${runId}/cancel`),
      { body: {} }
    ).catch(debugConsole.error)
  }, [
    activeConversationIdRef,
    apiPath,
    cancelActiveStreaming,
    cleanupPendingToolsForConversation,
    setIsAwaitingAgentResponse,
    setIsSending,
  ])

  const simulateFullConversation = useCallback(async () => {
    if (isSending || isAwaitingAgentResponse) {
      debugConsole.warn('Already sending a message, cannot simulate conversation')
      return
    }

    simulationStopRef.current = false
    setIsSending(true)

    const simConversationId = activeConversationId || `sim-conv-${Date.now()}`
    const simRunId = `sim-run-${Date.now()}`
    simulationConversationIdRef.current = simConversationId

    const waitWithStopCheck = async (durationMs: number) => {
      const interval = 50
      let elapsed = 0
      while (elapsed < durationMs) {
        if (simulationStopRef.current) return false
        const step = Math.min(interval, durationMs - elapsed)
        await new Promise(resolve => setTimeout(resolve, step))
        elapsed += step
      }
      return !simulationStopRef.current
    }

    try {
      if (simulationStopRef.current) return

      // User message
      const userMessageId = createMessageId('user')
      appendMessage({
        id: userMessageId,
        role: 'user',
        text: 'Analyze the project structure and create a config file',
        conversationId: simConversationId,
      })

      if (!(await waitWithStopCheck(500))) return

      // Tool sequence with shorter durations for testing
      const tools = [
        { name: 'list_files', input: {}, duration: 800 },
        { name: 'read_file', input: { path: 'src/main.py' }, duration: 600 },
        { name: 'read_file', input: { path: 'src/config.py' }, duration: 500 },
        { name: 'create_file', input: { path: 'src/new_config.yaml' }, duration: 400 },
        { name: 'edit_file', input: { path: 'src/new_config.yaml' }, duration: 300 },
      ]

      for (let i = 0; i < tools.length; i++) {
        const tool = tools[i]
        const toolId = `${simRunId}-${tool.name}-${i}`
        
        // Start tool
        handleToolCallEvent({
          conversationId: simConversationId,
          runId: simRunId,
          toolCallId: toolId,
          toolName: tool.name,
          status: 'running',
          input: tool.input,
          timestamp: Date.now(),
        })

        // Wait for completion
        if (!(await waitWithStopCheck(tool.duration))) return
        
        // Complete tool
        handleToolCallEvent({
          conversationId: simConversationId,
          runId: simRunId,
          toolCallId: toolId,
          toolName: tool.name,
          status: 'completed',
          input: tool.input,
          timestamp: Date.now(),
        })
        
        // Force flush pending events
        flushPendingStatusMessages(simConversationId)

        // Agent thinking time between tools
        if (i < tools.length - 1) {
          if (!(await waitWithStopCheck(300))) return
        }
      }

      // Wait a bit before sending the assistant message
      if (!(await waitWithStopCheck(400))) return
      
      // Stream the assistant message
      const assistantMessage = `I've analyzed your project. Found main.py and config.py, and created src/new_config.yaml with appropriate structure. The configuration includes database settings and API endpoints based on your existing setup. Need any adjustments?`

      const assistantMessageId = createMessageId('assistant')
      appendMessage({
        id: assistantMessageId,
        role: 'assistant',
        text: assistantMessage,
        streamingText: '',
        isStreaming: true,
        conversationId: simConversationId,
      })

      await streamAssistantMessage(assistantMessageId, simConversationId, assistantMessage)

      // Final flush
      flushPendingStatusMessages(simConversationId)

    } catch (error) {
      debugConsole.error('Error in simulation:', error)
      if (simConversationId) {
        cleanupPendingToolsForConversation(simConversationId)
      }
    } finally {
      simulationStopRef.current = false
      simulationConversationIdRef.current = null
      setIsSending(false)
    }
  }, [
    activeConversationId,
    appendMessage,
    cleanupPendingToolsForConversation,
    createMessageId,
    flushPendingStatusMessages,
    handleToolCallEvent,
    isAwaitingAgentResponse,
    isSending,
    setIsSending,
    streamAssistantMessage,
  ])

  useEffect(() => {
    if (isAwaitingAgentResponse) {
      generationStoppedRef.current = false
    }
  }, [isAwaitingAgentResponse])

  useEffect(() => {
    // When active conversation changes, clean up the old conversation's pending events
    const pendingStatusEvents = pendingStatusEventsRef.current
    return () => {
      if (activeConversationId) {
        cancelActiveStreaming()  // ← Add this line
        cleanupPendingToolsForConversation(activeConversationId)
        delete pendingStatusEventsRef.current[activeConversationId]
        delete pendingStatusEvents[activeConversationId]
      }
    }
  }, [activeConversationId, cancelActiveStreaming, cleanupPendingToolsForConversation])

  useEffect(() => {
    shouldAutoScrollRef.current = shouldAutoScroll
  }, [shouldAutoScroll, shouldAutoScrollRef])

  useEffect(() => {
    const validGroupIds = new Set(computedStatusGroupIds)
    setExpandedStatusGroupIds(prev => {
      const next = prev.filter(id => validGroupIds.has(id))
      return next.length === prev.length ? prev : next
    })
    setCollapsedStatusGroupIds(prev => {
      const next = prev.filter(id => validGroupIds.has(id))
      return next.length === prev.length ? prev : next
    })
    setAutoCompactedGroupIds(prev => {
      const next = prev.filter(id => validGroupIds.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [computedStatusGroupIds, setCollapsedStatusGroupIds, setExpandedStatusGroupIds, setAutoCompactedGroupIds])

  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant') return

    const groupsToAutoCompact = computedStatusGroupIds.filter(id => !autoCompactedGroupIds.includes(id))
    if (groupsToAutoCompact.length === 0) return

    const container = messagesContainerRef.current
    let savedScrollTop: number | null = null
    
    if (container && !shouldAutoScrollRef.current) {
      savedScrollTop = container.scrollTop
    }

    setAutoCompactedGroupIds(prev => [...prev, ...groupsToAutoCompact])
    setCollapsedStatusGroupIds(prev => [...prev, ...groupsToAutoCompact])
    setExpandedStatusGroupIds(prev => prev.filter(id => !groupsToAutoCompact.includes(id)))

    if (container && savedScrollTop !== null) {
      requestAnimationFrame(() => {
        const currentContainer = messagesContainerRef.current
        if (currentContainer && savedScrollTop !== null) {
          currentContainer.scrollTop = savedScrollTop
        }
      })
    }
  }, [autoCompactedGroupIds, computedStatusGroupIds, messages, setAutoCompactedGroupIds, setCollapsedStatusGroupIds, setExpandedStatusGroupIds, shouldAutoScrollRef, messagesContainerRef])

  useEffect(() => {
    // When we transition from awaiting response to not awaiting (generation finished or stopped)
    if (prevIsAwaitingRef.current === true && isAwaitingAgentResponse === false) {
      // Collapse any status groups that aren't already collapsed
      const groupsToCollapse = computedStatusGroupIds.filter(id => 
        !autoCompactedGroupIds.includes(id) && !collapsedStatusGroupIds.includes(id)
      );
      
      if (groupsToCollapse.length > 0) {
        setAutoCompactedGroupIds(prev => [...prev, ...groupsToCollapse]);
        setCollapsedStatusGroupIds(prev => [...prev, ...groupsToCollapse]);
        setExpandedStatusGroupIds(prev => prev.filter(id => !groupsToCollapse.includes(id)));
      }
    }
    prevIsAwaitingRef.current = isAwaitingAgentResponse;
  }, [isAwaitingAgentResponse, computedStatusGroupIds, autoCompactedGroupIds, collapsedStatusGroupIds, setAutoCompactedGroupIds, setCollapsedStatusGroupIds, setExpandedStatusGroupIds]);

  useEffect(() => {
    let cancelled = false
    getJSON<AgentConversation[]>(apiPath('/conversations'))
      .then(async fetchedConversations => {
        if (cancelled) return
        const sortedConversations = [...fetchedConversations].sort((a, b) => b.updatedAt - a.updatedAt)
        setConversations(sortedConversations)
        if (sortedConversations[0]) {
          setActiveConversationId(sortedConversations[0].id)
        } else {
          await createConversation()
        }
      })
      .catch(error => debugConsole.error(error))
    return () => {
      cancelled = true
    }
  }, [apiPath, createConversation, setActiveConversationId, setConversations])

  useEffect(() => {
    if (!activeConversationId) return

    const controller = new AbortController()
    setIsLoadingMessages(true)
    setMessagesWithRef(prev =>
      prev.filter(
        message =>
          (message.pending || message.role === 'status') &&
          message.conversationId === activeConversationId
      )
    )

    getJSON<AgentServerMessage[]>(apiPath(`/conversations/${activeConversationId}/messages`), {
      signal: controller.signal,
    })
      .then(serverMessages => {
        if (controller.signal.aborted) return
        const loadedMessages = serverMessages.flatMap(message =>
          toLoadedChatbotMessages(message, activeConversationId)
        )
        setMessagesWithRef(prev => {
          const loadedIds = new Set(loadedMessages.map(message => message.id))
          const localMessages = prev.filter(
            message =>
              (message.pending || message.role === 'status') &&
              message.conversationId === activeConversationId
          )
          return [...loadedMessages, ...localMessages.filter(message => !loadedIds.has(message.id))]
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
  }, [activeConversationId, apiPath, setIsLoadingMessages, setMessagesWithRef, toChatbotMessage])

  useEffect(() => {
    if (!socket) return

    function receivedAgentMessage(payload: { 
      conversationId: string; 
      conversation?: AgentConversation; 
      message: AgentServerMessage 
    }) {
      if (payload.conversation && payload.conversation.createdBy !== userId) return
      if (
        payload.conversation?.lastRunId && 
        canceledRunIdsRef.current.has(payload.conversation.lastRunId)
      ) return

      if (payload.conversation) {
        const conversation = payload.conversation
        setConversations(prev => {
          const index = prev.findIndex(item => item.id === conversation.id)
          if (index === -1) {
            return [conversation, ...prev].sort((a, b) => b.updatedAt - a.updatedAt)
          }
          const next = [...prev]
          next[index] = { ...next[index], ...conversation }
          return [...next].sort((a, b) => b.updatedAt - a.updatedAt)
        })
      }
      
      if (payload.conversationId !== activeConversationIdRef.current) return
      
      flushPendingStatusMessages(payload.conversationId) // First, process any completed tools

      if (payload.message.role === 'assistant') {
        completePendingToolsForConversation(payload.conversationId) // Then, complete any still-running tools
        setIsAwaitingAgentResponse(false)
        if (payload.conversation?.lastRunId && payload.conversation.lastRunId === activeRunIdRef.current) {
          activeRunIdRef.current = null
        }

        const chatbotMessage = toChatbotMessage(payload.message, payload.conversationId)
        const existingMessage = messagesRef.current.find(message => message.id === chatbotMessage.id)

        if (!existingMessage) {
          appendMessage({
            ...chatbotMessage,
            text: chatbotMessage.text,
            streamingText: '',
            isStreaming: true,
          })
          streamAssistantMessage(chatbotMessage.id, payload.conversationId, chatbotMessage.text).catch(error => {
            debugConsole.error(error)
          })
        } else {
          appendMessage(chatbotMessage)
        }

        return
      }

      appendMessage(toChatbotMessage(payload.message, payload.conversationId))
    }

    function receivedToolCall(payload: AgentToolCallEvent) {
      handleToolCallEvent(payload)
    }

    // Backend confirmation that a cancel POST landed and the agent run was
    // unwound. Until this event arrives the generating UI stays on, so the
    // user sees the animation continue between clicking Stop and the agent
    // actually halting.
    function receivedAgentCancelled(payload: { conversationId: string; runId: string }) {
      if (payload.conversationId !== activeConversationIdRef.current) return
      cancelActiveStreaming()
      canceledRunIdsRef.current.add(payload.runId)
      cleanupPendingToolsForConversation(payload.conversationId)
      
      // Reset any assistant messages that might be stuck streaming for this conversation
      setMessagesWithRef(prev => prev.map(message => {
        if (message.conversationId === payload.conversationId && message.isStreaming) {
          return {
            ...message,
            isStreaming: false,
            streamingText: undefined,
          }
        }
        return message
      }))
      
      if (activeRunIdRef.current === payload.runId) {
        activeRunIdRef.current = null
        activeRunConversationIdRef.current = null
      }
      if (pendingCancelRef.current?.conversationId === payload.conversationId) {
        pendingCancelRef.current = null
      }
      submitAbortControllerRef.current?.abort()
      submitAbortControllerRef.current = null
      setIsAwaitingAgentResponse(false)
      setIsSending(false)
    }

    socket.on('agent:message', receivedAgentMessage)
    socket.on('agent:tool-call', receivedToolCall)
    socket.on('agent:cancelled', receivedAgentCancelled)

    return () => {
      socket.removeListener('agent:message', receivedAgentMessage)
      socket.removeListener('agent:tool-call', receivedToolCall)
      socket.removeListener('agent:cancelled', receivedAgentCancelled)
    }
  }, [activeConversationIdRef, appendMessage, cancelActiveStreaming, cleanupPendingToolsForConversation, completePendingToolsForConversation, flushPendingStatusMessages, handleToolCallEvent, messagesRef, setConversations, setIsAwaitingAgentResponse, setIsSending, socket, streamAssistantMessage, toChatbotMessage, userId])

  useEffect(() => {
    if (!panelRef.current) return
    let timeout: number | null = null
    const saveSize = () => {
      const el = panelRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const container = el.parentElement ?? document.documentElement
      const containerRect = container.getBoundingClientRect()
      const percent = Math.max(5, Math.min(40, (rect.width / containerRect.width) * 100))
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
  }, [chatDockDragging, chatDockSide, panelRef, setChatPanelSizeLeft, setChatPanelSizeRight])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    container.addEventListener('scroll', handleMessagesScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleMessagesScroll)
  }, [handleMessagesScroll, messagesContainerRef])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container || !shouldAutoScroll) return
    
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage) return
    
    // Only skip auto-scroll for a brief moment (200ms) after assistant message appears
    // This gives the animation a chance to start without jumping
    if (lastMessage.role === 'assistant') {
      const timeoutId = setTimeout(() => {
        if (shouldAutoScrollRef.current && messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
        }
      }, 200)
      return () => clearTimeout(timeoutId)
    }
    
    if (lastMessage.role !== 'status') {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, messagesContainerRef, shouldAutoScroll, shouldAutoScrollRef])

  useEffect(() => {
    if (isLoadingMessages) return
    if (!activeConversationId) return
    if (messages.length === 0) return
    if (initialScrollConversationIdRef.current === activeConversationId) return

    const container = messagesContainerRef.current
    if (!container) return

    initialScrollConversationIdRef.current = activeConversationId

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const currentContainer = messagesContainerRef.current
        if (!currentContainer) return
        currentContainer.scrollTop = currentContainer.scrollHeight
      })
    })
  }, [activeConversationId, isLoadingMessages, messages.length, messagesContainerRef])

  useEffect(() => {
    if (!chatDockDragging) return

    const handlePointerMove = (event: PointerEvent) => {
      if (dragStartXRef.current == null) return
      setChatDockDragOffset(event.clientX - dragStartXRef.current)
    }

    const handlePointerUp = (event: PointerEvent) => {
      finishChatDockDragLocal(event.clientX)
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
  }, [chatDockDragging, finishChatDockDragLocal, setChatDockDragOffset, setChatDockDragging])

  return {
    scrollToLatestStatusMessage,
    focusInputAtEnd,
    renderStatusTextLocal,
    startEditingMessage,
    cancelEditing,
    clearHoveredMessage,
    copyMessage,
    clearReference,
    closeChatbot,
    handleNewChat,
    simulateToolCall,
    simulateFullConversation,
    stopGeneration,
    submitMessage,
    handleSubmit,
    handleInputKeyDown,
    jumpToLatestMessage,
    shouldShowToggleForGroup,
    latestStatusGroupId,
    isStatusGroupExpanded,
    toggleStatusGroup,
    openEntityByPath,
    getFullFilePathForTooltipLocal,
    handleMessagesScroll,
    dragStartXRef,
    dragStartCenterXRef,
    computedStatusGroupIds,
    handleChatHeaderPointerDown,
  }
}
