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
import { useLayoutContext } from '@/shared/context/layout-context'
import {
  consumePendingChatbotPrefill,
  listenToChatbotPrefill,
} from './chatbot-prefill-events'
import { resolveChatDockSide } from '../../util/chat-dock'

type ChatbotMessage = {
  id: string
  role: 'user' | 'bot'
  text: string
}

type ChatbotPrefillPayload = {
  text?: string
  referenceText?: string
  referenceLines?: {
    start: number
    end: number
  } | null
}

const initialMessages: ChatbotMessage[] = [
  {
    id: 'bot-initial',
    role: 'bot',
    text: 'Hello! Send a message and I will echo it back.',
  },
]

export default function ChatbotPanel() {
  const [messages, setMessages] = useState<ChatbotMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [referenceText, setReferenceText] = useState<string | null>(null)
  const [referenceLines, setReferenceLines] = useState<{
    start: number
    end: number
  } | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true)
  const counterRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const dragStartXRef = useRef<number | null>(null)
  const dragStartCenterXRef = useRef<number | null>(null)
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

  const resizeInput = useCallback(() => {
    const textarea = inputRef.current
    if (!textarea) {
      return
    }

    const minHeight = 34
    const maxHeight = 140

    textarea.style.height = 'auto'
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${Math.max(nextHeight, minHeight)}px`
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  const canSend = useMemo(() => input.trim().length > 0, [input])
  const isEditing = editingMessageId !== null
  const referenceLabel = useMemo(() => {
    if (!referenceLines) {
      return null
    }

    return referenceLines.start === referenceLines.end
      ? `Linea ${referenceLines.start}`
      : `Lineas ${referenceLines.start}-${referenceLines.end}`
  }, [referenceLines])

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

      if (event.target instanceof Element && event.target.closest('button')) {
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

  const createMessageId = useCallback((prefix: 'user' | 'bot') => {
    counterRef.current += 1
    return `${prefix}-${counterRef.current}`
  }, [])

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
      const percent = Math.max(5, Math.min(90, (rect.width / containerRect.width) * 100))
      if (chatDockSide === 'left') {
        setChatPanelSizeLeft(percent)
      } else {
        setChatPanelSizeRight(percent)
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

    // initial save
    if (!chatDockDragging) saveSize()

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWindowResize)
      if (timeout) window.clearTimeout(timeout)
    }
  }, [chatDockSide, chatDockDragging, setChatPanelSizeLeft, setChatPanelSizeRight])

  const submitMessage = () => {
    const trimmed = input.trim()
    if (!trimmed) {
      return
    }

    if (isEditing && editingMessageId) {
      setMessages(prev => {
        const messageIndex = prev.findIndex(
          message => message.id === editingMessageId
        )

        if (messageIndex < 0) {
          return prev
        }

        const updatedUserMessage: ChatbotMessage = {
          ...prev[messageIndex],
          text: trimmed,
        }
        const botMessage: ChatbotMessage = {
          id: createMessageId('bot'),
          role: 'bot',
          text: trimmed,
        }

        return [
          ...prev.slice(0, messageIndex),
          updatedUserMessage,
          botMessage,
        ]
      })

      setEditingMessageId(null)
      setInput('')
      setReferenceText(null)
      return
    }

    const userMessage: ChatbotMessage = {
      id: createMessageId('user'),
      role: 'user',
      text: trimmed,
    }

    const botMessage: ChatbotMessage = {
      id: createMessageId('bot'),
      role: 'bot',
      text: trimmed,
    }

    setMessages(prev => [...prev, userMessage, botMessage])
    setInput('')
    setReferenceText(null)
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
        <h3 className="ide-chatbot-panel-title">Chatbot</h3>
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
                'ide-chatbot-message-bot': message.role === 'bot',
                'ide-chatbot-message-editing': message.id === editingMessageId,
              })}
              onMouseEnter={() => setHoveredMessageId(message.id)}
              onMouseLeave={() => clearHoveredMessage(message.id)}
            >
              <div className="ide-chatbot-message-body">
                <p className="ide-chatbot-message-content">{message.text}</p>
                {hoveredMessageId === message.id && (
                  <div className="ide-chatbot-message-actions">
                    {message.role === 'user' && (
                      <OLTooltip
                        id={`edit-chatbot-message-${message.id}`}
                        description="Edit message"
                        overlayProps={{ placement: 'bottom' }}
                      >
                        <OLIconButton
                          onClick={() => startEditingMessage(message.id)}
                          className="ide-chatbot-message-edit-button"
                          icon="edit"
                          accessibilityLabel="Edit message"
                          size="sm"
                        />
                      </OLTooltip>
                    )}
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
                {referenceLabel ?? 'Referencia:'}
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
              &quot;{referenceText}&quot;
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
            placeholder=""
            aria-label=""
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
            <span className="material-symbols" aria-hidden="true">
              {isEditing ? 'edit' : 'arrow_upward'}
            </span>
          </button>
        </form>
      </div>
    </section>
  )
}
