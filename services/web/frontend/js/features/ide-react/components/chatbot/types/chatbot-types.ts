export type ChatbotMessage = {
  id: string
  role: 'user' | 'assistant' | 'status'
  text: string
  pending?: boolean
  conversationId?: string
  runId?: string | null
  streamingText?: string
  isStreaming?: boolean
  status?: AgentToolCallEvent['status']
  toolName?: string
  toolInput?: Record<string, unknown>
  questions?: AgentQuestion[]
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
  runId?: string | null
  toolEvents?: AgentToolCallEvent[]
  questions?: AgentQuestion[]
}

export type AgentQuestion = {
  question: string
  header?: string
  multiSelect?: boolean
  options: Array<{
    label: string
    description?: string
  }>
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
