// @ts-check
import { expect } from 'chai'
import { buildTools } from '../../../app/js/tools/index.js'
import { fakeResponse, restoreFetch, stubFetch } from './helpers.js'

function makeCtx() {
  return {
    projectId: 'proj1',
    userId: 'user1',
    runId: 'run1',
    context: {
      projectName: 'Test',
      compiler: 'pdflatex',
      files: [
        { path: 'main.tex', docId: 'd1' },
        { path: 'refs.bib', docId: 'd2' },
      ],
    },
  }
}

describe('tools/index buildTools', function () {
  afterEach(restoreFetch)

  it('returns all 12 tools when toolNames is omitted', function () {
    const tools = buildTools(makeCtx())
    expect(Object.keys(tools)).to.have.lengthOf(12)
    expect(tools).to.have.all.keys(
      'list_files',
      'read_file',
      'create_file',
      'edit_file',
      'delete_file',
      'move_file',
      'get_outline',
      'check_syntax',
      'compile_and_check',
      'get_pdf_page',
      'list_skills',
      'read_skill'
    )
  })

  it('returns only the requested tools when toolNames is provided', function () {
    const tools = buildTools(makeCtx(), ['list_files', 'read_file'])
    expect(Object.keys(tools)).to.deep.equal(['list_files', 'read_file'])
  })

  it('returns an empty object when toolNames is empty', function () {
    expect(buildTools(makeCtx(), [])).to.deep.equal({})
  })

  it('throws on unknown tool names', function () {
    expect(() => buildTools(makeCtx(), ['nonexistent_tool'])).to.throw(
      /Unknown tool: nonexistent_tool/
    )
  })

  it('throws on a partially-unknown list (does not silently skip)', function () {
    expect(() => buildTools(makeCtx(), ['list_files', 'nonexistent'])).to.throw(
      /Unknown tool: nonexistent/
    )
  })

  it('each wrapped tool exposes description and inputSchema', function () {
    const tools = buildTools(makeCtx(), ['read_file'])
    expect(tools.read_file).to.have.property('description').that.is.a('string')
    expect(tools.read_file).to.have.property('inputSchema')
  })

  it('curries ctx into execute (list_files reads ctx.context.files)', async function () {
    const tools = buildTools(makeCtx(), ['list_files'])
    const result = await tools.list_files.execute({}, {})
    expect(result).to.deep.equal([{ path: 'main.tex' }, { path: 'refs.bib' }])
  })

  it('different ctx objects produce different bindings (no shared state)', async function () {
    const ctxA = { ...makeCtx(), context: { ...makeCtx().context, files: [{ path: 'a.tex', docId: 'a' }] } }
    const ctxB = { ...makeCtx(), context: { ...makeCtx().context, files: [{ path: 'b.tex', docId: 'b' }] } }
    const toolsA = buildTools(ctxA, ['list_files'])
    const toolsB = buildTools(ctxB, ['list_files'])
    const [a, b] = await Promise.all([
      toolsA.list_files.execute({}, {}),
      toolsB.list_files.execute({}, {}),
    ])
    expect(a).to.deep.equal([{ path: 'a.tex' }])
    expect(b).to.deep.equal([{ path: 'b.tex' }])
  })

  it('auto-accepts pending agent changes before the first edit in a follow-up run', async function () {
    const calls = []
    stubFetch(async (url, opts) => {
      calls.push({ url, opts })
      if (!opts?.method) {
        return fakeResponse(200, {
          ranges: {
            changes: [
              {
                id: 'agent-change',
                metadata: { source: 'agent', user_id: 'user1' },
              },
              {
                id: 'user-change',
                metadata: { source: 'user', user_id: 'user1' },
              },
              {
                id: 'other-agent-change',
                metadata: { source: 'agent', user_id: 'other-user' },
              },
            ],
          },
        })
      }
      return fakeResponse(204)
    })

    const ctx = { ...makeCtx(), autoAcceptTrackChangesOnEdit: true }
    const tools = buildTools(ctx, ['edit_file'])
    const result = await tools.edit_file.execute({
      path: 'main.tex',
      oldText: 'old',
      newText: 'new',
    })

    expect(result).to.equal('Change applied.')
    expect(calls[0].url).to.include('/project/proj1/doc/d1')
    expect(calls[1].url).to.include(
      '/internal/project/proj1/agent/accept-changes'
    )
    expect(JSON.parse(calls[1].opts.body)).to.deep.equal({
      docId: 'd1',
      changeIds: ['agent-change'],
      userId: 'user1',
    })
    expect(calls[2].url).to.include('/project/proj1/doc/d1/agent-replace')
  })

  it('does not auto-accept on a first-turn edit run', async function () {
    const calls = []
    stubFetch(async (url, opts) => {
      calls.push({ url, opts })
      return fakeResponse(204)
    })

    const tools = buildTools(makeCtx(), ['edit_file'])
    await tools.edit_file.execute({
      path: 'main.tex',
      oldText: 'old',
      newText: 'new',
    })

    expect(calls).to.have.length(1)
    expect(calls[0].url).to.include('/project/proj1/doc/d1/agent-replace')
  })

  it('only auto-accepts once per doc in the same follow-up run', async function () {
    const calls = []
    stubFetch(async (url, opts) => {
      calls.push({ url, opts })
      if (!opts?.method) {
        return fakeResponse(200, { ranges: { changes: [] } })
      }
      return fakeResponse(204)
    })

    const ctx = { ...makeCtx(), autoAcceptTrackChangesOnEdit: true }
    const tools = buildTools(ctx, ['edit_file'])
    await tools.edit_file.execute({
      path: 'main.tex',
      oldText: 'a',
      newText: 'b',
    })
    await tools.edit_file.execute({
      path: 'main.tex',
      oldText: 'c',
      newText: 'd',
    })

    expect(calls).to.have.length(3)
    expect(calls[0].url).to.include('/project/proj1/doc/d1')
    expect(calls[0].url).not.to.include('/agent-replace')
    expect(calls[1].url).to.include('/project/proj1/doc/d1/agent-replace')
    expect(calls[2].url).to.include('/project/proj1/doc/d1/agent-replace')
  })
})
