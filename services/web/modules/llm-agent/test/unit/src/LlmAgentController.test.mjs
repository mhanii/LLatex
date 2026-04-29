import { beforeEach, describe, expect, it, vi } from 'vitest'
import MockResponse from '../../../../../test/unit/src/helpers/MockResponse.mjs'

const PROJECT_ID = 'aaa000000000000000000001'
const USER_ID = 'bbb000000000000000000001'
const CONVERSATION_ID = 'ccc000000000000000000001'
const RUN_ID = 'ddd000000000000000000001'
const MESSAGE_ID = 'eee000000000000000000001'

let SessionManager
let ChatApiHandler
let EditorRealTimeController
let LlmAgentApiHandler
let LlmAgentController

describe('LlmAgentController', function () {
  beforeEach(async function () {
    vi.resetModules()

    vi.doMock(
      '../../../../app/src/Features/Authentication/SessionManager.mjs',
      () => ({
        default: { getLoggedInUserId: vi.fn().mockReturnValue(USER_ID) },
      })
    )

    vi.doMock('../../../../app/src/Features/Chat/ChatApiHandler.mjs', () => ({
      default: {
        promises: {
          sendComment: vi.fn().mockResolvedValue({
            id: MESSAGE_ID,
            user_id: USER_ID,
            content: 'hello agent',
          }),
        },
      },
    }))

    vi.doMock(
      '../../../../app/src/Features/User/UserInfoManager.mjs',
      () => ({
        default: {
          promises: {
            getPersonalInfo: vi.fn().mockResolvedValue({ _id: USER_ID }),
          },
        },
      })
    )

    vi.doMock(
      '../../../../app/src/Features/User/UserInfoController.mjs',
      () => ({
        default: {
          formatPersonalInfo: vi.fn().mockReturnValue({ id: USER_ID }),
        },
      })
    )

    vi.doMock(
      '../../../../app/src/Features/Editor/EditorRealTimeController.mjs',
      () => ({
        default: { emitToRoom: vi.fn() },
      })
    )

    vi.doMock('../../../app/src/LlmAgentApiHandler.mjs', () => ({
      default: {
        promises: { startRun: vi.fn().mockResolvedValue({ runId: RUN_ID }) },
      },
    }))

    // Import after mocks are registered
    ;({ default: SessionManager } = await import(
      '../../../../app/src/Features/Authentication/SessionManager.mjs'
    ))
    ;({ default: ChatApiHandler } = await import(
      '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
    ))
    ;({ default: EditorRealTimeController } = await import(
      '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
    ))
    ;({ default: LlmAgentApiHandler } = await import(
      '../../../app/src/LlmAgentApiHandler.mjs'
    ))
    ;({ default: LlmAgentController } = await import(
      '../../../app/src/LlmAgentController.mjs'
    ))
  })

  function makeReq(bodyOverrides = {}, paramsOverrides = {}) {
    return {
      params: { project_id: PROJECT_ID, ...paramsOverrides },
      body: { message: 'hello agent', ...bodyOverrides },
      session: {},
    }
  }

  function makeRes() {
    return new MockResponse(vi)
  }

  describe('sendMessage — happy path', function () {
    it('responds 202 with runId, messageId, and a conversationId', async function () {
      const req = makeReq()
      const res = makeRes()
      const next = vi.fn()

      await new Promise(resolve =>
        LlmAgentController.sendMessage(req, res, (...args) => {
          next(...args)
          resolve()
        })
      ).catch(() => {})
      // expressify: if no error, res.json() is called directly
      if (!next.mock.calls.length) {
        // next was not called — success path
      }

      expect(res.statusCode).toBe(202)
      const body = JSON.parse(res.body)
      expect(body.runId).toBe(RUN_ID)
      expect(body.messageId).toBe(MESSAGE_ID)
      expect(typeof body.conversationId).toBe('string')
    })

    it('uses the conversationId from the request body when provided', async function () {
      const req = makeReq({ conversationId: CONVERSATION_ID })
      const res = makeRes()
      await LlmAgentController.sendMessage(req, res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body.conversationId).toBe(CONVERSATION_ID)
    })

    it('emits new-chat-message to the project room', async function () {
      await LlmAgentController.sendMessage(makeReq(), makeRes(), vi.fn())

      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'new-chat-message',
        expect.any(Object)
      )
    })

    it('calls startRun with projectId and the correct payload', async function () {
      const selection = { docId: 'doc1', fromLine: 0, toLine: 5, content: '…' }
      const req = makeReq({
        conversationId: CONVERSATION_ID,
        selection,
      })
      await LlmAgentController.sendMessage(req, makeRes(), vi.fn())

      expect(LlmAgentApiHandler.promises.startRun).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          userId: USER_ID,
          conversationId: CONVERSATION_ID,
          userMessage: 'hello agent',
          selection,
        })
      )
    })

    it('saves the user message to the chat service thread', async function () {
      const req = makeReq({ conversationId: CONVERSATION_ID })
      await LlmAgentController.sendMessage(req, makeRes(), vi.fn())

      expect(ChatApiHandler.promises.sendComment).toHaveBeenCalledWith(
        PROJECT_ID,
        CONVERSATION_ID,
        USER_ID,
        'hello agent'
      )
    })
  })

  describe('sendMessage — validation', function () {
    it('returns 400 when message is absent', async function () {
      const req = makeReq({ message: undefined })
      const res = makeRes()
      await LlmAgentController.sendMessage(req, res, vi.fn())
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 when message is whitespace-only', async function () {
      const req = makeReq({ message: '   ' })
      const res = makeRes()
      await LlmAgentController.sendMessage(req, res, vi.fn())
      expect(res.statusCode).toBe(400)
    })

    it('forwards an error via next() when no user is in session', async function () {
      SessionManager.getLoggedInUserId.mockReturnValue(null)

      const next = vi.fn()
      await LlmAgentController.sendMessage(makeReq(), makeRes(), next)

      expect(next).toHaveBeenCalledWith(expect.any(Error))
    })
  })
})
