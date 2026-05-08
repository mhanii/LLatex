// @ts-check
import { expect } from 'chai'
import { renderContextItems } from '../../../app/js/context/render.js'

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

function item(partial) {
  return {
    id: partial.id ?? 'id',
    addedAt: new Date(),
    addedBy: 'test',
    ...partial,
  }
}

describe('context/render', function () {
  afterEach(restoreFetch)

  it('emits a system message for system_prompt', async function () {
    const messages = await renderContextItems(
      [
        item({
          kind: 'system_prompt',
          role: 'system',
          source: { kind: 'agent', ref: 'default' },
          content: 'be helpful',
        }),
      ],
      { projectId: 'p1' }
    )
    expect(messages).to.deep.equal([
      { role: 'system', content: 'be helpful' },
    ])
  })

  it('fetches current_file content fresh from docUpdater on every render', async function () {
    let calls = 0
    stubFetch(async (url, opts) => {
      calls++
      expect(String(url)).to.match(/\/project\/p1\/doc\/doc-x\/peek$/)
      expect(opts.signal).to.be.instanceOf(AbortSignal)
      return fakeResponse(200, { lines: ['line1', 'line2'] })
    })
    const items = [
      item({
        kind: 'current_file',
        role: 'user',
        source: { kind: 'file', ref: 'main.tex' },
        content: null,
        ref: { path: 'main.tex', docId: 'doc-x' },
      }),
    ]
    const messages = await renderContextItems(items, { projectId: 'p1' })
    expect(calls).to.equal(1)
    expect(messages).to.have.lengthOf(1)
    expect(messages[0].role).to.equal('user')
    expect(messages[0].content).to.match(/<file path="main.tex">/)
    expect(messages[0].content).to.contain('line1\nline2')

    await renderContextItems(items, { projectId: 'p1' })
    expect(calls).to.equal(2) // refetched, no caching
  })

  it('renders selection with its path and line range', async function () {
    const messages = await renderContextItems(
      [
        item({
          kind: 'selection',
          role: 'user',
          source: { kind: 'selection', ref: 'doc1' },
          content: {
            text: 'hello world',
            path: 'main.tex',
            fromLine: 3,
            toLine: 4,
          },
        }),
      ],
      { projectId: 'p1' }
    )
    expect(messages[0].role).to.equal('user')
    expect(messages[0].content).to.contain('path="main.tex"')
    expect(messages[0].content).to.contain('lines="3-4"')
    expect(messages[0].content).to.contain('hello world')
  })

  it('chat_history_message uses its role field', async function () {
    const messages = await renderContextItems(
      [
        item({
          kind: 'chat_history_message',
          role: 'user',
          source: { kind: 'chat', ref: 'm1' },
          content: 'hi from user',
        }),
        item({
          kind: 'chat_history_message',
          role: 'assistant',
          source: { kind: 'chat', ref: 'm2' },
          content: 'hi from agent',
        }),
      ],
      { projectId: 'p1' }
    )
    expect(messages[0]).to.deep.equal({ role: 'user', content: 'hi from user' })
    expect(messages[1]).to.deep.equal({
      role: 'assistant',
      content: 'hi from agent',
    })
  })

  it('renders tool_call as an assistant message with one tool-call part', async function () {
    const messages = await renderContextItems(
      [
        item({
          kind: 'tool_call',
          role: 'assistant',
          source: { kind: 'tool', ref: 'list_files' },
          content: { toolCallId: 'tc1', name: 'list_files', args: {} },
          meta: { toolCallId: 'tc1', stepIndex: 0 },
        }),
      ],
      { projectId: 'p1' }
    )
    expect(messages).to.have.lengthOf(1)
    expect(messages[0].role).to.equal('assistant')
    expect(messages[0].content).to.deep.equal([
      {
        type: 'tool-call',
        toolCallId: 'tc1',
        toolName: 'list_files',
        input: {},
      },
    ])
  })

  it('groups consecutive tool_call items from the same step into ONE assistant message', async function () {
    const messages = await renderContextItems(
      [
        item({
          kind: 'tool_call',
          role: 'assistant',
          source: { kind: 'tool', ref: 'read_file' },
          content: { toolCallId: 'a', name: 'read_file', args: { path: 'a' } },
          meta: { toolCallId: 'a', stepIndex: 1 },
        }),
        item({
          kind: 'tool_call',
          role: 'assistant',
          source: { kind: 'tool', ref: 'read_file' },
          content: { toolCallId: 'b', name: 'read_file', args: { path: 'b' } },
          meta: { toolCallId: 'b', stepIndex: 1 },
        }),
      ],
      { projectId: 'p1' }
    )
    expect(messages).to.have.lengthOf(1)
    expect(messages[0].role).to.equal('assistant')
    expect(messages[0].content).to.have.lengthOf(2)
    expect(messages[0].content[0].toolCallId).to.equal('a')
    expect(messages[0].content[1].toolCallId).to.equal('b')
  })

  it('does NOT group tool_call items from different steps', async function () {
    const messages = await renderContextItems(
      [
        item({
          kind: 'tool_call',
          role: 'assistant',
          source: { kind: 'tool', ref: 'list_files' },
          content: { toolCallId: 'a', name: 'list_files', args: {} },
          meta: { toolCallId: 'a', stepIndex: 0 },
        }),
        item({
          kind: 'tool_output',
          role: 'tool',
          source: { kind: 'tool', ref: 'list_files' },
          content: [],
          meta: { toolCallId: 'a', stepIndex: 0 },
        }),
        item({
          kind: 'tool_call',
          role: 'assistant',
          source: { kind: 'tool', ref: 'read_file' },
          content: { toolCallId: 'b', name: 'read_file', args: {} },
          meta: { toolCallId: 'b', stepIndex: 1 },
        }),
      ],
      { projectId: 'p1' }
    )
    expect(messages).to.have.lengthOf(3)
    expect(messages[0].role).to.equal('assistant') // step 0 tool_call
    expect(messages[1].role).to.equal('tool')      // step 0 tool_output
    expect(messages[2].role).to.equal('assistant') // step 1 tool_call (NOT merged)
  })

  it('renders tool_output as a tool message with one tool-result part', async function () {
    const messages = await renderContextItems(
      [
        item({
          kind: 'tool_output',
          role: 'tool',
          source: { kind: 'tool', ref: 'list_files' },
          content: [{ path: 'main.tex' }],
          meta: { toolCallId: 'tc1', stepIndex: 0 },
        }),
      ],
      { projectId: 'p1' }
    )
    expect(messages).to.have.lengthOf(1)
    expect(messages[0].role).to.equal('tool')
    expect(messages[0].content).to.deep.equal([
      {
        type: 'tool-result',
        toolCallId: 'tc1',
        toolName: 'list_files',
        output: { type: 'json', value: [{ path: 'main.tex' }] },
      },
    ])
  })

  it('preserves item order across mixed kinds', async function () {
    stubFetch(async () => fakeResponse(200, { lines: ['x'] }))
    const messages = await renderContextItems(
      [
        item({
          kind: 'system_prompt',
          role: 'system',
          source: { kind: 'agent', ref: 'default' },
          content: 'sys',
        }),
        item({
          kind: 'current_file',
          role: 'user',
          source: { kind: 'file', ref: 'a.tex' },
          content: null,
          ref: { path: 'a.tex', docId: 'd1' },
        }),
        item({
          kind: 'user_message',
          role: 'user',
          source: { kind: 'user', ref: 'u1' },
          content: 'hello',
        }),
      ],
      { projectId: 'p1' }
    )
    expect(messages.map(m => m.role)).to.deep.equal([
      'system',
      'user',
      'user',
    ])
    expect(messages[2].content).to.equal('hello')
  })
})
