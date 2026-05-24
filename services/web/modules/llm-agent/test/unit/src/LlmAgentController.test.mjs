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
let AgentCompileCoordinator
let ProjectGetter
let ProjectEntityHandler
let ProjectLocator
let EditorController
let EditorRealTimeController
let DocumentUpdaterHandler
let LlmAgentApiHandler
let ProjectCreationHandler
let AgentConversationManager
let UserGetter
let UserUpdater
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
        deleteMessage: vi.fn().mockResolvedValue(undefined),
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

    AgentCompileCoordinator = {
      compile: vi.fn().mockResolvedValue({
        status: 'success',
        outputFiles: [],
      }),
    }
    vi.doMock('../../../app/src/AgentCompileCoordinator.mjs', () => ({
      default: AgentCompileCoordinator,
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

    DocumentUpdaterHandler = {
      promises: {
        acceptChanges: vi.fn().mockResolvedValue({
          acceptedChangeIds: ['change-1'],
        }),
        flushProjectToMongo: vi.fn().mockResolvedValue(undefined),
      },
    }
    vi.doMock(
      '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs',
      () => ({
        default: DocumentUpdaterHandler,
      })
    )

    vi.doMock(
      '../../../../../app/src/Features/History/HistoryManager.mjs',
      () => ({
        default: {
          promises: {
            flushProject: vi.fn().mockResolvedValue(undefined),
            // History-v1 shape: { chunk: { history: { changes }, startVersion } };
            // endVersion is derived as startVersion + changes.length.
            getLatestHistory: vi.fn().mockResolvedValue({
              chunk: {
                history: { changes: new Array(100) },
                startVersion: 0,
              },
            }),
          },
        },
      })
    )

    vi.doMock(
      '../../../../../app/src/Features/History/RestoreManager.mjs',
      () => ({
        default: {
          promises: {
            revertProject: vi.fn().mockResolvedValue([]),
          },
        },
      })
    )

    vi.doMock(
      '../../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs',
      () => ({
        default: {
          addEntryIfManagedInBackground: vi.fn(),
        },
      })
    )

    vi.doMock('@overleaf/logger', () => ({
      default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))

    LlmAgentApiHandler = {
      promises: {
        startRun: vi.fn().mockResolvedValue({ runId: RUN_ID }),
        getRunSteps: vi.fn().mockResolvedValue({ steps: [] }),
      },
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
        getMessageMetadata: vi
          .fn()
          .mockResolvedValue(new Map([[MESSAGE_ID, { role: 'user', runId: null }]])),
        recordRun: vi.fn().mockResolvedValue(undefined),
        findUserMessage: vi.fn().mockResolvedValue(null),
        truncateFromMessage: vi.fn().mockResolvedValue([]),
        getActiveRunId: vi.fn().mockResolvedValue(null),
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

    // Defaults model an unlimited user — every existing test path stays
    // green. Quota-specific tests override getUser per-test.
    UserGetter = {
      promises: {
        getUser: vi.fn().mockResolvedValue({
          agentQuota: {
            outputTokensLimit: -1,
            outputTokensUsed: 0,
            costUsdLimit: -1,
            costUsdUsed: 0,
          },
        }),
      },
    }
    vi.doMock('../../../../../app/src/Features/User/UserGetter.mjs', () => ({
      default: UserGetter,
    }))

    UserUpdater = {
      promises: { updateUser: vi.fn().mockResolvedValue({ matchedCount: 1 }) },
    }
    vi.doMock('../../../../../app/src/Features/User/UserUpdater.mjs', () => ({
      default: UserUpdater,
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
        'user',
        null,
        expect.anything()
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
      expect(
        AgentConversationManager.promises.getMessageMetadata
      ).toHaveBeenCalledWith(PROJECT_ID, CONVERSATION_ID)
      expect(JSON.parse(res.body)[0]).toMatchObject({
        id: MESSAGE_ID,
        role: 'user',
      })
    })

    it('includes toolEvents for assistant messages with a runId', async function () {
      const ASSISTANT_MESSAGE_ID = 'eee000000000000000000002'
      ChatApiHandler.promises.getThread.mockResolvedValueOnce({
        messages: [
          {
            id: MESSAGE_ID,
            user_id: USER_ID,
            content: 'hello agent',
            timestamp: 1,
          },
          {
            id: ASSISTANT_MESSAGE_ID,
            user_id: USER_ID,
            content: 'I read the file.',
            timestamp: 2,
          },
        ],
      })
      AgentConversationManager.promises.getMessageMetadata.mockResolvedValueOnce(
        new Map([
          [MESSAGE_ID, { role: 'user', runId: null }],
          [ASSISTANT_MESSAGE_ID, { role: 'assistant', runId: RUN_ID }],
        ])
      )
      LlmAgentApiHandler.promises.getRunSteps.mockResolvedValueOnce({
        steps: [
          {
            name: 'llm.complete',
            // ISO strings — matches what fetchJson returns after the HTTP
            // round-trip; Date instances would mask a getTime() bug.
            startedAt: new Date(1000).toISOString(),
            finishedAt: new Date(2000).toISOString(),
            output: {
              text: '',
              reasoning: [],
              toolCalls: [
                {
                  toolCallId: 'tc-1',
                  toolName: 'read_file',
                  input: { path: 'main.tex' },
                },
              ],
              toolResults: [
                {
                  toolCallId: 'tc-1',
                  toolName: 'read_file',
                  input: { path: 'main.tex' },
                  output: 'file content',
                },
              ],
              finishReason: 'tool-calls',
            },
          },
        ],
      })

      const req = {
        params: {
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
        },
        session: {},
      }
      const res = makeRes()
      await LlmAgentController.getConversationMessages(req, res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body).toHaveLength(2)
      expect(body[0]).toMatchObject({
        id: MESSAGE_ID,
        role: 'user',
      })
      expect(body[1]).toMatchObject({
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        toolEvents: [
          {
            toolCallId: 'tc-1',
            toolName: 'read_file',
            status: 'completed',
            input: { path: 'main.tex' },
            timestamp: 2000,
          },
        ],
      })
      expect(LlmAgentApiHandler.promises.getRunSteps).toHaveBeenCalledWith(
        PROJECT_ID,
        RUN_ID
      )
    })

    it('falls back gracefully when getRunSteps fails', async function () {
      const ASSISTANT_MESSAGE_ID = 'eee000000000000000000002'
      ChatApiHandler.promises.getThread.mockResolvedValueOnce({
        messages: [
          {
            id: ASSISTANT_MESSAGE_ID,
            user_id: USER_ID,
            content: 'I read the file.',
            timestamp: 2,
          },
        ],
      })
      AgentConversationManager.promises.getMessageMetadata.mockResolvedValueOnce(
        new Map([
          [ASSISTANT_MESSAGE_ID, { role: 'assistant', runId: RUN_ID }],
        ])
      )
      LlmAgentApiHandler.promises.getRunSteps.mockRejectedValueOnce(
        new Error('service unavailable')
      )

      const req = {
        params: {
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
        },
        session: {},
      }
      const res = makeRes()
      await LlmAgentController.getConversationMessages(req, res, vi.fn())

      const body = JSON.parse(res.body)
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
      })
      expect(body[0].toolEvents).toBeUndefined()
    })

    it('marks tool events as error when the matching toolResult is missing or errored', async function () {
      const ASSISTANT_MESSAGE_ID = 'eee000000000000000000003'
      ChatApiHandler.promises.getThread.mockResolvedValueOnce({
        messages: [
          {
            id: ASSISTANT_MESSAGE_ID,
            user_id: USER_ID,
            content: 'attempted three tools',
            timestamp: 1,
          },
        ],
      })
      AgentConversationManager.promises.getMessageMetadata.mockResolvedValueOnce(
        new Map([
          [ASSISTANT_MESSAGE_ID, { role: 'assistant', runId: RUN_ID }],
        ])
      )
      LlmAgentApiHandler.promises.getRunSteps.mockResolvedValueOnce({
        steps: [
          {
            name: 'llm.complete',
            startedAt: new Date(1000).toISOString(),
            finishedAt: new Date(2000).toISOString(),
            output: {
              toolCalls: [
                { toolCallId: 'ok', toolName: 'read_file', input: { path: 'a' } },
                { toolCallId: 'errfield', toolName: 'edit_file', input: { path: 'b' } },
                { toolCallId: 'missing', toolName: 'compile_and_check', input: {} },
              ],
              toolResults: [
                { toolCallId: 'ok', toolName: 'read_file', output: 'contents' },
                {
                  toolCallId: 'errfield',
                  toolName: 'edit_file',
                  error: 'oldText not found',
                },
                // 'missing' deliberately omitted
              ],
            },
          },
        ],
      })

      const req = {
        params: { project_id: PROJECT_ID, conversation_id: CONVERSATION_ID },
        session: {},
      }
      const res = makeRes()
      await LlmAgentController.getConversationMessages(req, res, vi.fn())

      const events = JSON.parse(res.body)[0].toolEvents
      expect(events).toHaveLength(3)
      expect(events.find(e => e.toolCallId === 'ok').status).toBe('completed')
      expect(events.find(e => e.toolCallId === 'errfield').status).toBe('error')
      expect(events.find(e => e.toolCallId === 'missing').status).toBe('error')
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

    it('accepts agent changes and emits the normal accept-changes event', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: {
          docId: 'doc-main',
          changeIds: ['change-1', 'change-2'],
          userId: USER_ID,
        },
      }
      const res = makeRes()
      await LlmAgentController.agentAcceptChanges(req, res, vi.fn())

      expect(DocumentUpdaterHandler.promises.acceptChanges).toHaveBeenCalledWith(
        PROJECT_ID,
        'doc-main',
        ['change-1', 'change-2'],
        USER_ID
      )
      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'accept-changes',
        'doc-main',
        ['change-1']
      )
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ acceptedChangeIds: ['change-1'] })
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
      AgentCompileCoordinator.compile.mockResolvedValueOnce({
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
      AgentCompileCoordinator.compile.mockResolvedValueOnce({
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
      AgentCompileCoordinator.compile.mockResolvedValueOnce({
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
      AgentCompileCoordinator.compile.mockResolvedValueOnce({
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

    it('routes through AgentCompileCoordinator (not CompileManager directly)', async function () {
      fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ pageCount: 1 }),
      })
      vi.stubGlobal('fetch', fetchMock)

      const req = makeCompileReq({ rootDoc_id: 'doc-root', stopOnFirstError: true })
      const res = makeRes()
      await LlmAgentController.internalCompile(req, res, vi.fn())

      expect(AgentCompileCoordinator.compile).toHaveBeenCalledTimes(1)
      expect(CompileManager.promises.compile).not.toHaveBeenCalled()
      const [pid, uid, opts] = AgentCompileCoordinator.compile.mock.calls[0]
      expect(pid).toBe(PROJECT_ID)
      expect(uid).toBe(USER_ID)
      expect(opts).toMatchObject({
        isAutoCompile: false,
        fileLineErrors: true,
        rootDoc_id: 'doc-root',
        stopOnFirstError: true,
      })
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

  describe('sendMessage — agent quota gate', function () {
    it('returns 402 with reason=output_tokens when the user is over the output-token cap', async function () {
      UserGetter.promises.getUser.mockResolvedValueOnce({
        agentQuota: {
          outputTokensLimit: 1000,
          outputTokensUsed: 1500,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())

      expect(res.statusCode).toBe(402)
      const body = JSON.parse(res.body)
      expect(body.error).toBe('agent_quota_exceeded')
      expect(body.reason).toBe('output_tokens')
      expect(body.quota).toEqual({
        outputTokensLimit: 1000,
        outputTokensUsed: 1500,
        costUsdLimit: -1,
        costUsdUsed: 0,
      })
    })

    it('returns 402 with reason=cost when the user is over the cost cap', async function () {
      UserGetter.promises.getUser.mockResolvedValueOnce({
        agentQuota: {
          outputTokensLimit: -1,
          outputTokensUsed: 0,
          costUsdLimit: 1.0,
          costUsdUsed: 1.05,
        },
      })
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())

      expect(res.statusCode).toBe(402)
      const body = JSON.parse(res.body)
      expect(body.reason).toBe('cost')
    })

    it('reports reason=cost when both caps are exceeded — cost takes precedence', async function () {
      UserGetter.promises.getUser.mockResolvedValueOnce({
        agentQuota: {
          outputTokensLimit: 100,
          outputTokensUsed: 200,
          costUsdLimit: 0.5,
          costUsdUsed: 0.6,
        },
      })
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(res.statusCode).toBe(402)
      expect(JSON.parse(res.body).reason).toBe('cost')
    })

    it('returns exactly equal-to-limit as exceeded (>= not >)', async function () {
      UserGetter.promises.getUser.mockResolvedValueOnce({
        agentQuota: {
          outputTokensLimit: 1000,
          outputTokensUsed: 1000,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(res.statusCode).toBe(402)
    })

    it('denies with reason=output_tokens when outputTokensLimit is exactly 0 (deny-all sentinel)', async function () {
      // 0 is a valid "deny all" value documented in settings.defaults.js
      // (Number.isFinite preserves it from the env var). Earlier the gate
      // used `> 0` for cap detection, which collapsed 0 with the -1
      // unlimited sentinel and let zero-cap users through.
      UserGetter.promises.getUser.mockResolvedValueOnce({
        agentQuota: {
          outputTokensLimit: 0,
          outputTokensUsed: 0,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(res.statusCode).toBe(402)
      expect(JSON.parse(res.body).reason).toBe('output_tokens')
      expect(LlmAgentApiHandler.promises.startRun).not.toHaveBeenCalled()
    })

    it('denies with reason=cost when costUsdLimit is exactly 0 (deny-all sentinel)', async function () {
      UserGetter.promises.getUser.mockResolvedValueOnce({
        agentQuota: {
          outputTokensLimit: -1,
          outputTokensUsed: 0,
          costUsdLimit: 0,
          costUsdUsed: 0,
        },
      })
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(res.statusCode).toBe(402)
      expect(JSON.parse(res.body).reason).toBe('cost')
    })

    it('denies (cost takes precedence) when both limits are 0', async function () {
      UserGetter.promises.getUser.mockResolvedValueOnce({
        agentQuota: {
          outputTokensLimit: 0,
          outputTokensUsed: 0,
          costUsdLimit: 0,
          costUsdUsed: 0,
        },
      })
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(res.statusCode).toBe(402)
      expect(JSON.parse(res.body).reason).toBe('cost')
    })

    it('passes through when outputTokensLimit is -1 (unlimited) regardless of used', async function () {
      UserGetter.promises.getUser.mockResolvedValueOnce({
        agentQuota: {
          outputTokensLimit: -1,
          outputTokensUsed: 1_000_000_000,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(res.statusCode).toBe(202)
    })

    it('passes through when the user document has no agentQuota field at all', async function () {
      UserGetter.promises.getUser.mockResolvedValueOnce({})
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(res.statusCode).toBe(202)
    })

    it('does not create a chat message or conversation when blocked by quota', async function () {
      UserGetter.promises.getUser.mockResolvedValueOnce({
        agentQuota: {
          outputTokensLimit: 100,
          outputTokensUsed: 100,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })
      await LlmAgentController.sendMessage(makeReq(), makeRes(), vi.fn())

      expect(ChatApiHandler.promises.sendComment).not.toHaveBeenCalled()
      expect(
        AgentConversationManager.promises.ensureConversation
      ).not.toHaveBeenCalled()
      expect(LlmAgentApiHandler.promises.startRun).not.toHaveBeenCalled()
      expect(EditorRealTimeController.emitToRoom).not.toHaveBeenCalled()
    })

    it('queries the user with the agentQuota projection only', async function () {
      await LlmAgentController.sendMessage(makeReq(), makeRes(), vi.fn())
      expect(UserGetter.promises.getUser).toHaveBeenCalledWith(USER_ID, {
        agentQuota: 1,
      })
    })

    it('runs the quota check before any side effects (fails fast)', async function () {
      // Simulate ChatApiHandler crashing. If the quota check ran after
      // sendComment, the test would see the chat error rather than the 402.
      ChatApiHandler.promises.sendComment.mockRejectedValueOnce(
        new Error('chat down')
      )
      UserGetter.promises.getUser.mockResolvedValueOnce({
        agentQuota: {
          outputTokensLimit: 1,
          outputTokensUsed: 5,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(res.statusCode).toBe(402)
    })
  })

  describe('agentComplete + agentCancelled — usage delta', function () {
    it('agentComplete $inc s the user when outputTokensDelta and costUsdDelta are present', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: {
          conversationId: CONVERSATION_ID,
          userId: USER_ID,
          content: 'response from agent',
          runId: RUN_ID,
          outputTokensDelta: 1234,
          costUsdDelta: 0.0042,
        },
      }
      await LlmAgentController.agentComplete(req, makeRes(), vi.fn())

      expect(UserUpdater.promises.updateUser).toHaveBeenCalledOnce()
      expect(UserUpdater.promises.updateUser).toHaveBeenCalledWith(USER_ID, {
        $inc: {
          'agentQuota.outputTokensUsed': 1234,
          'agentQuota.costUsdUsed': 0.0042,
        },
      })
    })

    it('agentComplete skips the $inc when both deltas are zero', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: {
          conversationId: CONVERSATION_ID,
          userId: USER_ID,
          content: 'response',
          runId: RUN_ID,
          outputTokensDelta: 0,
          costUsdDelta: 0,
        },
      }
      await LlmAgentController.agentComplete(req, makeRes(), vi.fn())
      expect(UserUpdater.promises.updateUser).not.toHaveBeenCalled()
    })

    it('agentComplete skips the $inc when deltas are absent (older caller)', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: {
          conversationId: CONVERSATION_ID,
          userId: USER_ID,
          content: 'response',
          runId: RUN_ID,
        },
      }
      await LlmAgentController.agentComplete(req, makeRes(), vi.fn())
      expect(UserUpdater.promises.updateUser).not.toHaveBeenCalled()
    })

    it('agentComplete skips the $inc when userId is absent', async function () {
      // messageId path — no userId in the body. Must not $inc anyone.
      const req = {
        params: { project_id: PROJECT_ID },
        body: {
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          outputTokensDelta: 100,
          costUsdDelta: 0.01,
        },
      }
      await LlmAgentController.agentComplete(req, makeRes(), vi.fn())
      expect(UserUpdater.promises.updateUser).not.toHaveBeenCalled()
    })

    it('agentCancelled $inc s the user for partial-run usage', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: {
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          userId: USER_ID,
          outputTokensDelta: 17,
          costUsdDelta: 0.001,
        },
      }
      const res = makeRes()
      await LlmAgentController.agentCancelled(req, res, vi.fn())

      expect(res.statusCode).toBe(204)
      expect(UserUpdater.promises.updateUser).toHaveBeenCalledWith(USER_ID, {
        $inc: {
          'agentQuota.outputTokensUsed': 17,
          'agentQuota.costUsdUsed': 0.001,
        },
      })
      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'agent:cancelled',
        { conversationId: CONVERSATION_ID, runId: RUN_ID }
      )
    })

    it('agentCancelled still 204s and emits when no usage was incurred (cancelled before first step)', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: {
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          userId: USER_ID,
          outputTokensDelta: 0,
          costUsdDelta: 0,
        },
      }
      const res = makeRes()
      await LlmAgentController.agentCancelled(req, res, vi.fn())

      expect(res.statusCode).toBe(204)
      expect(UserUpdater.promises.updateUser).not.toHaveBeenCalled()
      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalled()
    })

    it('agentCancelled still 400s when conversationId or runId are missing', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: { runId: RUN_ID, userId: USER_ID },
      }
      const res = makeRes()
      await LlmAgentController.agentCancelled(req, res, vi.fn())
      expect(res.statusCode).toBe(400)
    })

    it('coerces string-valued deltas (e.g. JSON re-serialised) to numbers', async function () {
      const req = {
        params: { project_id: PROJECT_ID },
        body: {
          conversationId: CONVERSATION_ID,
          userId: USER_ID,
          content: 'r',
          runId: RUN_ID,
          outputTokensDelta: '500',
          costUsdDelta: '0.02',
        },
      }
      await LlmAgentController.agentComplete(req, makeRes(), vi.fn())
      expect(UserUpdater.promises.updateUser).toHaveBeenCalledWith(USER_ID, {
        $inc: {
          'agentQuota.outputTokensUsed': 500,
          'agentQuota.costUsdUsed': 0.02,
        },
      })
    })
  })

  // The reservation tracker lives in module-scope Maps inside
  // LlmAgentController.mjs. vi.resetModules() in the outer beforeEach
  // gives each `it` a fresh import, so reservation state is reset between
  // tests. Within a single `it`, both concurrent calls share the same
  // module instance (this is what makes the race observable).
  describe('sendMessage — concurrent quota reservations (TOCTOU)', function () {
    // ESTIMATE_OUTPUT_TOKENS in the controller — kept in sync here. If
    // that constant ever changes, this number needs to track it.
    const ESTIMATE = 4000

    it('two concurrent sendMessages from the same user with headroom for one — exactly one passes, one 402s', async function () {
      // Limit of exactly one ESTIMATE worth: first reserves it all,
      // second sees zero headroom and is rejected.
      UserGetter.promises.getUser.mockResolvedValue({
        agentQuota: {
          outputTokensLimit: ESTIMATE,
          outputTokensUsed: 0,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })

      const res1 = makeRes()
      const res2 = makeRes()
      await Promise.all([
        LlmAgentController.sendMessage(makeReq(), res1, vi.fn()),
        LlmAgentController.sendMessage(makeReq(), res2, vi.fn()),
      ])

      const statuses = [res1.statusCode, res2.statusCode].sort()
      expect(statuses).toEqual([202, 402])
      const rejected = res1.statusCode === 402 ? res1 : res2
      expect(JSON.parse(rejected.body)).toMatchObject({
        error: 'agent_quota_exceeded',
        reason: 'output_tokens',
      })
      // Only one startRun fired — the other was blocked before
      // touching the llm-agent service.
      expect(LlmAgentApiHandler.promises.startRun).toHaveBeenCalledTimes(1)
    })

    it('concurrent sendMessages from different users do not interfere with each other', async function () {
      UserGetter.promises.getUser.mockResolvedValue({
        agentQuota: {
          outputTokensLimit: ESTIMATE,
          outputTokensUsed: 0,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })
      // Two distinct sessions: reservations are keyed by userId so
      // neither blocks the other.
      SessionManager.getLoggedInUserId
        .mockReturnValueOnce('user-A')
        .mockReturnValueOnce('user-B')

      const res1 = makeRes()
      const res2 = makeRes()
      await Promise.all([
        LlmAgentController.sendMessage(makeReq(), res1, vi.fn()),
        LlmAgentController.sendMessage(makeReq(), res2, vi.fn()),
      ])
      expect(res1.statusCode).toBe(202)
      expect(res2.statusCode).toBe(202)
      expect(LlmAgentApiHandler.promises.startRun).toHaveBeenCalledTimes(2)
    })

    it('with headroom for two ESTIMATEs, two concurrent pass and a third 402s', async function () {
      UserGetter.promises.getUser.mockResolvedValue({
        agentQuota: {
          outputTokensLimit: ESTIMATE * 2,
          outputTokensUsed: 0,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })

      const results = await Promise.all([
        (async () => {
          const r = makeRes()
          await LlmAgentController.sendMessage(makeReq(), r, vi.fn())
          return r.statusCode
        })(),
        (async () => {
          const r = makeRes()
          await LlmAgentController.sendMessage(makeReq(), r, vi.fn())
          return r.statusCode
        })(),
        (async () => {
          const r = makeRes()
          await LlmAgentController.sendMessage(makeReq(), r, vi.fn())
          return r.statusCode
        })(),
      ])
      const sorted = [...results].sort()
      expect(sorted).toEqual([202, 202, 402])
    })

    it('agentComplete releases the reservation so a follow-up send passes', async function () {
      UserGetter.promises.getUser.mockResolvedValue({
        agentQuota: {
          outputTokensLimit: ESTIMATE,
          outputTokensUsed: 0,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })

      const firstRes = makeRes()
      await LlmAgentController.sendMessage(makeReq(), firstRes, vi.fn())
      expect(firstRes.statusCode).toBe(202)

      // Without releasing, the next send would be blocked (cap fully
      // reserved). Confirm that.
      const blockedRes = makeRes()
      await LlmAgentController.sendMessage(makeReq(), blockedRes, vi.fn())
      expect(blockedRes.statusCode).toBe(402)

      // Now fire the agent-complete callback for the first run, which
      // releases its reservation.
      await LlmAgentController.agentComplete(
        {
          params: { project_id: PROJECT_ID },
          body: {
            conversationId: CONVERSATION_ID,
            userId: USER_ID,
            content: 'agent reply',
            runId: RUN_ID,
            outputTokensDelta: 0,
            costUsdDelta: 0,
          },
        },
        makeRes(),
        vi.fn()
      )

      const afterRes = makeRes()
      await LlmAgentController.sendMessage(makeReq(), afterRes, vi.fn())
      expect(afterRes.statusCode).toBe(202)
    })

    it('agentCancelled releases the reservation so a follow-up send passes', async function () {
      UserGetter.promises.getUser.mockResolvedValue({
        agentQuota: {
          outputTokensLimit: ESTIMATE,
          outputTokensUsed: 0,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })

      const firstRes = makeRes()
      await LlmAgentController.sendMessage(makeReq(), firstRes, vi.fn())
      expect(firstRes.statusCode).toBe(202)

      await LlmAgentController.agentCancelled(
        {
          params: { project_id: PROJECT_ID },
          body: {
            conversationId: CONVERSATION_ID,
            runId: RUN_ID,
            userId: USER_ID,
            outputTokensDelta: 0,
            costUsdDelta: 0,
          },
        },
        makeRes(),
        vi.fn()
      )

      const afterRes = makeRes()
      await LlmAgentController.sendMessage(makeReq(), afterRes, vi.fn())
      expect(afterRes.statusCode).toBe(202)
    })

    it('reservation is released when startRun throws (no leak from a failed send)', async function () {
      UserGetter.promises.getUser.mockResolvedValue({
        agentQuota: {
          outputTokensLimit: ESTIMATE,
          outputTokensUsed: 0,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })
      // First call reserves, then explodes inside startRun. The error
      // surfaces via Express's `next(err)` (expressify catches the
      // rejection), so observe it via the mocked next.
      LlmAgentApiHandler.promises.startRun.mockRejectedValueOnce(
        new Error('llm-agent unavailable')
      )

      const next = vi.fn()
      await LlmAgentController.sendMessage(makeReq(), makeRes(), next)
      expect(next).toHaveBeenCalledOnce()
      expect(next.mock.calls[0][0]).toMatchObject({
        message: 'llm-agent unavailable',
      })

      // Reservation must have been released — the next send should
      // pass (it would 402 if the failed send had leaked its 4000-token
      // reservation).
      const afterRes = makeRes()
      await LlmAgentController.sendMessage(makeReq(), afterRes, vi.fn())
      expect(afterRes.statusCode).toBe(202)
    })

    it('reservation is released when project is not found (early 404 path)', async function () {
      UserGetter.promises.getUser.mockResolvedValue({
        agentQuota: {
          outputTokensLimit: ESTIMATE,
          outputTokensUsed: 0,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })
      ProjectGetter.promises.getProject.mockResolvedValueOnce(null)

      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(res.statusCode).toBe(404)

      // Reservation released — follow-up send still passes.
      const afterRes = makeRes()
      await LlmAgentController.sendMessage(makeReq(), afterRes, vi.fn())
      expect(afterRes.statusCode).toBe(202)
    })

    it('reservation tracking imposes no per-user concurrency limit when the cap is unlimited', async function () {
      UserGetter.promises.getUser.mockResolvedValue({
        agentQuota: {
          outputTokensLimit: -1,
          outputTokensUsed: 0,
          costUsdLimit: -1,
          costUsdUsed: 0,
        },
      })

      const results = await Promise.all(
        Array.from({ length: 4 }, () => {
          const r = makeRes()
          return LlmAgentController.sendMessage(makeReq(), r, vi.fn()).then(
            () => r.statusCode
          )
        })
      )
      expect(results).toEqual([202, 202, 202, 202])
    })

    it('concurrent race on cost cap — first reserves, second 402s with reason=cost', async function () {
      // Output unlimited; cost cap headroom for exactly one ESTIMATE
      // worth (~$0.04 in the controller's ESTIMATE_COST_USD).
      UserGetter.promises.getUser.mockResolvedValue({
        agentQuota: {
          outputTokensLimit: -1,
          outputTokensUsed: 0,
          costUsdLimit: 0.04,
          costUsdUsed: 0,
        },
      })

      const res1 = makeRes()
      const res2 = makeRes()
      await Promise.all([
        LlmAgentController.sendMessage(makeReq(), res1, vi.fn()),
        LlmAgentController.sendMessage(makeReq(), res2, vi.fn()),
      ])

      const statuses = [res1.statusCode, res2.statusCode].sort()
      expect(statuses).toEqual([202, 402])
      const rejected = res1.statusCode === 402 ? res1 : res2
      expect(JSON.parse(rejected.body).reason).toBe('cost')
    })
  })

  describe('rollbackToMessage', function () {
    function makeRollbackReq() {
      return {
        params: {
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          message_id: MESSAGE_ID,
        },
        body: {},
        session: {},
      }
    }

    let RestoreManager
    let HistoryManager

    beforeEach(async function () {
      ;({ default: RestoreManager } = await import(
        '../../../../../app/src/Features/History/RestoreManager.mjs'
      ))
      ;({ default: HistoryManager } = await import(
        '../../../../../app/src/Features/History/HistoryManager.mjs'
      ))
      // Default the project to ranges-support-enabled so the pre-check
      // passes and rollback tests can exercise the full path. Tests that
      // need the disabled-state override this with mockResolvedValueOnce.
      // Include name/compiler so the same mock is fine for any sendMessage
      // path exercised inside this describe (buildProjectContext reads
      // those with optional-chaining, but tracking them keeps the mock
      // shape stable across test paths).
      ProjectGetter.promises.getProject.mockResolvedValue({
        _id: PROJECT_ID,
        name: 'Sample Project',
        compiler: 'pdflatex',
        overleaf: { history: { rangesSupportEnabled: true } },
      })
    })

    it('returns 403 when the user is not logged in', async function () {
      SessionManager.getLoggedInUserId.mockReturnValueOnce(null)
      const res = makeRes()
      await LlmAgentController.rollbackToMessage(
        makeRollbackReq(),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(403)
      expect(RestoreManager.promises.revertProject).not.toHaveBeenCalled()
    })

    it('returns 404 when the message is not found / not owned by user', async function () {
      AgentConversationManager.promises.findUserMessage.mockResolvedValueOnce(
        null
      )
      const res = makeRes()
      await LlmAgentController.rollbackToMessage(
        makeRollbackReq(),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(404)
      expect(RestoreManager.promises.revertProject).not.toHaveBeenCalled()
    })

    it('returns 400 when target is not a user message', async function () {
      AgentConversationManager.promises.findUserMessage.mockResolvedValueOnce({
        messageId: MESSAGE_ID,
        role: 'assistant',
        runId: RUN_ID,
        createdAt: new Date(),
        projectVersionBefore: 5,
      })
      const res = makeRes()
      await LlmAgentController.rollbackToMessage(
        makeRollbackReq(),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(400)
      expect(RestoreManager.promises.revertProject).not.toHaveBeenCalled()
    })

    it('returns 400 when projectVersionBefore was not recorded', async function () {
      AgentConversationManager.promises.findUserMessage.mockResolvedValueOnce({
        messageId: MESSAGE_ID,
        role: 'user',
        runId: null,
        createdAt: new Date(),
        projectVersionBefore: null,
      })
      const res = makeRes()
      await LlmAgentController.rollbackToMessage(
        makeRollbackReq(),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).error).toBe('no_recorded_version')
    })

    it('reverts the project, truncates the conversation, and emits the realtime event', async function () {
      const createdAt = new Date('2026-05-24T00:00:00Z')
      AgentConversationManager.promises.findUserMessage.mockResolvedValueOnce({
        messageId: MESSAGE_ID,
        role: 'user',
        runId: null,
        createdAt,
        projectVersionBefore: 42,
      })
      AgentConversationManager.promises.truncateFromMessage.mockResolvedValueOnce(
        [MESSAGE_ID, 'reply-1']
      )

      const res = makeRes()
      await LlmAgentController.rollbackToMessage(
        makeRollbackReq(),
        res,
        vi.fn()
      )

      expect(RestoreManager.promises.revertProject).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        42
      )
      expect(
        AgentConversationManager.promises.truncateFromMessage
      ).toHaveBeenCalledWith(PROJECT_ID, CONVERSATION_ID, createdAt)
      expect(ChatApiHandler.promises.deleteMessage).toHaveBeenCalledTimes(2)
      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'agent:conversation-rolled-back',
        expect.objectContaining({
          conversationId: CONVERSATION_ID,
          rolledBackToMessageId: MESSAGE_ID,
          rolledBackToVersion: 42,
          removedMessageIds: [MESSAGE_ID, 'reply-1'],
        })
      )
      expect(res.statusCode).toBe(200)
    })

    it('returns 400 history_not_supported via the pre-check when rangesSupportEnabled is false', async function () {
      AgentConversationManager.promises.findUserMessage.mockResolvedValueOnce({
        messageId: MESSAGE_ID,
        role: 'user',
        runId: null,
        createdAt: new Date(),
        projectVersionBefore: 9,
      })
      ProjectGetter.promises.getProject.mockResolvedValueOnce({
        _id: PROJECT_ID,
        overleaf: { history: { rangesSupportEnabled: false } },
      })

      const res = makeRes()
      await LlmAgentController.rollbackToMessage(
        makeRollbackReq(),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).error).toBe('history_not_supported')
      // Pre-check short-circuits — we never call revertProject.
      expect(RestoreManager.promises.revertProject).not.toHaveBeenCalled()
      expect(
        AgentConversationManager.promises.truncateFromMessage
      ).not.toHaveBeenCalled()
    })

    it('falls back to mapping history_not_supported from the OError message (rangesSupport flipped off mid-request)', async function () {
      AgentConversationManager.promises.findUserMessage.mockResolvedValueOnce({
        messageId: MESSAGE_ID,
        role: 'user',
        runId: null,
        createdAt: new Date(),
        projectVersionBefore: 9,
      })
      // Pre-check passes (rangesSupportEnabled=true from the describe-level
      // default), but revertProject still rejects with the same OError —
      // simulating an admin toggling the flag off between our pre-check
      // and the revertProject call. The string-match fallback must still
      // map back to the typed error code.
      RestoreManager.promises.revertProject.mockRejectedValueOnce(
        new Error('project does not have ranges support')
      )

      const res = makeRes()
      await LlmAgentController.rollbackToMessage(
        makeRollbackReq(),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).error).toBe('history_not_supported')
      expect(
        AgentConversationManager.promises.truncateFromMessage
      ).not.toHaveBeenCalled()
    })

    it('returns 500 rollback_partial when truncateFromMessage throws after revertProject succeeds', async function () {
      const createdAt = new Date('2026-05-24T00:00:00Z')
      AgentConversationManager.promises.findUserMessage.mockResolvedValueOnce({
        messageId: MESSAGE_ID,
        role: 'user',
        runId: null,
        createdAt,
        projectVersionBefore: 42,
      })
      AgentConversationManager.promises.truncateFromMessage.mockRejectedValueOnce(
        new Error('mongo unavailable')
      )

      const res = makeRes()
      await LlmAgentController.rollbackToMessage(
        makeRollbackReq(),
        res,
        vi.fn()
      )

      // Project files WERE reverted before truncate failed.
      expect(RestoreManager.promises.revertProject).toHaveBeenCalledWith(
        USER_ID,
        PROJECT_ID,
        42
      )
      // Realtime event still emits so other tabs know the project changed,
      // marked partial: true with no removed ids.
      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'agent:conversation-rolled-back',
        expect.objectContaining({
          partial: true,
          removedMessageIds: [],
          rolledBackToVersion: 42,
        })
      )
      // Chat-service cleanup is skipped on the partial path since we don't
      // know which ids would have been pulled.
      expect(ChatApiHandler.promises.deleteMessage).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(500)
      expect(JSON.parse(res.body).error).toBe('rollback_partial')
    })

    it('returns 409 run_in_flight when an agent run is still active', async function () {
      AgentConversationManager.promises.findUserMessage.mockResolvedValueOnce({
        messageId: MESSAGE_ID,
        role: 'user',
        runId: null,
        createdAt: new Date(),
        projectVersionBefore: 9,
      })
      AgentConversationManager.promises.getActiveRunId.mockResolvedValueOnce(
        RUN_ID
      )

      const res = makeRes()
      await LlmAgentController.rollbackToMessage(
        makeRollbackReq(),
        res,
        vi.fn()
      )
      expect(res.statusCode).toBe(409)
      expect(JSON.parse(res.body).error).toBe('run_in_flight')
      expect(RestoreManager.promises.revertProject).not.toHaveBeenCalled()
      expect(
        AgentConversationManager.promises.truncateFromMessage
      ).not.toHaveBeenCalled()
    })

    it('uses the latest endVersion for projectVersionBefore in sendMessage', async function () {
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      expect(HistoryManager.promises.flushProject).toHaveBeenCalledWith(
        PROJECT_ID
      )
      // 100 is the default mocked endVersion above.
      const recordArgs =
        AgentConversationManager.promises.recordMessage.mock.calls[0]
      expect(recordArgs[5]).toBe(100)
    })

    it('records null when history is unavailable', async function () {
      HistoryManager.promises.getLatestHistory.mockRejectedValueOnce(
        new Error('history down')
      )
      const res = makeRes()
      await LlmAgentController.sendMessage(makeReq(), res, vi.fn())
      const recordArgs =
        AgentConversationManager.promises.recordMessage.mock.calls[0]
      expect(recordArgs[5]).toBeNull()
    })
  })
})
