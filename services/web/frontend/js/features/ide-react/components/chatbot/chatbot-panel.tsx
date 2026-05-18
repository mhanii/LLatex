import { useCallback, useEffect, useMemo, useState } from 'react'
import { useIdeContext } from '@/shared/context/ide-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '@/shared/context/user-context'
import { useChatbotState } from './hooks/useChatbotState'
import { useMessageUtilities } from './hooks/useMessageUtilities'
import { useConversationUtilities } from './hooks/useConversationUtilities'
import { useInputUtilities } from './hooks/useInputUtilities'
import { useChatbotPanelController } from './hooks/useChatbotPanelController'
import { ChatbotHeader } from './components/ChatbotHeader'
import { ChatbotMessagesContainer } from './components/ChatbotMessagesContainer'
import { ChatbotComposer } from './components/ChatbotComposer'
import { ChatbotDebugPanel } from './components/ChatbotDebugPanel'

export default function ChatbotPanel() {
  const { projectId } = useProjectContext()
  const user = useUserContext()
  const { socket } = useIdeContext()
  const editorManager = useEditorManagerContext()
  const { fileTreeData } = useFileTreeData()
  const {
    setChatIsOpen,
    chatDockSide,
    chatDockDragging,
    setChatDockSide,
    setChatDockDragging,
    setChatDockDragOffset,
    setChatPanelSizeLeft,
    setChatPanelSizeRight,
    setEditorPanelOpen,
    setView,
  } = useLayoutContext()

  const state = useChatbotState()
  const [autoCompactedGroupIds, setAutoCompactedGroupIds] = useState<string[]>([])

  state.activeConversationIdRef.current = state.activeConversationId

  const apiPath = useCallback(
    (path: string) => `/project/${projectId}/agent${path}`,
    [projectId]
  )

  const scrollToLatestStatusMessage = useCallback(() => {
    const container = state.messagesContainerRef.current
    if (!container) return

    setTimeout(() => {
      const statusWrappers = container.querySelectorAll('.ide-chatbot-status-wrapper')
      if (statusWrappers.length === 0) return

      const lastWrapper = statusWrappers[statusWrappers.length - 1]
      const messagesList = lastWrapper.querySelector('.ide-chatbot-status-messages-list')
      if (messagesList && messagesList.children.length > 0) {
        const lastMessage = messagesList.children[messagesList.children.length - 1]
        lastMessage.scrollIntoView({ behavior: 'auto', block: 'nearest' })
      } else {
        lastWrapper.scrollIntoView({ behavior: 'auto', block: 'end' })
      }
    }, 10)
  }, [state.messagesContainerRef])

  const handleMessagesScroll = useCallback(() => {
    const container = state.messagesContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
    state.setShouldAutoScroll(isNearBottom)
  }, [state.messagesContainerRef, state.setShouldAutoScroll])

  const { createMessageId, toChatbotMessage, appendMessage } = useMessageUtilities(
    user,
    state.messages,
    state.setMessages,
    state.counterRef,
    state.shouldAutoScroll,
    scrollToLatestStatusMessage
  )

  const { createConversation, handleDeleteConversation } = useConversationUtilities(
    apiPath,
    state.setConversations,
    state.activeConversationId,
    state.setActiveConversationId,
    state.setMessages,
    state.conversations
  )

  const { resizeInput, applyPrefill } = useInputUtilities(
    state.inputRef,
    state.setInput,
    state.setReferenceText,
    state.setReferenceLines,
    state.setEditingMessageId,
    () => {}
  )

  const controller = useChatbotPanelController({
    projectId,
    userId: user.id,
    socket,
    conversations: state.conversations,
    setConversations: state.setConversations,
    activeConversationId: state.activeConversationId,
    setActiveConversationId: state.setActiveConversationId,
    messages: state.messages,
    setMessages: state.setMessages,
    input: state.input,
    setInput: state.setInput,
    isSending: state.isSending,
    setIsSending: state.setIsSending,
    setIsLoadingMessages: state.setIsLoadingMessages,
    referenceText: state.referenceText,
    setReferenceText: state.setReferenceText,
    referenceLines: state.referenceLines,
    setReferenceLines: state.setReferenceLines,
    editingMessageId: state.editingMessageId,
    setEditingMessageId: state.setEditingMessageId,
    shouldAutoScroll: state.shouldAutoScroll,
    setShouldAutoScroll: state.setShouldAutoScroll,
    expandedStatusGroupIds: state.expandedStatusGroupIds,
    setExpandedStatusGroupIds: state.setExpandedStatusGroupIds,
    collapsedStatusGroupIds: state.collapsedStatusGroupIds,
    setCollapsedStatusGroupIds: state.setCollapsedStatusGroupIds,
    shouldAutoScrollRef: state.shouldAutoScrollRef,
    activeConversationIdRef: state.activeConversationIdRef,
    inputRef: state.inputRef,
    messagesContainerRef: state.messagesContainerRef,
    panelRef: state.panelRef,
    counterRef: state.counterRef,
    apiPath,
    createConversation,
    appendMessage,
    toChatbotMessage,
    createMessageId,
    resizeInput,
    applyPrefill,
    finishChatDockDrag: () => {},
    handleMessagesScroll,
    setChatIsOpen,
    chatDockSide,
    chatDockDragging,
    setChatDockSide,
    setChatDockDragging,
    setChatDockDragOffset,
    setChatPanelSizeLeft,
    setChatPanelSizeRight,
    setEditorPanelOpen,
    setView,
    fileTreeData,
    editorManager,
    setHoveredMessageId: state.setHoveredMessageId,
    statusGroupIds: state.messageGroups
      .filter(group => group.type === 'status-group')
      .map(group => group.id),
    autoCompactedGroupIds,
    setAutoCompactedGroupIds,
    messageGroups: state.messageGroups,
  } as any)

  const canSend = useMemo(
    () => state.input.trim().length > 0 && !state.isSending,
    [state.input, state.isSending]
  )

  return (
    <section
      ref={state.panelRef}
      className="ide-chatbot-panel"
      aria-label="Chatbot panel"
      data-chat-dock-side={chatDockSide}
    >
      <ChatbotHeader
        conversations={state.conversations}
        activeConversationId={state.activeConversationId}
        onConversationChange={state.setActiveConversationId}
        onNewChat={controller.handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        onClose={controller.closeChatbot}
        onPointerDown={controller.handleChatHeaderPointerDown}
      />

      <ChatbotMessagesContainer
        messageGroups={state.messageGroups}
        editingMessageId={state.editingMessageId}
        hoveredMessageId={state.hoveredMessageId}
        onMessageHover={state.setHoveredMessageId}
        onMessageLeave={controller.clearHoveredMessage}
        onEditMessage={controller.startEditingMessage}
        onCopyMessage={controller.copyMessage}
        onToggleStatusGroup={controller.toggleStatusGroup}
        isStatusGroupExpanded={controller.isStatusGroupExpanded}
        shouldShowToggleForGroup={controller.shouldShowToggleForGroup}
        renderStatusText={controller.renderStatusTextLocal}
        messagesContainerRef={state.messagesContainerRef}
        shouldAutoScroll={state.shouldAutoScroll}
        onJumpToLatestMessage={controller.jumpToLatestMessage}
      />

      <ChatbotDebugPanel onSimulateToolCall={controller.simulateToolCall} />

      <ChatbotComposer
        inputValue={state.input}
        onInputChange={state.setInput}
        onKeyDown={controller.handleInputKeyDown}
        onSubmit={controller.handleSubmit}
        inputRef={state.inputRef}
        canSend={canSend}
        referenceText={state.referenceText}
        referenceLines={state.referenceLines}
        onClearReference={controller.clearReference}
        isEditing={state.editingMessageId !== null}
        onCancelEdit={controller.cancelEditing}
      />
    </section>
  )
}