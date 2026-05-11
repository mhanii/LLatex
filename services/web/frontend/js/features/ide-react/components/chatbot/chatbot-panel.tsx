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
  const counterRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { setChatIsOpen } = useLayoutContext()

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

  const closeChatbot = useCallback(() => {
    setChatIsOpen(false)
  }, [setChatIsOpen])

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

  return (
    <section className="ide-chatbot-panel" aria-label="Chatbot panel">
      <header className="ide-chatbot-panel-header">
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

      <div className="ide-chatbot-panel-messages" role="log" aria-live="polite">
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
            {referenceLines && (
              <div className="ide-chatbot-panel-reference-lines">lines {referenceLines.start}-{referenceLines.end}</div>
            )}
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
