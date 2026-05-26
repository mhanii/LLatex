import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import { resolveChatDockSide } from '../../../util/chat-dock'
import { ChatbotMessage, AgentConversation, AgentServerMessage, AgentToolCallEvent } from '../types/chatbot-types'
import { toolEventToMessage } from '../utils/tool-utils'
import { isSafeToStream, splitStreamingMarkdown } from '../utils/streaming-utils'
import { renderStatusText } from '../utils/render-utils'
import { getFullFilePathForTooltip, openEntityByPathUtil } from '../utils/file-operations'
import { useStatusGroupUtilities } from './useStatusGroupUtilities'
import { consumePendingChatbotPrefill, listenToChatbotPrefill } from '../chatbot-prefill-events'

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
  resolvedQuestionRunIds: string[]
  setResolvedQuestionRunIds: React.Dispatch<React.SetStateAction<string[]>>
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
    setResolvedQuestionRunIds,
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
    resizeInput,
    applyPrefill,
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

  // Persistent banner for the rare partial-rollback case. The initiating
  // tab also sees this surfaced via the confirmation modal (controller's
  // rollbackToMessage throws), but secondary tabs only know about the
  // partial state through the `partial: true` field on the realtime
  // event. Without this banner they'd silently end up with stale chat
  // state on next reload.
  const [rollbackPartialNotice, setRollbackPartialNotice] = useState<string | null>(null)
  const dismissRollbackPartialNotice = useCallback(() => {
    setRollbackPartialNotice(null)
  }, [])
  // Tracks the messageId that THIS tab is rolling back. Used to suppress
  // the WS-driven banner on the initiating tab — the modal already shows
  // the partial-state warning there, so the banner would be redundant.
  const initiatedRollbackMessageIdRef = useRef<string | null>(null)

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

      return [...toolEvents.map(toolEvent => toolEventToMessage({ ...toolEvent, conversationId: toolEvent.conversationId ?? conversationId ?? '' })), chatbotMessage]
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
  
  // Roll the project back to the version captured when this user message
  // was sent, and prune the message + everything after from the local
  // conversation. Backend handles the heavy lifting (RestoreManager and
  // chat-service cleanup); we just mirror the truncation in state.
  // Re-throws on failure so the caller (the confirmation modal) can show
  // the error to the user — silently swallowing errors here makes the
  // modal appear to close successfully even when the rollback failed.
  const rollbackToMessage = useCallback(
    async (messageId: string) => {
      const conversationId = activeConversationIdRef.current
      if (!conversationId) {
        throw new Error('No active conversation.')
      }
      const targetIndex = messagesRef.current.findIndex(
        message => message.id === messageId
      )
      if (targetIndex < 0) {
        throw new Error('Message not found.')
      }
      const target = messagesRef.current[targetIndex]
      if (target.role !== 'user' || typeof target.projectVersionBefore !== 'number') {
        throw new Error('Rollback is unavailable for this message.')
      }
      let partial = false
      initiatedRollbackMessageIdRef.current = messageId
      try {
        await postJSON(
          apiPath(
            `/conversations/${conversationId}/messages/${messageId}/rollback`
          ),
          { body: {} }
        )
      } catch (error: any) {
        debugConsole.error(error)
        const data = error?.data ?? error?.body ?? {}
        const code = data.error
        if (code === 'history_not_supported') {
          throw new Error(
            "This project doesn't have ranges-aware history enabled, so rollback isn't available."
          )
        }
        if (code === 'no_recorded_version') {
          throw new Error(
            data.message ?? 'No recorded version for this message.'
          )
        }
        if (code === 'run_in_flight') {
          throw new Error(
            data.message ??
              'The agent is still working on this conversation. Cancel the current run before rolling back.'
          )
        }
        if (code === 'rollback_partial') {
          // Project files WERE reverted; conversation cleanup failed.
          // Truncate locally so the visible state at least matches the
          // project, then surface the warning so the user knows to
          // refresh for an authoritative view on the chat thread.
          partial = true
        } else {
          throw new Error(
            data.message ?? error?.message ?? 'Rollback failed.'
          )
        }
      }
      // Truncate locally. The realtime `agent:conversation-rolled-back`
      // event also triggers truncation for other tabs / collaborators; the
      // duplicate is harmless because filtering by index is idempotent.
      // Slice-by-index also drops the status messages between the user
      // message and the assistant reply — they have client-side ids the
      // backend doesn't know about, so filter-by-id can't reach them.
      if (activeRunIdRef.current) {
        canceledRunIdsRef.current.add(activeRunIdRef.current)
        activeRunIdRef.current = null
        activeRunConversationIdRef.current = null
      }
      delete pendingStatusEventsRef.current[conversationId]
      setIsAwaitingAgentResponse(false)
      setIsSending(false)
      setMessagesWithRef(prev => {
        const idx = prev.findIndex(message => message.id === messageId)
        if (idx < 0) return prev
        return prev.slice(0, idx)
      })
      if (partial) {
        throw new Error(
          'Project files were restored, but cleaning up the conversation ' +
            'failed. Refresh the page to sync the chat thread.'
        )
      }
    },
    [
      apiPath,
      activeConversationIdRef,
      setMessagesWithRef,
      setIsAwaitingAgentResponse,
      setIsSending,
    ]
  )

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

  const submitMessage = useCallback(async (messageText?: string, options?: { visible?: boolean; questionRunId?: string | null }) => {
    const rawText = messageText ?? input
    const trimmed = rawText.trim()
    const visible = options?.visible ?? true
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

    if (visible && editingMessageId) {
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
    } else if (visible) {
      appendMessage(pendingMessage)
    }

    if (messageText == null) {
      setInput('')
    }
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
      if (!visible && options?.questionRunId) {
        setResolvedQuestionRunIds(prev =>
          prev.includes(options.questionRunId!) ? prev : [...prev, options.questionRunId!]
        )
      }

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
      if (visible) {
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
      }
    } catch (error) {
        if (abortController.signal.aborted) return
        debugConsole.error(error)
        if (visible) {
          // Capture the ID that was being edited BEFORE it gets cleared
          const editingId = editingMessageId
          
          setMessagesWithRef(prev =>
            prev.map(message => {
              const isTargetMessage = (message.id === pendingId) || 
                (editingId !== null && message.id === editingId)
              
              if (isTargetMessage && message.conversationId === conversationId) {
                // Don't modify the original text - show error separately
                return { 
                  ...message, 
                  pending: false,
                  // Keep original text intact, add error indicator
                  error: 'Failed to send message'
                }
              }
              return message
            })
          )
        }
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
    setResolvedQuestionRunIds,
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

    const runId = activeRunIdRef.current
    const conversationId = activeRunConversationIdRef.current ?? activeConversationIdRef.current

    if (!conversationId) return

    if (!runId) {
      // Queue pending cancel when runId hasn't arrived yet
      // Only skip if we're not actually expecting a run (i.e., just awaiting question response)
      // We know we're expecting a run if isSending or isAwaitingAgentResponse is true
      if (isSending || isAwaitingAgentResponse) {
        pendingCancelRef.current = { conversationId }
      }
      return
    }

    canceledRunIdsRef.current.add(runId)
    postJSON(
      apiPath(`/conversations/${conversationId}/runs/${runId}/cancel`),
      { body: {} }
    ).catch(debugConsole.error)
  }, [
    activeConversationIdRef,
    activeRunConversationIdRef,
    activeRunIdRef,
    apiPath,
    cancelActiveStreaming,
    cleanupPendingToolsForConversation,
    isAwaitingAgentResponse,
    isSending,
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

      setMessagesWithRef(prev => prev.filter(message => {
        if (message.conversationId !== payload.conversationId) return true
        return !message.questions?.length
      }))
      
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

    function receivedConversationRolledBack(payload: {
      conversationId: string
      rolledBackToMessageId: string
      rolledBackToVersion: number
      removedMessageIds?: string[]
      // Set true by the backend when truncateFromMessage threw after
      // revertProject succeeded — project files are restored but the
      // server-side conversation metadata could not be cleaned up. The
      // initiating tab already sees this via the modal (the controller's
      // rollbackToMessage rejects with the partial code); secondary tabs
      // surface the same warning via the persistent banner exposed below.
      partial?: boolean
    }) {
      if (payload.conversationId !== activeConversationIdRef.current) return
      // Cancel any in-flight cancel/run state and clear pending status
      // events so flushPendingStatusMessages can't resurrect rolled-back
      // tool events. Treat rollback like a run cancellation for state
      // bookkeeping — the agent run for this turn is effectively gone.
      if (activeRunIdRef.current) {
        canceledRunIdsRef.current.add(activeRunIdRef.current)
        activeRunIdRef.current = null
        activeRunConversationIdRef.current = null
      }
      delete pendingStatusEventsRef.current[payload.conversationId]
      setIsAwaitingAgentResponse(false)
      setIsSending(false)

      if (
        payload.partial &&
        initiatedRollbackMessageIdRef.current !== payload.rolledBackToMessageId
      ) {
        // Secondary tab (we didn't initiate this rollback). The DB is in
        // a partial state — surface a banner so the user knows their
        // chat view may drift on reload until they refresh. The
        // initiating tab gets the same warning via its modal, so we
        // suppress the banner there to avoid double-notification.
        setRollbackPartialNotice(
          'A rollback in another tab partially completed — project files were restored ' +
            'but the conversation could not be cleaned up. Refresh to sync your view.'
        )
      }

      const removed = new Set([
        payload.rolledBackToMessageId,
        ...(payload.removedMessageIds ?? []),
      ])
      setMessagesWithRef(prev => {
        // Slice-by-index removes status messages too. Filter-by-id misses
        // them because status messages have client-side ids that the
        // backend doesn't know about.
        const idx = prev.findIndex(
          message => message.id === payload.rolledBackToMessageId
        )
        if (idx >= 0) return prev.slice(0, idx)
        // Already pruned locally (POST handler beat us to it). Fall back
        // to filter-by-id to clear any remaining removed messages, and
        // drop status messages from this conversation that no longer have
        // a sibling user/assistant message after them.
        const filtered = prev.filter(message => !removed.has(message.id))
        // Drop trailing status messages that belong to the cancelled run.
        const lastNonStatus = [...filtered]
          .reverse()
          .findIndex(message => message.role !== 'status')
        if (lastNonStatus === -1) {
          return filtered.filter(m => m.role !== 'status')
        }
        const cutoff = filtered.length - lastNonStatus
        return filtered.slice(0, cutoff)
      })
    }

    socket.on('agent:message', receivedAgentMessage)
    socket.on('agent:tool-call', receivedToolCall)
    socket.on('agent:cancelled', receivedAgentCancelled)
    socket.on('agent:conversation-rolled-back', receivedConversationRolledBack)

    return () => {
      socket.removeListener('agent:message', receivedAgentMessage)
      socket.removeListener('agent:tool-call', receivedToolCall)
      socket.removeListener('agent:cancelled', receivedAgentCancelled)
      socket.removeListener(
        'agent:conversation-rolled-back',
        receivedConversationRolledBack
      )
    }
  }, [activeConversationIdRef, appendMessage, cancelActiveStreaming, cleanupPendingToolsForConversation, completePendingToolsForConversation, flushPendingStatusMessages, handleToolCallEvent, messagesRef, setConversations, setIsAwaitingAgentResponse, setIsSending, setMessagesWithRef, setRollbackPartialNotice, socket, streamAssistantMessage, toChatbotMessage, userId])
  
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
    rollbackToMessage,
    rollbackPartialNotice,
    dismissRollbackPartialNotice,
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
