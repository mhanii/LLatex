import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import { resolveChatDockSide } from '../../../util/chat-dock'
import { consumePendingChatbotPrefill, listenToChatbotPrefill } from '../chatbot-prefill-events'
import { ChatbotMessage, AgentConversation, AgentServerMessage, AgentToolCallEvent } from '../types/chatbot-types'
import { toolEventToMessage } from '../utils/tool-utils'
import { renderStatusText } from '../utils/render-utils'
import { useStatusGroupUtilities } from './useStatusGroupUtilities'

export type ChatbotPanelControllerArgs = {
  projectId: string
  userId: string
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
  setIsLoadingMessages: React.Dispatch<React.SetStateAction<boolean>>
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
  finishChatDockDrag: (clientX: number) => void
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
  statusGroupIds: string[]
  autoCompactedGroupIds: string[]
  setAutoCompactedGroupIds: React.Dispatch<React.SetStateAction<string[]>>
}

export function useChatbotPanelController(args: ChatbotPanelControllerArgs) {
  const {
    projectId,
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
    setIsLoadingMessages,
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
    counterRef,
    apiPath,
    createConversation,
    appendMessage,
    toChatbotMessage,
    createMessageId,
    resizeInput,
    applyPrefill,
    finishChatDockDrag,
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
    statusGroupIds,
    autoCompactedGroupIds,
    setAutoCompactedGroupIds,
  } = args

  const dragStartXRef = useRef<number | null>(null)
  const dragStartCenterXRef = useRef<number | null>(null)

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

  const scrollToLatestStatusMessages = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const statusWrappers = container.querySelectorAll('.ide-chatbot-status-wrapper')
    if (statusWrappers.length === 0) return

    const lastWrapper = statusWrappers[statusWrappers.length - 1]
    const messagesList = lastWrapper.querySelector('.ide-chatbot-status-messages-list')
    if (messagesList && messagesList.children.length > 0) {
      const lastMessage = messagesList.children[messagesList.children.length - 1]
      lastMessage.scrollIntoView({ behavior: 'auto', block: 'nearest' })
    }
  }, [messagesContainerRef])

  const focusInputAtEnd = useCallback((text: string) => {
    setInput(text)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(text.length, text.length)
    })
  }, [inputRef, setInput])

  const openEntityByPath = useCallback(
    (fileName: string) => {
      try {
        if (!args['fileTreeData']) {
          debugConsole.warn('fileTreeData not available')
          return
        }
        const fileTreeData = args['fileTreeData']
        const editorManager = args['editorManager']
        debugConsole.log('Trying to open file:', fileName)

        let result = findEntityByPath(fileTreeData, fileName)
        if (!result) {
          result = findEntityByNameInTree(fileTreeData, fileName)
        }

        if (!result) return

        if (result.type === 'fileRef') {
          setEditorPanelOpen(true)
          setView('file')
          editorManager.openFileWithId(result.entity._id)
        } else if (result.type === 'doc') {
          setEditorPanelOpen(true)
          setView('editor')
          editorManager.openDocWithId(result.entity._id)
        }
      } catch (error) {
        debugConsole.error('Error opening entity:', error)
      }
    },
    [args, setEditorPanelOpen, setView]
  )

  const getFullFilePathForTooltipLocal = useCallback(
    (fileName: string) => {
      const fileTreeData = args['fileTreeData']
      if (!fileTreeData) return fileName
      const result = findEntityByPath(fileTreeData, fileName)
      if (result) return fileName
      const named = findEntityByNameInTree(fileTreeData, fileName)
      return named ? named.fullPath : fileName
    },
    [args]
  )

  const renderStatusTextLocal = useCallback(
    (text: string) => renderStatusText(text, openEntityByPath, getFullFilePathForTooltipLocal),
    [getFullFilePathForTooltipLocal, openEntityByPath]
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
    args['setHoveredMessageId']((currentMessageId: string | null) =>
      currentMessageId === messageId ? null : currentMessageId
    )
  }, [args])

  const copyMessage = useCallback((content: string) => {
    navigator.clipboard?.writeText(content).catch(() => {})
  }, [])

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
      const run = () => appendMessage(toolEventToMessage({ ...baseEvent, toolCallId: statusId, status }))

      if (status === 'running') {
        run()
        if (shouldAutoScroll) {
          setTimeout(scrollToLatestStatusMessage, 10)
        }
        return
      }

      appendMessage(toolEventToMessage({ ...baseEvent, toolCallId: statusId, status: 'running' }))
      if (shouldAutoScroll) {
        setTimeout(scrollToLatestStatusMessage, 10)
      }

      setTimeout(() => {
        appendMessage(
          toolEventToMessage(
            status === 'completed'
              ? { ...baseEvent, toolCallId: statusId, status: 'completed' }
              : {
                  ...baseEvent,
                  toolCallId: statusId,
                  status: 'error',
                  error: 'File not found or permission denied',
                }
          )
        )
        if (shouldAutoScroll) {
          scrollToLatestStatusMessage()
        }
      }, durationMs)
    },
    [activeConversationId, appendMessage, scrollToLatestStatusMessage, shouldAutoScroll]
  )

  const submitMessage = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isSending) return

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
      setMessages(prev => {
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

    try {
      const result = await postJSON<{ runId: string; messageId: string; conversationId: string }>(apiPath('/message'), {
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
      debugConsole.error(error)
      setMessages(prev =>
        prev.map(message =>
          (message.id === pendingId || message.id === editingMessageId) && message.conversationId === conversationId
            ? { ...message, pending: false, text: `${message.text}\n\nFailed to send.` }
            : message
        )
      )
    } finally {
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
    referenceLines,
    referenceText,
    setActiveConversationId,
    setInput,
    setIsSending,
    setMessages,
    setReferenceLines,
    setReferenceText,
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
    (args as any).messageGroups,
    expandedStatusGroupIds,
    collapsedStatusGroupIds,
    setExpandedStatusGroupIds,
    setCollapsedStatusGroupIds,
    handleMessagesScroll
  )

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

    setAutoCompactedGroupIds(prev => [...prev, ...groupsToAutoCompact])
    setCollapsedStatusGroupIds(prev => [...prev, ...groupsToAutoCompact])
    setExpandedStatusGroupIds(prev => prev.filter(id => !groupsToAutoCompact.includes(id)))

    if (shouldAutoScrollRef.current) {
      scrollToLatestStatusMessages()
    }
  }, [autoCompactedGroupIds, computedStatusGroupIds, messages, scrollToLatestStatusMessages, setAutoCompactedGroupIds, setCollapsedStatusGroupIds, setExpandedStatusGroupIds, shouldAutoScrollRef])

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
    setMessages(prev =>
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
        const loadedMessages = serverMessages.map(message => toChatbotMessage(message, activeConversationId))
        setMessages(prev => {
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
  }, [activeConversationId, apiPath, setIsLoadingMessages, setMessages, toChatbotMessage])

  useEffect(() => {
    if (!socket) return

    function receivedAgentMessage(payload: { conversationId: string; conversation?: AgentConversation; message: AgentServerMessage }) {
      if (payload.conversation && payload.conversation.createdBy !== userId) return
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
      appendMessage(toChatbotMessage(payload.message, payload.conversationId))
    }

    function receivedToolCall(payload: AgentToolCallEvent) {
      if (payload.conversationId !== activeConversationIdRef.current) return
      appendMessage(toolEventToMessage(payload))
    }

    socket.on('agent:message', receivedAgentMessage)
    socket.on('agent:tool-call', receivedToolCall)

    return () => {
      socket.removeListener('agent:message', receivedAgentMessage)
      socket.removeListener('agent:tool-call', receivedToolCall)
    }
  }, [activeConversationIdRef, appendMessage, socket, toChatbotMessage, userId, setConversations])

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
    if (lastMessage && lastMessage.role !== 'status') {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, messagesContainerRef, shouldAutoScroll])

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
    scrollToLatestStatusMessages,
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

function findEntityByPath(fileTreeData: any, fileName: string): any {
  if (!fileTreeData) return null
  const stack = [fileTreeData]
  while (stack.length > 0) {
    const folder = stack.pop()
    const match = folder?.docs?.find((doc: any) => doc.name === fileName) ?? folder?.fileRefs?.find((fileRef: any) => fileRef.name === fileName)
    if (match) {
      return { entity: match, type: folder.docs?.includes(match) ? 'doc' : 'fileRef' }
    }
    if (folder?.folders) stack.push(...folder.folders)
  }
  return null
}

function findEntityByNameInTree(folder: any, fileName: string, currentPath = ''): { entity: any; type: 'fileRef' | 'doc'; fullPath: string } | null {
  const doc = folder.docs?.find((d: any) => d.name === fileName)
  if (doc) {
    const fullPath = currentPath ? `${currentPath}/${fileName}` : fileName
    return { entity: doc, type: 'doc', fullPath }
  }

  const fileRef = folder.fileRefs?.find((f: any) => f.name === fileName)
  if (fileRef) {
    const fullPath = currentPath ? `${currentPath}/${fileName}` : fileName
    return { entity: fileRef, type: 'fileRef', fullPath }
  }

  if (folder.folders) {
    for (const subfolder of folder.folders) {
      const newPath = currentPath ? `${currentPath}/${subfolder.name}` : subfolder.name
      const result = findEntityByNameInTree(subfolder, fileName, newPath)
      if (result) return result
    }
  }

  return null
}
