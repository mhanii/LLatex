// @ts-check
import { expect } from 'chai'
import { buildTools } from '../../../app/js/tools/index.js'

const CTX = {
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

describe('tools/index buildTools', function () {
  it('returns all 12 tools when toolNames is omitted', function () {
    const tools = buildTools(CTX)
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
    const tools = buildTools(CTX, ['list_files', 'read_file'])
    expect(Object.keys(tools)).to.deep.equal(['list_files', 'read_file'])
  })

  it('returns an empty object when toolNames is empty', function () {
    expect(buildTools(CTX, [])).to.deep.equal({})
  })

  it('throws on unknown tool names', function () {
    expect(() => buildTools(CTX, ['nonexistent_tool'])).to.throw(
      /Unknown tool: nonexistent_tool/
    )
  })

  it('throws on a partially-unknown list (does not silently skip)', function () {
    expect(() => buildTools(CTX, ['list_files', 'nonexistent'])).to.throw(
      /Unknown tool: nonexistent/
    )
  })

  it('each wrapped tool exposes description and inputSchema', function () {
    const tools = buildTools(CTX, ['read_file'])
    expect(tools.read_file).to.have.property('description').that.is.a('string')
    expect(tools.read_file).to.have.property('inputSchema')
  })

  it('curries ctx into execute (list_files reads ctx.context.files)', async function () {
    const tools = buildTools(CTX, ['list_files'])
    const result = await tools.list_files.execute({}, {})
    expect(result).to.deep.equal([{ path: 'main.tex' }, { path: 'refs.bib' }])
  })

  it('different ctx objects produce different bindings (no shared state)', async function () {
    const ctxA = { ...CTX, context: { ...CTX.context, files: [{ path: 'a.tex', docId: 'a' }] } }
    const ctxB = { ...CTX, context: { ...CTX.context, files: [{ path: 'b.tex', docId: 'b' }] } }
    const toolsA = buildTools(ctxA, ['list_files'])
    const toolsB = buildTools(ctxB, ['list_files'])
    const [a, b] = await Promise.all([
      toolsA.list_files.execute({}, {}),
      toolsB.list_files.execute({}, {}),
    ])
    expect(a).to.deep.equal([{ path: 'a.tex' }])
    expect(b).to.deep.equal([{ path: 'b.tex' }])
  })
})
