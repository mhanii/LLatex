import { FormEvent, KeyboardEvent, useCallback, useMemo, useRef, useState } from 'react'
import classNames from 'classnames'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { useLayoutContext } from '@/shared/context/layout-context'

type ChatbotMessage = {
  id: string
  role: 'user' | 'bot'
  text: string
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
  const counterRef = useRef(0)
  const { setChatIsOpen } = useLayoutContext()

  const canSend = useMemo(() => input.trim().length > 0, [input])

  const closeChatbot = useCallback(() => {
    setChatIsOpen(false)
  }, [setChatIsOpen])

  const submitMessage = () => {
    const trimmed = input.trim()
    if (!trimmed) {
      return
    }

    counterRef.current += 1
    const userMessage: ChatbotMessage = {
      id: `user-${counterRef.current}`,
      role: 'user',
      text: trimmed,
    }

    counterRef.current += 1
    const botMessage: ChatbotMessage = {
      id: `bot-${counterRef.current}`,
      role: 'bot',
      text: trimmed,
    }

    setMessages(prev => [...prev, userMessage, botMessage])
    setInput('')
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
            })}
          >
            <p className="ide-chatbot-message-content">{message.text}</p>
          </article>
        ))}
      </div>

      <form className="ide-chatbot-panel-form" onSubmit={handleSubmit}>
        <textarea
          id="ide-chatbot-input"
          className="ide-chatbot-panel-input"
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder=""
          aria-label=""
          rows={1}
        />
        <button
          type="submit"
          className="btn btn-primary ide-chatbot-panel-send"
          disabled={!canSend}
        >
          <span className="material-symbols" aria-hidden="true">
            arrow_upward
          </span>
        </button>
      </form>
    </section>
  )
}
