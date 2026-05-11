const CHATBOT_PREFILL_EVENT = 'ide:chatbot-prefill'

type ChatbotPrefillPayload = {
  text?: string
  referenceText?: string
  referenceLines?: {
    start: number
    end: number
  } | null
}

let pendingChatbotPrefill: ChatbotPrefillPayload | null = null

export function emitChatbotPrefill(
  text: string,
  options: ChatbotPrefillPayload = {}
) {
  pendingChatbotPrefill = { text, ...options }
  window.dispatchEvent(
    new CustomEvent(CHATBOT_PREFILL_EVENT, {
      detail: { text, ...options },
    })
  )
}

export function consumePendingChatbotPrefill() {
  const pendingText = pendingChatbotPrefill
  pendingChatbotPrefill = null
  return pendingText
}

export function listenToChatbotPrefill(
  handler: (payload: ChatbotPrefillPayload) => void
) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ChatbotPrefillPayload>).detail
    if (!detail || (typeof detail.text !== 'string' && typeof detail.referenceText !== 'string')) {
      return
    }

    handler(detail)
  }

  window.addEventListener(CHATBOT_PREFILL_EVENT, listener)

  return () => {
    window.removeEventListener(CHATBOT_PREFILL_EVENT, listener)
  }
}
