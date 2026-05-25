import React from 'react'
import { useTranslation } from 'react-i18next'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { AgentConversation } from '../types/chatbot-types'

interface ChatbotHeaderProps {
  conversations: AgentConversation[]
  activeConversationId: string | null
  onConversationChange: (id: string) => void
  onNewChat: () => void
  onDeleteConversation: (id: string) => void
  onClose: () => void
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
}

export const ChatbotHeader: React.FC<ChatbotHeaderProps> = ({
  conversations,
  activeConversationId,
  onConversationChange,
  onNewChat,
  onDeleteConversation,
  onClose,
  onPointerDown,
}) => {
  const { t } = useTranslation()

  return (
    <header
      className="ide-chatbot-panel-header"
      onPointerDown={onPointerDown}
    >
      <div className="ide-chatbot-panel-title-row">
        <h3 className="ide-chatbot-panel-title">{t('chatbot_panel_title')}</h3>
        <select
          className="ide-chatbot-panel-conversation-select"
          value={activeConversationId ?? ''}
          onChange={event => onConversationChange(event.target.value)}
          aria-label={t('chatbot_agent_conversation')}
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
        description={t('start_new_chat')}
        overlayProps={{ placement: 'bottom' }}
      >
        <OLIconButton
          onClick={onNewChat}
          className="ide-chatbot-panel-header-button-subdued"
          icon="add"
          accessibilityLabel={t('start_new_chat')}
          size="sm"
        />
      </OLTooltip>
      <OLTooltip
        id="delete-chatbot-conversation"
        description={t('delete')}
        overlayProps={{ placement: 'bottom' }}
      >
        <OLIconButton
          onClick={() => {
            if (activeConversationId) {
              onDeleteConversation(activeConversationId)
            }
          }}
          className="ide-chatbot-panel-header-button-subdued"
          icon="delete"
          accessibilityLabel={t('delete')}
          size="sm"
          disabled={!activeConversationId}
        />
      </OLTooltip>
      <OLTooltip
        id="close-chatbot-panel"
        description={t('close')}
        overlayProps={{ placement: 'bottom' }}
      >
        <OLIconButton
          onClick={onClose}
          className="ide-chatbot-panel-header-button-subdued"
          icon="close"
          accessibilityLabel={t('close')}
          size="sm"
        />
      </OLTooltip>
    </header>
  )
}
