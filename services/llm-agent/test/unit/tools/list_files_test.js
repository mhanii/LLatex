// @ts-check
import { expect } from 'chai'
import { listFiles } from '../../../app/js/tools/list_files.js'

const BASE_CTX = {
  projectId: 'proj1',
  userId: 'user1',
  runId: 'run1',
}

describe('listFiles', function () {
  it('returns path for each file in context', async function () {
    const ctx = {
      ...BASE_CTX,
      context: {
        projectName: 'Test',
        compiler: 'pdflatex',
        files: [
          { path: 'main.tex', docId: 'doc1' },
          { path: 'refs.bib', docId: 'doc2' },
        ],
      },
    }
    const result = await listFiles({}, ctx)
    expect(result).to.deep.equal([
      { path: 'main.tex' },
      { path: 'refs.bib' },
    ])
  })

  it('returns empty array when context has no files', async function () {
    const ctx = {
      ...BASE_CTX,
      context: { projectName: 'Test', compiler: 'pdflatex', files: [] },
    }
    expect(await listFiles({}, ctx)).to.deep.equal([])
  })

  it('returns empty array when context is absent', async function () {
    expect(await listFiles({}, { ...BASE_CTX })).to.deep.equal([])
  })
})
