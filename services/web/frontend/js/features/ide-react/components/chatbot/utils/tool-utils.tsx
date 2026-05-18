import React from 'react'
import { ChatbotMessage, AgentToolCallEvent } from '../types/chatbot-types'

export const toolSubject = (
  toolName: string,
  toolInput?: Record<string, unknown>
): string => {
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
}

export const toolEventToMessage = (
  event: AgentToolCallEvent
): ChatbotMessage => {
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
}

export const renderStatusIcon = (
  message: ChatbotMessage,
  isLast: boolean
): React.ReactNode => {
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

  const classNames = ['status-icon', 'ide-chatbot-status-icon']
  if (status === 'running') classNames.push('ide-chatbot-status-icon-running')
  if (status === 'completed') classNames.push('ide-chatbot-status-icon-completed')

  return (
    <span
      className={classNames.join(' ')}
      aria-hidden="true"
    >
      {toolIcon}
      {!isLast && <span className="ide-chatbot-status-connector" aria-hidden="true" />}
    </span>
  )
}
