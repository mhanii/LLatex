import { ChatbotMessage, ChatbotMessageGroup } from '../types/chatbot-types'
import { STATUS_SUMMARY_DESCRIPTORS } from '../constants/status-descriptors'

export function summarizeStatusGroup(messages: ChatbotMessage[]) {
  const groupedParts = new Map<string, { descriptor: any; count: number }>()

  for (const message of messages) {
    const descriptor = STATUS_SUMMARY_DESCRIPTORS[message.toolName ?? ''] ?? {
      key: message.toolName ?? 'unknown-tool',
      label: message.toolName?.replaceAll('_', ' ') ?? 'Worked',
      countable: false,
    }

    const existing = groupedParts.get(descriptor.key)
    if (existing) {
      existing.count += 1
      continue
    }

    groupedParts.set(descriptor.key, { descriptor, count: 1 })
  }

  const parts = Array.from(groupedParts.values()).map(({ descriptor, count }) => {
    if (!descriptor.countable) {
      return count === 1 ? descriptor.label : `${descriptor.label} x${count}`
    }

    const noun = count === 1 ? descriptor.singular ?? 'item' : descriptor.plural ?? 'items'
    return `${descriptor.label} ${count} ${noun}`
  })

  if (parts.length === 0) {
    return 'Agent is working'
  }

  if (parts.length === 1) {
    return parts[0]
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`
  }

  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

export function buildMessageGroups(messages: ChatbotMessage[]): ChatbotMessageGroup[] {
  const groups: ChatbotMessageGroup[] = []

  for (const message of messages) {
    if (message.role === 'status') {
      const lastGroup = groups[groups.length - 1]
      if (lastGroup && lastGroup.type === 'status-group') {
        lastGroup.messages.push(message)
        lastGroup.summary = summarizeStatusGroup(lastGroup.messages)
      } else {
        groups.push({
          type: 'status-group',
          id: message.id,
          messages: [message],
          summary: summarizeStatusGroup([message]),
        })
      }
      continue
    }

    groups.push({ type: 'single', message })
  }

  return groups
}
