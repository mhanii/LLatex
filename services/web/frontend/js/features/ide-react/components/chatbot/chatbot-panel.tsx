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
import { getJSON, postJSON, deleteJSON } from '@/infrastructure/fetch-json'
import { useIdeContext } from '@/shared/context/ide-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { findEntityByPath } from '@/features/file-tree/util/path'
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
  status?: AgentToolCallEvent['status']
  toolName?: string
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
  const [_isLoadingMessages, setIsLoadingMessages] = useState(false)
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
  const statusWrapperRef = useRef<HTMLDivElement>(null)
  const editorManager = useEditorManagerContext()
  const { fileTreeData } = useFileTreeData()
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
    setEditorPanelOpen,
    setView,
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

  // Busca recursivamente un archivo/doc por nombre y retorna su entidad y ruta completa
  const findEntityByNameInTree = useCallback(
    (
      folder: any,
      fileName: string,
      currentPath: string = ''
    ): { entity: any; type: 'fileRef' | 'doc'; fullPath: string } | null => {
      // Buscar en docs
      const doc = folder.docs?.find(
        (d: any) => d.name === fileName
      )
      if (doc) {
        const fullPath = currentPath ? `${currentPath}/${fileName}` : fileName
        return { entity: doc, type: 'doc', fullPath }
      }

      // Buscar en fileRefs
      const fileRef = folder.fileRefs?.find(
        (f: any) => f.name === fileName
      )
      if (fileRef) {
        const fullPath = currentPath ? `${currentPath}/${fileName}` : fileName
        return { entity: fileRef, type: 'fileRef', fullPath }
      }

      // Buscar recursivamente en subcarpetas
      if (folder.folders) {
        for (const subfolder of folder.folders) {
          const newPath = currentPath ? `${currentPath}/${subfolder.name}` : subfolder.name
          const result = findEntityByNameInTree(
            subfolder,
            fileName,
            newPath
          )
          if (result) return result
        }
      }

      return null
    },
    []
  )

  const openEntityByPath = useCallback(
    (fileName: string) => {
      try {
        if (!fileTreeData) {
          debugConsole.warn('fileTreeData not available')
          return
        }
        debugConsole.log('Trying to open file:', fileName)

        // Primero intentar como path completo
        let result = findEntityByPath(fileTreeData, fileName)
        debugConsole.log('findEntityByPath result:', result)

        // Si no encontró, buscar por nombre solamente
        if (!result) {
          debugConsole.log('Not found by full path, searching by name...')
          result = findEntityByNameInTree(fileTreeData, fileName)
          debugConsole.log('findEntityByNameInTree result:', result)
        }

        if (!result) {
          debugConsole.warn('Entity not found for:', fileName)
          return
        }

        if (result.type === 'fileRef') {
          debugConsole.log('Opening fileRef with ID:', result.entity._id)
          setEditorPanelOpen(true)
          setView('file')
          editorManager.openFileWithId(result.entity._id)
        } else if (result.type === 'doc') {
          debugConsole.log('Opening doc with ID:', result.entity._id)
          setEditorPanelOpen(true)
          setView('editor')
          editorManager.openDocWithId(result.entity._id)
        }
      } catch (err) {
        debugConsole.error('Error opening entity:', err)
      }
    },
    [editorManager, fileTreeData, findEntityByNameInTree, setEditorPanelOpen, setView]
  )

  // Obtiene la ruta completa de un archivo buscándolo en el árbol
  const getFullFilePathForTooltip = useCallback(
    (fileName: string): string => {
      if (!fileTreeData) return fileName

      // Primero intentar como path completo
      const resultByPath = findEntityByPath(fileTreeData, fileName)
      if (resultByPath) return fileName

      // Si no encontró, buscar por nombre
      const result = findEntityByNameInTree(fileTreeData, fileName)
      if (result) {
        return result.fullPath
      }

      return fileName
    },
    [fileTreeData, findEntityByNameInTree]
  )

  const renderStatusText = useCallback((text: string) => {
    const parts: Array<string | JSX.Element> = []
    // Match: word chars/dots/slashes + dot + word chars (file extensions)
    // Also match paths like: src/main.py, ./file.txt, error.txt
    const regex = /([\w./-]*[\w-]+\.[\w-]+)/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      const matchText = match[0]
      const idx = match.index

      // Don't match if preceded by non-space (already part of longer word)
      if (idx > 0) {
        const prevChar = text[idx - 1]
        if (/\w/.test(prevChar)) {
          continue
        }
      }

      // Don't match if followed by non-space (part of longer word)
      const endIdx = idx + matchText.length
      if (endIdx < text.length) {
        const nextChar = text[endIdx]
        if (/\w/.test(nextChar)) {
          continue
        }
      }

      if (idx > lastIndex) {
        parts.push(text.slice(lastIndex, idx))
      }

      const key = `status-file-${idx}`
      const fullPath = getFullFilePathForTooltip(matchText)
      parts.push(
        <button
          key={key}
          type="button"
          className="ide-chatbot-status-file"
          onClick={() => openEntityByPath(matchText)}
          title={fullPath}
        >
          <code>{matchText}</code>
        </button>
      )
      lastIndex = endIdx
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex))
    }

    return <>{parts.map((p, i) => (typeof p === 'string' ? <span key={`s-${i}`}>{p}</span> : p))}</>
  }, [openEntityByPath, getFullFilePathForTooltip])

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

    if (message.role === 'status') {
      setTimeout(() => {
        statusWrapperRef.current?.scrollTo({
          top: statusWrapperRef.current.scrollHeight,
          behavior: 'smooth',
        })
      }, 10)
    }
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

  const handleNewChat = useCallback(async () => {
    // Check if current chat is empty (no user messages)
    const hasUserMessages = messages.some(msg => msg.role === 'user')
    if (!hasUserMessages) {
      // Don't create a new chat if current one is empty
      return
    }
    await createConversation().catch(debugConsole.error)
  }, [messages, createConversation])

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
        setConversations(remainingConversations)
        
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
    [apiPath, conversations, activeConversationId, createConversation]
  )

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
      const statusId = event.toolCallId ?? `${event.runId}-${event.toolName}`

      return {
        id: statusId,
        role: 'status',
        text,
        conversationId: event.conversationId,
        status: event.status,
        toolName: event.toolName,
      }
    },
    [toolSubject]
  )

  const simulateToolCall = useCallback((
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

    if (status === 'running') {
      // Mostrar solo el estado running
      appendMessage(toolEventToMessage({ ...baseEvent, toolCallId: statusId, status: 'running' }))
    } else if (status === 'completed') {
      // Mostrar running -> completado con delay sobre el mismo nodo
      appendMessage(toolEventToMessage({ ...baseEvent, toolCallId: statusId, status: 'running' }))
      setTimeout(() => {
        appendMessage(toolEventToMessage({ ...baseEvent, toolCallId: statusId, status: 'completed' }))
        // Auto-scroll si está activo
        if (shouldAutoScroll && messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
        }
      }, durationMs)
    } else if (status === 'error') {
      // Mostrar running -> error
      appendMessage(toolEventToMessage({ ...baseEvent, toolCallId: statusId, status: 'running' }))
      setTimeout(() => {
        appendMessage(toolEventToMessage({ 
          ...baseEvent, 
          toolCallId: statusId,
          status: 'error',
          error: 'File not found or permission denied'
        }))
      }, durationMs)
    }
  }, [appendMessage, toolEventToMessage, activeConversationId, shouldAutoScroll])

  const renderStatusIcon = useCallback((message: ChatbotMessage, isLast: boolean) => {
    const toolName = message.toolName ?? ''
    const status = message.status ?? 'running'

    const toolIcon = (() => {
      switch (toolName) {
        case 'read_file':
        case 'read_skill':
        case 'get_outline':
        case 'get_pdf_page':
          return (
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h5a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4z" />
              <path d="M20 6h-5a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h5z" />
            </svg>
          )
        case 'edit_file':
          return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h4l10.5-10.5a1.4 1.4 0 0 0 0-2l-1-1a1.4 1.4 0 0 0-2 0L5 17v3Z" />
              <path d="M13.5 6.5l4 4" />
            </svg>
          )
        case 'create_file':
          return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4h6l4 4v12H7z" />
              <path d="M13 4v4h4" />
              <path d="M12 11v6M9 14h6" />
            </svg>
          )
        case 'delete_file':
          return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 7h14" />
              <path d="M9 7V5h6v2" />
              <path d="M8 7l1 12h6l1-12" />
              <path d="M10 11v5M14 11v5" />
            </svg>
          )
        case 'move_file':
          return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h11" />
              <path d="M11 4l4 3-4 3" />
              <path d="M20 17H9" />
              <path d="M13 14l-4 3 4 3" />
            </svg>
          )
        case 'compile_and_check':
        case 'check_syntax':
          return (
            <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9,10 4,16 9,22" />
              <polyline points="23,10 28,16 23,22" />
              <line x1="19" y1="7" x2="13" y2="25" />
            </svg>
          )
        case 'list_files':
        case 'list_skills':
          return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 6h13" />
              <path d="M7 12h13" />
              <path d="M7 18h13" />
              <path d="M4 6h.01M4 12h.01M4 18h.01" />
            </svg>
          )
        default:
          return (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="7" />
            </svg>
          )
      }
    })()

    if (status === 'error') {
      return (
        <span className="status-icon ide-chatbot-status-icon ide-chatbot-status-icon-error" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M9 9l6 6M15 9l-6 6" />
          </svg>
          {!isLast && <span className="ide-chatbot-status-connector" aria-hidden="true" />}
        </span>
      )
    }

    return (
      <span
        className={classNames('status-icon', 'ide-chatbot-status-icon', {
          'ide-chatbot-status-icon-running': status === 'running',
          'ide-chatbot-status-icon-completed': status === 'completed',
        })}
        aria-hidden="true"
      >
        {toolIcon}
        {!isLast && <span className="ide-chatbot-status-connector" aria-hidden="true" />}
      </span>
    )
  }, [])

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

  const groupMessages = useCallback(() => {
    const groups: Array<{ type: 'single'; message: ChatbotMessage } | { type: 'status-group'; messages: ChatbotMessage[] }> = []
    
    for (const message of messages) {
      if (message.role === 'status') {
        // Añadir a un grupo de status
        const lastGroup = groups[groups.length - 1]
        if (lastGroup && lastGroup.type === 'status-group') {
          lastGroup.messages.push(message)
        } else {
          groups.push({ type: 'status-group', messages: [message] })
        }
      } else {
        // Mensaje individual (user o assistant)
        groups.push({ type: 'single', message })
      }
    }
    
    return groups
  }, [messages])

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
            onClick={handleNewChat}
            className="ide-chatbot-panel-header-button-subdued"
            icon="add"
            accessibilityLabel="New chat"
            size="sm"
          />
        </OLTooltip>
        <OLTooltip
          id="delete-chatbot-conversation"
          description="Delete chat"
          overlayProps={{ placement: 'bottom' }}
        >
          <OLIconButton
            onClick={() => {
              if (activeConversationId) {
                handleDeleteConversation(activeConversationId).catch(
                  debugConsole.error
                )
              }
            }}
            className="ide-chatbot-panel-header-button-subdued"
            icon="delete"
            accessibilityLabel="Delete chat"
            size="sm"
            disabled={!activeConversationId}
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
          {(() => {
            const groups = groupMessages()
            
            return (
              <>
                {groups.map((group, groupIndex) => {
                  if (group.type === 'single') {
                    const message = group.message
                    return (
                      <article
                        key={message.id}
                        className={classNames('ide-chatbot-message', {
                          'ide-chatbot-message-user': message.role === 'user',
                          'ide-chatbot-message-bot': message.role === 'assistant',
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
                              <OLTooltip id={`edit-chatbot-message-${message.id}`} description="Edit message" overlayProps={{ placement: 'bottom' }}>
                                <OLIconButton onClick={() => startEditingMessage(message.id)} className="ide-chatbot-message-footer-button" icon="edit" accessibilityLabel="Edit message" size="sm" />
                              </OLTooltip>
                              <OLTooltip id={`copy-chatbot-message-${message.id}`} description="Copy message" overlayProps={{ placement: 'bottom' }}>
                                <OLIconButton onClick={() => copyMessage(message.text)} className="ide-chatbot-message-footer-button" icon="content_copy" accessibilityLabel="Copy message" size="sm" />
                              </OLTooltip>
                            </div>
                          )}
                          {message.role !== 'user' && hoveredMessageId === message.id && message.role !== 'status' && (
                            <div className="ide-chatbot-message-actions">
                              <OLTooltip id={`copy-chatbot-message-${message.id}`} description="Copy message" overlayProps={{ placement: 'bottom' }}>
                                <OLIconButton onClick={() => copyMessage(message.text)} className="ide-chatbot-message-copy-button" icon="content_copy" accessibilityLabel="Copy message" size="sm" />
                              </OLTooltip>
                            </div>
                          )}
                        </div>
                      </article>
                    )
                  } else {
                    // status-group
                    return (
                      <div key={`status-group-${groupIndex}`} ref={statusWrapperRef} className="ide-chatbot-status-wrapper">
                        {group.messages.map((message, messageIndex) => (
                          <article
                            key={message.id}
                            className={classNames('ide-chatbot-message', 'ide-chatbot-message-status', {
                              'ide-chatbot-message-status-error': message.text.includes('Could not') || message.text.includes('Failed'),
                              'is-pending': message.status === 'running'
                            })}
                            data-status={message.status ?? 'running'}
                          >
                            {renderStatusIcon(message, messageIndex === group.messages.length - 1)}
                            <div className="ide-chatbot-message-body">
                              <p className="ide-chatbot-message-content status-text">{renderStatusText(message.text)}</p>
                            </div>
                          </article>
                        ))}
                      </div>
                    )
                  }
                })}
              </>
            )
          })()}
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

      {process.env.NODE_ENV === 'development' && (
        <div className="ide-chatbot-debug-panel" style={{
          position: 'sticky',
          bottom: '10px',
          marginTop: '8px',
          padding: '12px 8px',
          borderTop: '1px solid var(--border-divider-themed)',
          background: 'var(--bg-secondary-themed)',
          borderRadius: '8px',
          margin: '0 var(--spacing-04) var(--spacing-02)',
          
          minHeight: '160px',
          maxHeight: '160px',
          overflowY: 'auto',
        }}>
          <div style={{ 
            fontSize: '10px', 
            opacity: 0.6, 
            fontWeight: 'bold', 
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Debug Console (Tools)
          </div>

          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            justifyContent: 'flex-start'
          }}>
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('list_files', {}, 'completed', 1500)}>📂 list</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('read_file', { path: 'src/main.py' }, 'completed', 1500)}>🔍 read</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('create_file', { path: 'new.py' }, 'completed', 1500)}>➕ create</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('edit_file', { path: 'src/config.py' }, 'completed', 2000)}>✏️ edit</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('delete_file', { path: 'temp.log' }, 'completed', 1200)}>🗑️ delete</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('move_file', { path: 'a.js', newPath: 'b.js' }, 'completed', 1500)}>🚚 move</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('get_outline', {}, 'completed', 1000)}>📋 outline</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('check_syntax', {}, 'completed', 1500)}>✅ syntax</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('compile_and_check', {}, 'completed', 2500)}>🔧 compile</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('get_pdf_page', { page: 5 }, 'completed', 1800)}>📄 pdf</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('list_skills', {}, 'completed', 1000)}>🧠 skills</button>
            
            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={() => simulateToolCall('read_skill', { path: 'refactor' }, 'completed', 1200)}>📖 read_sk</button>

            <button className="btn btn-sm" style={{ fontSize: '11px', padding: '4px 8px', background: '#dc3545', color: 'white' }} 
              onClick={() => simulateToolCall('read_file', { path: 'error.txt' }, 'error', 1500)}>❌ ERROR</button>
          </div>
        </div>
      )}

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
