export type ChatbotMessage = {
  id: string
  role: 'user' | 'assistant' | 'status'
  text: string
  pending?: boolean
  conversationId?: string
  status?: AgentToolCallEvent['status']
  toolName?: string
}

export type ChatbotMessageGroup =
  | { type: 'single'; message: ChatbotMessage }
  | {
      type: 'status-group'
      id: string
      messages: ChatbotMessage[]
      summary: string
    }

export type AgentConversation = {
  id: string
  createdBy: string
  title: string
  createdAt: number
  updatedAt: number
  lastMessageAt: number | null
  lastRunId: string | null
}

export type AgentServerMessage = {
  id: string
  content: string
  timestamp: number
  user_id: string
  role?: 'user' | 'assistant'
}

export type AgentToolCallEvent = {
  conversationId: string
  runId: string
  toolCallId?: string
  toolName: string
  status: 'running' | 'completed' | 'error'
  input?: Record<string, unknown>
  error?: string
  timestamp: number
}

export type ChatbotPrefillPayload = {
  text?: string
  referenceText?: string
  referenceLines?: {
    start: number
    end: number
  } | null
}

export type StatusSummaryDescriptor = {
  key: string
  label: string
  singular?: string
  plural?: string
  countable?: boolean
}
