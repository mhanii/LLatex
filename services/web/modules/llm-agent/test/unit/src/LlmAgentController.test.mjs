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
let ProjectCreationHandler
let AgentConversationManager
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
        getThread: vi.fn().mockResolvedValue({
          messages: [
            {
              id: MESSAGE_ID,
              user_id: USER_ID,
              content: 'hello agent',
              timestamp: 1,
            },
          ],
        }),
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

    vi.doMock('../../../../../app/src/Features/Chat/ChatManager.mjs', () => ({
      default: {
        promises: {
          injectUserInfoIntoThreads: vi.fn().mockImplementation(async threads => {
            for (const thread of Object.values(threads)) {
              for (const message of thread.messages) {
                message.user = { id: message.user_id }
              }
            }
            return threads
          }),
        },
      },
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

    AgentConversationManager = {
      promises: {
        createConversation: vi.fn().mockResolvedValue({
          id: CONVERSATION_ID,
          title: 'New chat',
          updatedAt: 1,
        }),
        listConversations: vi.fn().mockResolvedValue([
          { id: CONVERSATION_ID, title: 'hello agent', updatedAt: 1 },
        ]),
        getConversation: vi.fn().mockResolvedValue({
          id: CONVERSATION_ID,
          title: 'hello agent',
          updatedAt: 1,
        }),
        ensureConversation: vi.fn().mockResolvedValue({
          id: CONVERSATION_ID,
          title: 'hello agent',
          updatedAt: 1,
        }),
        recordMessage: vi.fn().mockResolvedValue(undefined),
        getMessageRoles: vi
          .fn()
          .mockResolvedValue(new Map([[MESSAGE_ID, 'user']])),
        getMessageMetadata: vi
          .fn()
          .mockResolvedValue(new Map([[MESSAGE_ID, { role: 'user', runId: null }]])),
        recordRun: vi.fn().mockResolvedValue(undefined),
      },
    }
    vi.doMock('../../../app/src/AgentConversationManager.mjs', () => ({
      default: AgentConversationManager,
    }))

    ProjectCreationHandler = {
      promises: {
        createProjectFromSnippet: vi.fn().mockResolvedValue({
          _id: { toString: () => PROJECT_ID },
        }),
      },
    }
    vi.doMock(
      '../../../../../app/src/Features/Project/ProjectCreationHandler.mjs',
      () => ({ default: ProjectCreationHandler })
    )

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

    it('calls ensureConversation with userId for ownership enforcement', async function () {
      const req = makeReq({ conversationId: CONVERSATION_ID })
      await LlmAgentController.sendMessage(req, makeRes(), vi.fn())

      expect(
        AgentConversationManager.promises.ensureConversation
      ).toHaveBeenCalledWith(PROJECT_ID, CONVERSATION_ID, USER_ID, 'hello agent')
    })

    it('emits agent:message to the project room', async function () {
      await LlmAgentController.sendMessage(makeReq(), makeRes(), vi.fn())

      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'agent:message',
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

    it('records the user message as an agent conversation message', async function () {
      const req = makeReq({ conversationId: CONVERSATION_ID })
      await LlmAgentController.sendMessage(req, makeRes(), vi.fn())

      expect(AgentConversationManager.promises.recordMessage).toHaveBeenCalledWith(
        PROJECT_ID,
        CONVERSATION_ID,
        expect.objectContaining({ id: MESSAGE_ID }),
        'user'
      )
    })
  })

  describe('agent conversations', function () {
    it('creates a conversation', async function () {
      const req = { params: { project_id: PROJECT_ID }, session: {} }
      const res = makeRes()
      await LlmAgentController.createConversation(req, res, vi.fn())

      expect(AgentConversationManager.promises.createConversation).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID
      )
      expect(res.statusCode).toBe(201)
    })

    it('lists conversations scoped to the logged-in user', async function () {
      const req = { params: { project_id: PROJECT_ID }, session: {} }
      const res = makeRes()
      await LlmAgentController.listConversations(req, res, vi.fn())

      expect(
        AgentConversationManager.promises.listConversations
      ).toHaveBeenCalledWith(PROJECT_ID, USER_ID)
      expect(JSON.parse(res.body)[0].id).toBe(CONVERSATION_ID)
    })

    it('returns 403 from listConversations when no user is in session', async function () {
      SessionManager.getLoggedInUserId.mockReturnValue(null)
      const req = { params: { project_id: PROJECT_ID }, session: {} }
      const res = makeRes()
      await LlmAgentController.listConversations(req, res, vi.fn())
      expect(res.statusCode).toBe(403)
    })

    it('loads messages with agent roles', async function () {
      const req = {
        params: {
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
        },
        session: {},
      }
      const res = makeRes()
      await LlmAgentController.getConversationMessages(req, res, vi.fn())

      expect(
        AgentConversationManager.promises.getConversation
      ).toHaveBeenCalledWith(PROJECT_ID, CONVERSATION_ID, USER_ID)
      expect(JSON.parse(res.body)[0]).toMatchObject({
        id: MESSAGE_ID,
        role: 'user',
      })
    })

    it('returns 403 from getConversationMessages when no user is in session', async function () {
      SessionManager.getLoggedInUserId.mockReturnValue(null)
      const req = {
        params: {
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
        },
        session: {},
      }
      const res = makeRes()
      await LlmAgentController.getConversationMessages(req, res, vi.fn())
      expect(res.statusCode).toBe(403)
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

    it('returns 403 when no user is in session', async function () {
      SessionManager.getLoggedInUserId.mockReturnValue(null)

      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())

      expect(res.statusCode).toBe(403)
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
        'agent:message',
        expect.objectContaining({
          conversationId: CONVERSATION_ID,
          message: expect.objectContaining({ id: MESSAGE_ID }),
        })
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

    it('returns 500 when an existing chat message cannot be loaded', async function () {
      ChatApiHandler.promises.getThreadMessage.mockResolvedValueOnce(null)
      const req = {
        params: { project_id: PROJECT_ID },
        body: { conversationId: CONVERSATION_ID, messageId: MESSAGE_ID },
      }
      const res = makeRes()
      await LlmAgentController.agentComplete(req, res, vi.fn())

      expect(
        AgentConversationManager.promises.recordMessage
      ).not.toHaveBeenCalled()
      expect(EditorRealTimeController.emitToRoom).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(500)
      expect(JSON.parse(res.body)).toEqual({
        error: 'agent completion message was not found',
      })
    })

    it('emits tool call progress events', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: {
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          toolName: 'compile_and_check',
          status: 'running',
        },
      }
      const res = makeRes()
      await LlmAgentController.agentToolCall(req, res, vi.fn())

      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'agent:tool-call',
        expect.objectContaining({
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          toolName: 'compile_and_check',
          status: 'running',
        })
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

    function streamingResponse(text) {
      // Minimal Response shape that LogParser.fetchFileWithSizeLimit understands
      // (it prefers .body.getReader() over .text()).
      return {
        ok: true,
        body: {
          getReader() {
            let done = false
            return {
              async read() {
                if (done) return { value: undefined, done: true }
                done = true
                return { value: new TextEncoder().encode(text), done: false }
              },
            }
          },
        },
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
      expect(body.warnings).toEqual([])
      expect(body.typesetting).toEqual([])
      expect(body.pageCount).toBe(3)
    })

    it('parses structured errors and warnings from outputFiles output.log', async function () {
      // First line of an output.log is always the TeX banner — both the
      // upstream parser and our port treat lines[0] as a header and start
      // iterating from lines[1]. The warning has to come before the error
      // because parser's STATE.ERROR consumes following non-blank lines as
      // part of the error's content.
      const logContent =
        'This is pdfTeX, Version 3.141592653\n' +
        'LaTeX Warning: Reference `fig:1\' on page 1 undefined on input line 7.\n' +
        '\n' +
        './main.tex:5: Undefined control sequence.\n' +
        'l.5 \\badcommand\n'
      CompileManager.promises.compile.mockResolvedValueOnce({
        status: 'failure',
        outputFiles: [
          {
            path: 'output.log',
            url: '/project/p/user/u/build/b/output/output.log',
            build: 'b',
          },
        ],
      })
      fetchMock = vi.fn().mockResolvedValue(streamingResponse(logContent))
      vi.stubGlobal('fetch', fetchMock)

      const res = makeRes()
      await LlmAgentController.internalCompile(makeCompileReq(), res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body.success).toBe(false)
      expect(body.errors.length).toBeGreaterThanOrEqual(1)
      expect(body.errors[0]).toMatchObject({
        level: 'error',
        file: './main.tex',
        message: expect.stringContaining('Undefined control sequence'),
      })
      // Has the upstream HumanReadableLogs ruleId stamped on it.
      expect(body.errors[0].ruleId).toBe('hint_undefined_control_sequence')
      expect(body.warnings.length).toBeGreaterThanOrEqual(1)
      expect(body.warnings[0]).toMatchObject({
        level: 'warning',
        message: expect.stringContaining('Reference'),
      })
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/output/output.log'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    })

    it('returns empty entries when outputFiles is empty', async function () {
      CompileManager.promises.compile.mockResolvedValueOnce({
        status: 'failure',
        outputFiles: [],
      })
      fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const res = makeRes()
      await LlmAgentController.internalCompile(makeCompileReq(), res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body.errors).toEqual([])
      expect(body.warnings).toEqual([])
      expect(body.typesetting).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns empty entries when fetching output.log fails', async function () {
      CompileManager.promises.compile.mockResolvedValueOnce({
        status: 'failure',
        outputFiles: [
          {
            path: 'output.log',
            url: '/project/p/user/u/build/b/output/output.log',
            build: 'b',
          },
        ],
      })
      fetchMock = vi.fn().mockRejectedValue(new Error('network error'))
      vi.stubGlobal('fetch', fetchMock)

      const res = makeRes()
      await LlmAgentController.internalCompile(makeCompileReq(), res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body.errors).toEqual([])
      expect(body.warnings).toEqual([])
    })

    it('parses *.blg BibTeX errors alongside output.log', async function () {
      const blgContent =
        'This is BibTeX, Version 0.99d (TeX Live)\n' +
        'A bad cross reference---entry "foo"\nrefers to entry "bar", which doesn\'t exist\n'
      CompileManager.promises.compile.mockResolvedValueOnce({
        status: 'failure',
        outputFiles: [
          {
            path: 'output.blg',
            url: '/project/p/user/u/build/b/output/output.blg',
            build: 'b',
          },
        ],
      })
      fetchMock = vi.fn().mockResolvedValue(streamingResponse(blgContent))
      vi.stubGlobal('fetch', fetchMock)

      const res = makeRes()
      await LlmAgentController.internalCompile(makeCompileReq(), res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body.errors.length).toBeGreaterThanOrEqual(1)
      expect(body.errors[0].message.startsWith('BibTeX:')).toBe(true)
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

  describe('agentCreateProject', function () {
    function makeCreateReq(body) {
      return { params: {}, body, session: {} }
    }

    it('creates a project and returns the new projectId on success', async function () {
      const res = makeRes()
      await LlmAgentController.agentCreateProject(
        makeCreateReq({
          userId: USER_ID,
          projectName: 'e2e-test',
          docLines: ['\\documentclass{article}', '\\begin{document}', '\\end{document}'],
        }),
        res,
        vi.fn()
      )
      expect(res.body).toBeDefined()
      const body = JSON.parse(res.body)
      expect(body.projectId).toBe(PROJECT_ID)
      expect(
        ProjectCreationHandler.promises.createProjectFromSnippet
      ).toHaveBeenCalledOnce()
    })

    it('returns 400 when userId is missing', async function () {
      const res = makeRes()
      await LlmAgentController.agentCreateProject(
        makeCreateReq({ projectName: 'x' }),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 when projectName is missing', async function () {
      const res = makeRes()
      await LlmAgentController.agentCreateProject(
        makeCreateReq({ userId: USER_ID }),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 when docLines is a string (not an array)', async function () {
      const res = makeRes()
      await LlmAgentController.agentCreateProject(
        makeCreateReq({
          userId: USER_ID,
          projectName: 'x',
          docLines: '\\documentclass{article}',
        }),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(400)
      expect(
        ProjectCreationHandler.promises.createProjectFromSnippet
      ).not.toHaveBeenCalled()
    })

    it('returns 400 when docLines is an object (not an array)', async function () {
      const res = makeRes()
      await LlmAgentController.agentCreateProject(
        makeCreateReq({
          userId: USER_ID,
          projectName: 'x',
          docLines: { lines: ['a'] },
        }),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(400)
      expect(
        ProjectCreationHandler.promises.createProjectFromSnippet
      ).not.toHaveBeenCalled()
    })

    it('accepts omitted docLines and uses a sensible default', async function () {
      const res = makeRes()
      await LlmAgentController.agentCreateProject(
        makeCreateReq({ userId: USER_ID, projectName: 'x' }),
        res,
        vi.fn()
      )
      const body = JSON.parse(res.body)
      expect(body.projectId).toBe(PROJECT_ID)
      const passedLines =
        ProjectCreationHandler.promises.createProjectFromSnippet.mock.calls[0][2]
      expect(Array.isArray(passedLines)).toBe(true)
    })
  })
})
