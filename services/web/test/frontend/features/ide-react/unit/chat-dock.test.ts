import { expect } from 'chai'
import { resolveChatDockSide } from '@/features/ide-react/util/chat-dock'

describe('resolveChatDockSide', function () {
  it('keeps the chatbot on the left when dropped before the center', function () {
    expect(resolveChatDockSide(300, 1000)).to.equal('left')
  })

  it('moves the chatbot to the right when dropped after the center', function () {
    expect(resolveChatDockSide(700, 1000)).to.equal('right')
  })
})
