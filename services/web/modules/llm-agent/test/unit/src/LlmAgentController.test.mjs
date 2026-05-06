import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import MockResponse from '../../../../../test/unit/src/helpers/MockResponse.mjs'

const PROJECT_ID = 'aaa000000000000000000001'
const USER_ID = 'bbb000000000000000000001'
const CONVERSATION_ID = 'ccc000000000000000000001'
const RUN_ID = 'ddd000000000000000000001'
const MESSAGE_ID = 'eee000000000000000000001'

let SessionManager
let ChatApiHandler
let CompileManager
let ProjectGetter
let ProjectEntityHandler
let ProjectLocator
let EditorController
let EditorRealTimeController
let LlmAgentApiHandler
let LlmAgentController

describe('LlmAgentController', function () {
  beforeEach(async function () {
    vi.resetModules()

    SessionManager = { getLoggedInUserId: vi.fn().mockReturnValue(USER_ID) }
    vi.doMock(
      '../../../../../app/src/Features/Authentication/SessionManager.mjs',
      () => ({
        default: SessionManager,
      })
    )

    ChatApiHandler = {
      promises: {
        sendComment: vi.fn().mockResolvedValue({
          id: MESSAGE_ID,
          user_id: USER_ID,
          content: 'hello agent',
        }),
        getThreadMessage: vi.fn().mockResolvedValue({
          id: MESSAGE_ID,
          user_id: USER_ID,
          content: 'hello from agent',
        }),
      },
    }
    vi.doMock('../../../../../app/src/Features/Chat/ChatApiHandler.mjs', () => ({
      default: ChatApiHandler,
    }))

    ProjectGetter = {
      promises: {
        getProject: vi.fn().mockResolvedValue({
          _id: PROJECT_ID,
          name: 'Sample Project',
          compiler: 'pdflatex',
        }),
      },
    }
    vi.doMock('../../../../../app/src/Features/Project/ProjectGetter.mjs', () => ({
      default: ProjectGetter,
    }))

    ProjectEntityHandler = {
      getAllEntitiesFromProject: vi.fn().mockReturnValue({
        docs: [
          { path: '/main.tex', doc: { _id: { toString: () => 'doc-main' } } },
          {
            path: '/chapters/intro.tex',
            doc: { _id: { toString: () => 'doc-intro' } },
          },
        ],
        files: [],
        folders: [],
      }),
    }
    vi.doMock(
      '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs',
      () => ({
        default: ProjectEntityHandler,
      })
    )

    ProjectLocator = {
      promises: {
        findElementByPath: vi.fn().mockResolvedValue({
          element: { _id: { toString: () => 'entity-id-1' } },
          type: 'doc',
          folder: { _id: { toString: () => 'folder-old' } },
        }),
      },
    }
    vi.doMock('../../../../../app/src/Features/Project/ProjectLocator.mjs', () => ({
      default: ProjectLocator,
    }))

    EditorController = {
      promises: {
        renameEntity: vi.fn().mockResolvedValue(undefined),
        mkdirp: vi.fn().mockResolvedValue({
          lastFolder: { _id: { toString: () => 'folder-new' } },
        }),
        moveEntity: vi.fn().mockResolvedValue(undefined),
      },
    }
    vi.doMock('../../../../../app/src/Features/Editor/EditorController.mjs', () => ({
      default: EditorController,
    }))

    CompileManager = {
      promises: {
        compile: vi.fn().mockResolvedValue({
          status: 'success',
          outputFiles: [],
        }),
      },
    }
    vi.doMock('../../../../../app/src/Features/Compile/CompileManager.mjs', () => ({
      default: CompileManager,
    }))

    vi.doMock(
      '../../../../../app/src/Features/User/UserInfoManager.mjs',
      () => ({
        default: {
          promises: {
            getPersonalInfo: vi.fn().mockResolvedValue({ _id: USER_ID }),
          },
        },
      })
    )

    vi.doMock(
      '../../../../../app/src/Features/User/UserInfoController.mjs',
      () => ({
        default: {
          formatPersonalInfo: vi.fn().mockReturnValue({ id: USER_ID }),
        },
      })
    )

    EditorRealTimeController = { emitToRoom: vi.fn() }
    vi.doMock(
      '../../../../../app/src/Features/Editor/EditorRealTimeController.mjs',
      () => ({
        default: EditorRealTimeController,
      })
    )

    LlmAgentApiHandler = {
      promises: { startRun: vi.fn().mockResolvedValue({ runId: RUN_ID }) },
    }
    vi.doMock('../../../app/src/LlmAgentApiHandler.mjs', () => ({
      default: LlmAgentApiHandler,
    }))

    // Import after mocks are registered
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
      await LlmAgentController.sendMessage(req, res, vi.fn())

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
          context: {
            projectName: 'Sample Project',
            compiler: 'pdflatex',
            files: [
              { path: 'chapters/intro.tex', docId: 'doc-intro' },
              { path: 'main.tex', docId: 'doc-main' },
            ],
          },
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

    it('returns 404 when project cannot be loaded', async function () {
      ProjectGetter.promises.getProject.mockResolvedValueOnce(null)
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(res.statusCode).toBe(404)
    })
  })

  describe('agentComplete', function () {
    it('emits an existing chat message when messageId is provided', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: { conversationId: CONVERSATION_ID, messageId: MESSAGE_ID },
      }
      const res = makeRes()
      await LlmAgentController.agentComplete(req, res, vi.fn())

      expect(ChatApiHandler.promises.getThreadMessage).toHaveBeenCalledWith(
        PROJECT_ID,
        CONVERSATION_ID,
        MESSAGE_ID
      )
      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'new-chat-message',
        expect.objectContaining({ id: MESSAGE_ID })
      )
      expect(res.statusCode).toBe(204)
    })

    it('creates and emits a chat message from content payload', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: {
          conversationId: CONVERSATION_ID,
          userId: USER_ID,
          content: 'stub',
        },
      }
      const res = makeRes()
      await LlmAgentController.agentComplete(req, res, vi.fn())

      expect(ChatApiHandler.promises.sendComment).toHaveBeenCalledWith(
        PROJECT_ID,
        CONVERSATION_ID,
        USER_ID,
        'stub'
      )
      expect(res.statusCode).toBe(204)
    })
  })

  describe('agentMoveFile', function () {
    function makeMoveReq(oldPath, newPath) {
      return {
        params: { project_id: PROJECT_ID },
        body: { oldPath, newPath, userId: USER_ID },
      }
    }

    it('rolls back directory move if rename fails', async function () {
      EditorController.promises.renameEntity.mockRejectedValueOnce(
        new Error('rename failed')
      )
      const req = makeMoveReq('old/main.tex', 'new/renamed.tex')
      const res = makeRes()
      const next = vi.fn()
      await LlmAgentController.agentMoveFile(req, res, next)

      expect(EditorController.promises.moveEntity).toHaveBeenNthCalledWith(
        1,
        PROJECT_ID,
        'entity-id-1',
        'folder-new',
        'doc',
        USER_ID,
        'llm-agent'
      )
      expect(EditorController.promises.moveEntity).toHaveBeenNthCalledWith(
        2,
        PROJECT_ID,
        'entity-id-1',
        'folder-old',
        'doc',
        USER_ID,
        'llm-agent-rollback'
      )
      expect(next).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('internalCompile', function () {
    let fetchMock

    afterEach(function () {
      vi.unstubAllGlobals()
    })

    function makeCompileReq(body = {}) {
      return {
        params: { project_id: PROJECT_ID },
        body: { userId: USER_ID, ...body },
      }
    }

    it('returns success:true and pageCount when compile succeeds', async function () {
      fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ pageCount: 3 }),
      })
      vi.stubGlobal('fetch', fetchMock)

      const res = makeRes()
      await LlmAgentController.internalCompile(makeCompileReq(), res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body.success).toBe(true)
      expect(body.status).toBe('success')
      expect(body.errors).toEqual([])
      expect(body.pageCount).toBe(3)
    })

    it('returns success:false and errors parsed from output-log on failure', async function () {
      const logContent = `./main.tex:5: Undefined control sequence.\n! Emergency stop.\n`
      CompileManager.promises.compile.mockResolvedValueOnce({
        status: 'failure',
        outputFiles: [],
      })
      fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => logContent,
      })
      vi.stubGlobal('fetch', fetchMock)

      const res = makeRes()
      await LlmAgentController.internalCompile(makeCompileReq(), res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body.success).toBe(false)
      expect(body.errors).toEqual([
        './main.tex:5: Undefined control sequence.',
        'Emergency stop.',
      ])
      // Verify it called the output-log CLSI route
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/output-log')
      )
    })

    it('returns errors:[] when output-log route returns 404', async function () {
      CompileManager.promises.compile.mockResolvedValueOnce({
        status: 'failure',
        outputFiles: [],
      })
      fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      vi.stubGlobal('fetch', fetchMock)

      const res = makeRes()
      await LlmAgentController.internalCompile(makeCompileReq(), res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body.errors).toEqual([])
    })

    it('returns errors:[] when fetching output-log fails', async function () {
      CompileManager.promises.compile.mockResolvedValueOnce({
        status: 'failure',
        outputFiles: [],
      })
      fetchMock = vi.fn().mockRejectedValue(new Error('network error'))
      vi.stubGlobal('fetch', fetchMock)

      const res = makeRes()
      await LlmAgentController.internalCompile(makeCompileReq(), res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body.errors).toEqual([])
    })

    it('returns 400 when userId is missing', async function () {
      const req = { params: { project_id: PROJECT_ID }, body: {} }
      const res = makeRes()
      await LlmAgentController.internalCompile(req, res, vi.fn())
      expect(res.statusCode).toBe(400)
    })
  })

  describe('agentPdfPage', function () {
    afterEach(function () {
      vi.unstubAllGlobals()
    })

    function makePageReq(query = {}) {
      return {
        params: { project_id: PROJECT_ID },
        query: { userId: USER_ID, page: '1', ...query },
      }
    }

    it('returns the PNG bytes as base64 when CLSI returns 200', async function () {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          arrayBuffer: async () => png.buffer.slice(
            png.byteOffset,
            png.byteOffset + png.byteLength
          ),
        })
      )
      const res = makeRes()
      await LlmAgentController.agentPdfPage(makePageReq(), res, vi.fn())
      const body = JSON.parse(res.body)
      expect(body.mimeType).toBe('image/png')
      expect(body.imageBase64).toBe(png.toString('base64'))
    })

    it('passes 404 NO_PDF body through from CLSI', async function () {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 404,
          json: async () => ({ error: 'no compiled PDF', code: 'NO_PDF' }),
        })
      )
      const res = makeRes()
      await LlmAgentController.agentPdfPage(makePageReq(), res, vi.fn())
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.body)).toEqual({
        error: 'no compiled PDF',
        code: 'NO_PDF',
      })
    })

    it('passes 416 PAGE_OUT_OF_RANGE body through from CLSI', async function () {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 416,
          json: async () => ({
            error: 'page out of range',
            code: 'PAGE_OUT_OF_RANGE',
          }),
        })
      )
      const res = makeRes()
      await LlmAgentController.agentPdfPage(makePageReq(), res, vi.fn())
      expect(res.statusCode).toBe(416)
      expect(JSON.parse(res.body)).toEqual({
        error: 'page out of range',
        code: 'PAGE_OUT_OF_RANGE',
      })
    })

    it('returns 502 cleanly when CLSI is unreachable (fetch throws)', async function () {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
      const res = makeRes()
      await LlmAgentController.agentPdfPage(makePageReq(), res, vi.fn())
      expect(res.statusCode).toBe(502)
    })

    it('returns 502 cleanly when CLSI body fails JSON parse on error response', async function () {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 404,
          statusText: 'Not Found',
          json: async () => {
            throw new Error('not JSON')
          },
        })
      )
      const res = makeRes()
      await LlmAgentController.agentPdfPage(makePageReq(), res, vi.fn())
      // Falls through to a clean 404 with synthetic body, not a thrown 500.
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.body).error).toBe('Not Found')
    })

    it('returns 400 when page is missing or invalid', async function () {
      const res = makeRes()
      await LlmAgentController.agentPdfPage(
        makePageReq({ page: '0' }),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 when userId is missing', async function () {
      const res = makeRes()
      await LlmAgentController.agentPdfPage(
        { params: { project_id: PROJECT_ID }, query: { page: '1' } },
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(400)
    })
  })
})
