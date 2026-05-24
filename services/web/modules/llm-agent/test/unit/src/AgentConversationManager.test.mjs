import { beforeEach, describe, expect, it, vi } from 'vitest'

const PROJECT_ID = 'aaa000000000000000000001'
const USER_ID = 'bbb000000000000000000001'
const CONVERSATION_ID = 'ccc000000000000000000001'

let AgentConversationManager
let findOneAndUpdate
let updateOne
let findOne

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
    updateOne = vi.fn()
    findOne = vi.fn()
    vi.doMock(
      '../../../../../app/src/infrastructure/mongodb.mjs',
      () => ({
        ObjectId: FakeObjectId,
        db: {
          agentConversations: {
            findOneAndUpdate,
            updateOne,
            findOne,
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

  describe('recordMessage', function () {
    it('persists projectVersionBefore on user messages', async function () {
      updateOne.mockResolvedValue({ acknowledged: true, modifiedCount: 1 })
      await AgentConversationManager.promises.recordMessage(
        PROJECT_ID,
        CONVERSATION_ID,
        { id: 'msg-1', content: 'hi', timestamp: Date.now() },
        'user',
        null,
        42
      )
      // First call is the message push; second is the title-update guard for
      // user messages.
      const pushCall = updateOne.mock.calls[0]
      const pushUpdate = pushCall[1]
      expect(pushUpdate.$push.messages).toMatchObject({
        messageId: 'msg-1',
        role: 'user',
        projectVersionBefore: 42,
      })
    })

    it('stores null when projectVersionBefore is omitted', async function () {
      updateOne.mockResolvedValue({ acknowledged: true, modifiedCount: 1 })
      await AgentConversationManager.promises.recordMessage(
        PROJECT_ID,
        CONVERSATION_ID,
        { id: 'msg-2', content: 'hi', timestamp: Date.now() },
        'assistant',
        'run-1'
      )
      const pushUpdate = updateOne.mock.calls[0][1]
      expect(pushUpdate.$push.messages.projectVersionBefore).toBe(null)
    })
  })

  describe('getMessageMetadata', function () {
    it('returns projectVersionBefore and createdAt per message', async function () {
      const createdAt = new Date()
      findOne.mockResolvedValueOnce({
        messages: [
          {
            messageId: 'a',
            role: 'user',
            runId: null,
            createdAt,
            projectVersionBefore: 7,
          },
          {
            messageId: 'b',
            role: 'assistant',
            runId: 'r1',
            createdAt: new Date(createdAt.getTime() + 1000),
          },
        ],
      })
      const meta = await AgentConversationManager.promises.getMessageMetadata(
        PROJECT_ID,
        CONVERSATION_ID
      )
      expect(meta.get('a')).toMatchObject({
        role: 'user',
        projectVersionBefore: 7,
        createdAt,
      })
      expect(meta.get('b')).toMatchObject({
        role: 'assistant',
        runId: 'r1',
        projectVersionBefore: null,
      })
    })
  })

  describe('findUserMessage', function () {
    it('returns the matching message subdocument', async function () {
      const target = {
        messageId: 'msg-find',
        role: 'user',
        runId: null,
        createdAt: new Date(),
        projectVersionBefore: 3,
      }
      findOne.mockResolvedValueOnce({ messages: [target] })
      const result = await AgentConversationManager.promises.findUserMessage(
        PROJECT_ID,
        CONVERSATION_ID,
        'msg-find',
        USER_ID
      )
      expect(result).toBe(target)
    })

    it('returns null when the message is not present', async function () {
      findOne.mockResolvedValueOnce({ messages: [] })
      const result = await AgentConversationManager.promises.findUserMessage(
        PROJECT_ID,
        CONVERSATION_ID,
        'nope',
        USER_ID
      )
      expect(result).toBeNull()
    })

    it('returns null when the conversation is not owned by the user', async function () {
      findOne.mockResolvedValueOnce(null)
      const result = await AgentConversationManager.promises.findUserMessage(
        PROJECT_ID,
        CONVERSATION_ID,
        'msg-1',
        USER_ID
      )
      expect(result).toBeNull()
    })
  })

  describe('truncateFromMessage', function () {
    it('drops messages at or after the cutoff and reports their ids', async function () {
      const t0 = new Date('2024-01-01T00:00:00Z')
      const t1 = new Date('2024-01-01T00:00:01Z')
      const t2 = new Date('2024-01-01T00:00:02Z')
      findOne.mockResolvedValueOnce({
        messages: [
          { messageId: 'a', role: 'user', createdAt: t0, runId: null },
          { messageId: 'b', role: 'assistant', createdAt: t1, runId: 'r1' },
          { messageId: 'c', role: 'user', createdAt: t2, runId: null },
        ],
      })
      updateOne.mockResolvedValue({ acknowledged: true, modifiedCount: 1 })

      const removed =
        await AgentConversationManager.promises.truncateFromMessage(
          PROJECT_ID,
          CONVERSATION_ID,
          t1
        )

      expect(removed).toEqual(['b', 'c'])
      const setUpdate = updateOne.mock.calls[0][1].$set
      expect(setUpdate.messages).toHaveLength(1)
      expect(setUpdate.messages[0].messageId).toBe('a')
      expect(setUpdate.lastMessageAt).toEqual(t0)
      // lastRunId is recomputed from the remaining messages — none have a
      // runId so it falls back to null.
      expect(setUpdate.lastRunId).toBeNull()
    })

    it('returns an empty list and does not update when the conversation is missing', async function () {
      findOne.mockResolvedValueOnce(null)
      const removed =
        await AgentConversationManager.promises.truncateFromMessage(
          PROJECT_ID,
          CONVERSATION_ID,
          new Date()
        )
      expect(removed).toEqual([])
      expect(updateOne).not.toHaveBeenCalled()
    })
  })
})
