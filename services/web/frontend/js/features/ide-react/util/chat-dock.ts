export type ChatDockSide = 'left' | 'right'

export function resolveChatDockSide(
  panelCenterX: number,
  viewportWidth: number
): ChatDockSide {
  return panelCenterX > viewportWidth / 2 ? 'right' : 'left'
}
