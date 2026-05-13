import { beforeEach, describe, expect, it, vi } from 'vitest'

const PROJECT_ID = 'aaa000000000000000000001'
const USER_ID = 'bbb000000000000000000001'
const CONVERSATION_ID = 'ccc000000000000000000001'

let AgentConversationManager
let findOneAndUpdate

class FakeObjectId {
  constructor(id = '000000000000000000000000') {
    this.id = id
  }

  toString() {
    return this.id
  }

  static isValid(id) {
    return typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)
  }
}

describe('AgentConversationManager', function () {
  beforeEach(async function () {
    vi.resetModules()

    findOneAndUpdate = vi.fn()
    vi.doMock(
      '../../../../../app/src/infrastructure/mongodb.mjs',
      () => ({
        ObjectId: FakeObjectId,
        db: {
          agentConversations: {
            findOneAndUpdate,
          },
        },
      })
    )

    ;({ default: AgentConversationManager } = await import(
      '../../../app/src/AgentConversationManager.mjs'
    ))
  })

  describe('ensureConversation', function () {
    it('maps duplicate-key upserts to a scoped 403 error', async function () {
      findOneAndUpdate.mockRejectedValueOnce(
        Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
      )

      let error
      try {
        await AgentConversationManager.promises.ensureConversation(
          PROJECT_ID,
          CONVERSATION_ID,
          USER_ID,
          'hello'
        )
      } catch (err) {
        error = err
      }

      expect(error).toMatchObject({
        message: 'agent conversation not found or not owned by user',
        statusCode: 403,
      })
    })
  })
})
