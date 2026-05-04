import { FormEvent, useMemo, useRef, useState } from 'react'
import classNames from 'classnames'

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

  const canSend = useMemo(() => input.trim().length > 0, [input])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

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

  return (
    <section className="ide-chatbot-panel" aria-label="Chatbot panel">
      <header className="ide-chatbot-panel-header">
        <h3 className="ide-chatbot-panel-title">Chatbot</h3>
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
            <p className="ide-chatbot-message-author">
              {message.role === 'user' ? 'You' : 'Bot'}
            </p>
            <p className="ide-chatbot-message-content">{message.text}</p>
          </article>
        ))}
      </div>

      <form className="ide-chatbot-panel-form" onSubmit={handleSubmit}>
        <label htmlFor="ide-chatbot-input" className="sr-only">
          Chatbot message
        </label>
        <input
          id="ide-chatbot-input"
          className="ide-chatbot-panel-input"
          type="text"
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder="Write a message"
          aria-label="Write a chatbot message"
        />
        <button
          type="submit"
          className="btn btn-primary ide-chatbot-panel-send"
          disabled={!canSend}
        >
          Send
        </button>
      </form>
    </section>
  )
}
