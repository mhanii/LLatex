import { useCallback, useMemo, useState } from 'react'
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
  const messagesContainerRef = state.messagesContainerRef
  const setShouldAutoScroll = state.setShouldAutoScroll

  state.activeConversationIdRef.current = state.activeConversationId

  const apiPath = useCallback(
    (path: string) => `/project/${projectId}/agent${path}`,
    [projectId]
  )

  const scrollToLatestStatusMessage = useCallback(() => {
    const container = messagesContainerRef.current
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
  }, [messagesContainerRef])

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
    setShouldAutoScroll(isNearBottom)
  }, [messagesContainerRef, setShouldAutoScroll])

  const { createMessageId, toChatbotMessage, appendMessage } = useMessageUtilities(
    user,
    state.messages,
    state.setMessages,
    state.counterRef,
    state.shouldAutoScrollRef,
    scrollToLatestStatusMessage
  )

  const handleConversationChange = state.setActiveConversationId
  const handleMessageHover = state.setHoveredMessageId
  const handleInputChange = state.setInput

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
    isAwaitingAgentResponse: state.isAwaitingAgentResponse,
    setIsAwaitingAgentResponse: state.setIsAwaitingAgentResponse,
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
    autoCompactedGroupIds,
    setAutoCompactedGroupIds,
    messageGroups: state.messageGroups,
  })

  const handleNewChat = controller.handleNewChat
  const handleCloseChatbot = controller.closeChatbot
  const handleHeaderPointerDown = controller.handleChatHeaderPointerDown
  const handleMessageLeave = controller.clearHoveredMessage
  const handleEditMessage = controller.startEditingMessage
  const handleCopyMessage = controller.copyMessage
  const handleToggleStatusGroup = controller.toggleStatusGroup
  const handleJumpToLatestMessage = controller.jumpToLatestMessage
  const handleInputKeyDown = controller.handleInputKeyDown
  const handleSubmit = controller.handleSubmit
  const handleClearReference = controller.clearReference
  const handleCancelEdit = controller.cancelEditing
  const handleSimulateToolCall = controller.simulateToolCall
  const handleStopGeneration = controller.stopGeneration

  const isGenerating =
    state.isSending ||
    state.isAwaitingAgentResponse ||
    state.messages.some(message => message.role === 'status' && message.status === 'running')
  const canSend = useMemo(
    () => state.input.trim().length > 0 && !isGenerating,
    [isGenerating, state.input]
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
        onConversationChange={handleConversationChange}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        onClose={handleCloseChatbot}
        onPointerDown={handleHeaderPointerDown}
      />

      <ChatbotMessagesContainer
        messageGroups={state.messageGroups}
        editingMessageId={state.editingMessageId}
        hoveredMessageId={state.hoveredMessageId}
        onMessageHover={handleMessageHover}
        onMessageLeave={handleMessageLeave}
        onEditMessage={handleEditMessage}
        onCopyMessage={handleCopyMessage}
        onToggleStatusGroup={handleToggleStatusGroup}
        isStatusGroupExpanded={controller.isStatusGroupExpanded}
        shouldShowToggleForGroup={controller.shouldShowToggleForGroup}
        renderStatusText={controller.renderStatusTextLocal}
        messagesContainerRef={state.messagesContainerRef}
        shouldAutoScroll={state.shouldAutoScroll}
        onJumpToLatestMessage={handleJumpToLatestMessage}
      />

      <ChatbotDebugPanel 
        onSimulateToolCall={handleSimulateToolCall}
        onSimulateConversation={controller.simulateFullConversation}
      />

      <ChatbotComposer
        inputValue={state.input}
        onInputChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onSubmit={handleSubmit}
        inputRef={state.inputRef}
        canSend={canSend}
        isGenerating={isGenerating}
        onStopGeneration={handleStopGeneration}
        referenceText={state.referenceText}
        referenceLines={state.referenceLines}
        onClearReference={handleClearReference}
        isEditing={state.editingMessageId !== null}
        onCancelEdit={handleCancelEdit}
      />
    </section>
  )
}