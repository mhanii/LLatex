import { useLayoutContext } from '@/shared/context/layout-context'
import { useEffect, useRef } from 'react'
import { sendMBOnce } from '@/infrastructure/event-tracking'

export function useLayoutEventTracking() {
  const { view, leftMenuShown, chatIsOpen } = useLayoutContext()
  const previousChatIsOpen = useRef(chatIsOpen)

  useEffect(() => {
    if (view && view !== 'editor' && view !== 'pdf') {
      sendMBOnce(`ide-open-view-${view}-once`)
    }
  }, [view])

  useEffect(() => {
    if (leftMenuShown) {
      sendMBOnce(`ide-open-left-menu-once`)
    }
  }, [leftMenuShown])

  useEffect(() => {
    if (chatIsOpen && !previousChatIsOpen.current) {
      sendMBOnce(`ide-open-chat-once`)
    }
    previousChatIsOpen.current = chatIsOpen
  }, [chatIsOpen])
}
