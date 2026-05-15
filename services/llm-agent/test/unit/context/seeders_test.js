// @ts-check
import { expect } from 'chai'
import {
  seedSystemPrompt,
  seedChatHistory,
  seedCurrentFile,
  seedSelection,
  seedUserMessage,
} from '../../../app/js/context/seeders.js'

let savedFetch
function stubFetch(handler) {
  savedFetch = globalThis.fetch
  globalThis.fetch = handler
}
function restoreFetch() {
  if (savedFetch !== undefined) {
    globalThis.fetch = savedFetch
    savedFetch = undefined
  }
}

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

const FAKE_AGENT = {
  name: 'default',
  description: 'd',
  systemPrompt: 'be helpful',
  allowedTools: [],
}

const BASE_INPUT = {
  projectId: 'p1',
  userId: 'u1',
  conversationId: '507f1f77bcf86cd799439011',
  userMessage: 'hi',
  context: {
    projectName: 'P',
    compiler: 'pdflatex',
    files: [
      { path: 'main.tex', docId: 'docA' },
      { path: 'intro.tex', docId: 'docB' },
    ],
  },
}

describe('context/seeders', function () {
  afterEach(restoreFetch)

  describe('seedSystemPrompt', function () {
    it('returns one system_prompt item with the agent name as source ref', function () {
      const items = seedSystemPrompt(FAKE_AGENT)
      expect(items).to.have.lengthOf(1)
      expect(items[0]).to.deep.include({
        kind: 'system_prompt',
        role: 'system',
        content: 'be helpful',
        addedBy: 'seed:system_prompt',
      })
      expect(items[0].source).to.deep.equal({
        kind: 'agent',
        ref: 'default',
      })
    })
  })

  describe('seedChatHistory (legacy fetch fallback)', function () {
    it('returns [] when chat service errors', async function () {
      stubFetch(async () => {
        throw new Error('boom')
      })
      const items = await seedChatHistory(BASE_INPUT)
      expect(items).to.deep.equal([])
    })

    it('returns [] when thread does not exist (404)', async function () {
      stubFetch(async () => fakeResponse(404, null))
      const items = await seedChatHistory(BASE_INPUT)
      expect(items).to.deep.equal([])
    })

    it('maps every fetched message as user (fallback cannot detect roles)', async function () {
      stubFetch(async url => {
        expect(String(url)).to.contain(
          '/project/p1/thread/507f1f77bcf86cd799439011'
        )
        return fakeResponse(200, {
          messages: [
            { id: 'm1', content: 'hi', timestamp: 1, user_id: 'u1' },
            { id: 'm2', content: 'reply', timestamp: 2, user_id: 'agent' },
          ],
        })
      })
      const items = await seedChatHistory(BASE_INPUT)
      expect(items).to.have.lengthOf(2)
      expect(items[0]).to.include({ role: 'user', content: 'hi' })
      expect(items[1]).to.include({ role: 'user', content: 'reply' })
    })
  })

  describe('seedChatHistory (with chatHistory input)', function () {
    it('emits user + assistant messages with correct roles', async function () {
      const input = {
        ...BASE_INPUT,
        chatHistory: [
          {
            id: 'm1',
            user_id: 'u1',
            content: 'first user msg',
            timestamp: 1,
            role: 'user',
            runId: null,
          },
          {
            id: 'm2',
            user_id: 'u1',
            content: 'first assistant reply',
            timestamp: 2,
            role: 'assistant',
            runId: null,
          },
        ],
      }
      const items = await seedChatHistory(input, {
        getStepsForRun: async () => [],
      })
      expect(items).to.have.lengthOf(2)
      expect(items[0]).to.include({ role: 'user', content: 'first user msg' })
      expect(items[1]).to.include({
        role: 'assistant',
        content: 'first assistant reply',
      })
    })

    it('replays prior assistant turn tool calls, outputs, and reasoning from agentRuns', async function () {
      const runId = '64aaaaaaaaaaaaaaaaaaaaaa'
      const fakeSteps = [
        {
          output: {
            reasoning: [{ text: 'thinking out loud', providerMetadata: null }],
            toolCalls: [
              { toolCallId: 'tc1', toolName: 'readFile', input: { path: 'a.tex' } },
            ],
            toolResults: [
              { toolCallId: 'tc1', toolName: 'readFile', output: 'contents' },
            ],
            text: '',
          },
        },
        {
          output: {
            reasoning: [],
            toolCalls: [],
            toolResults: [],
            text: 'final assistant text',
          },
        },
      ]
      const input = {
        ...BASE_INPUT,
        chatHistory: [
          {
            id: 'm1',
            user_id: 'u1',
            content: 'help me',
            timestamp: 1,
            role: 'user',
            runId: null,
          },
          {
            id: 'm2',
            user_id: 'u1',
            content: 'final assistant text',
            timestamp: 2,
            role: 'assistant',
            runId,
          },
        ],
      }
      const items = await seedChatHistory(input, {
        getStepsForRun: async id => (id === runId ? fakeSteps : []),
      })
      const kinds = items.map(i => i.kind)
      // user msg, reasoning, tool_call, tool_output, (step 2 had no calls/reasoning), assistant chat msg
      expect(kinds).to.deep.equal([
        'chat_history_message',
        'reasoning',
        'tool_call',
        'tool_output',
        'chat_history_message',
      ])
      const reasoningItem = items[1]
      expect(reasoningItem).to.include({ role: 'assistant', content: 'thinking out loud' })
      const toolCallItem = items[2]
      expect(toolCallItem.meta.toolCallId).to.equal('tc1')
      // Reasoning and tool_call share the same stepIndex so render merges them
      expect(reasoningItem.meta.stepIndex).to.equal(toolCallItem.meta.stepIndex)
      const toolOutputItem = items[3]
      expect(toolOutputItem.meta.toolCallId).to.equal('tc1')
      expect(toolOutputItem.content).to.equal('contents')
    })

    it('synthesizes a placeholder tool_output for unpaired tool_calls', async function () {
      const runId = '64bbbbbbbbbbbbbbbbbbbbbb'
      const fakeSteps = [
        {
          output: {
            reasoning: [],
            toolCalls: [
              { toolCallId: 'tc-orphan', toolName: 'compile', input: {} },
            ],
            toolResults: [],
            text: 'recovered',
          },
        },
      ]
      const input = {
        ...BASE_INPUT,
        chatHistory: [
          {
            id: 'm1',
            user_id: 'u1',
            content: 'recovered',
            timestamp: 1,
            role: 'assistant',
            runId,
          },
        ],
      }
      const items = await seedChatHistory(input, {
        getStepsForRun: async () => fakeSteps,
      })
      const synth = items.find(
        i => i.kind === 'tool_output' && i.meta?.synthesized === true
      )
      expect(synth).to.exist
      expect(synth.meta.toolCallId).to.equal('tc-orphan')
    })
  })

  describe('seedCurrentFile', function () {
    it('returns nothing when there is no selection and no currentFile', function () {
      expect(seedCurrentFile(BASE_INPUT)).to.deep.equal([])
    })

    it('uses selection.docId and resolves path from context.files', function () {
      const items = seedCurrentFile({
        ...BASE_INPUT,
        selection: { docId: 'docB', fromLine: 0, toLine: 0 },
      })
      expect(items).to.have.lengthOf(1)
      expect(items[0]).to.deep.include({
        kind: 'current_file',
        role: 'user',
        content: null,
        addedBy: 'seed:current_file',
      })
      expect(items[0].ref).to.deep.equal({
        path: 'intro.tex',
        docId: 'docB',
      })
    })

    it('falls back to input.currentFile when no selection.docId', function () {
      const items = seedCurrentFile({
        ...BASE_INPUT,
        currentFile: { path: 'foo.tex', docId: 'docZ' },
      })
      expect(items[0].ref).to.deep.equal({
        path: 'foo.tex',
        docId: 'docZ',
      })
    })
  })

  describe('seedSelection', function () {
    it('returns nothing when selection has no content', function () {
      expect(
        seedSelection({
          ...BASE_INPUT,
          selection: { docId: 'docA' },
        })
      ).to.deep.equal([])
    })

    it('emits a selection item with text + path + line range', function () {
      const items = seedSelection({
        ...BASE_INPUT,
        selection: {
          docId: 'docA',
          fromLine: 5,
          toLine: 7,
          content: 'snippet',
        },
      })
      expect(items).to.have.lengthOf(1)
      expect(items[0].kind).to.equal('selection')
      expect(items[0].content).to.deep.equal({
        text: 'snippet',
        path: 'main.tex',
        fromLine: 5,
        toLine: 7,
      })
    })
  })

  describe('seedUserMessage', function () {
    it('returns one user_message item', function () {
      const items = seedUserMessage(BASE_INPUT)
      expect(items).to.have.lengthOf(1)
      expect(items[0]).to.deep.include({
        kind: 'user_message',
        role: 'user',
        content: 'hi',
        addedBy: 'seed:user_message',
      })
    })

    it('returns nothing when userMessage is empty', function () {
      expect(
        seedUserMessage({ ...BASE_INPUT, userMessage: '' })
      ).to.deep.equal([])
    })
  })
})
