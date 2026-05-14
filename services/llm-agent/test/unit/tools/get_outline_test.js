// @ts-check
import { expect } from 'chai'
import { getOutline } from '../../../app/js/tools/get_outline.js'
import { fakeResponse, makeCtx, stubFetch, restoreFetch } from './helpers.js'

const SAMPLE_LINES = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Introduction}',
  'Some text.',
  '\\subsection{Background}',
  'More text.',
  '\\subsubsection{Details}',
  '\\section*{Conclusion}',
  '\\end{document}',
]

describe('getOutline', function () {
  afterEach(restoreFetch)

  it('returns structured outline with type, title, lineNumber', async function () {
    stubFetch(async () => fakeResponse(200, { lines: SAMPLE_LINES, version: 1 }))
    const result = await getOutline({ path: 'main.tex' }, makeCtx())
    expect(result).to.deep.equal([
      { type: 'begin:document', title: 'document',     lineNumber: 2 },
      { type: 'section',        title: 'Introduction', lineNumber: 3 },
      { type: 'subsection',     title: 'Background',   lineNumber: 5 },
      { type: 'subsubsection',  title: 'Details',      lineNumber: 7 },
      { type: 'section',        title: 'Conclusion',   lineNumber: 8 },
    ])
  })

  it('returns empty array when no headings found', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['plain text', 'no sections here'], version: 1 })
    )
    const result = await getOutline({ path: 'main.tex' }, makeCtx())
    expect(result).to.deep.equal([])
  })

  it('returns error string on non-404 HTTP error', async function () {
    stubFetch(async () => fakeResponse(503))
    const result = await getOutline({ path: 'main.tex' }, makeCtx())
    expect(result).to.include('503')
  })

  it('hits /peek first (Redis-only) when the doc is hot', async function () {
    const calls = []
    stubFetch(async url => {
      calls.push(url)
      return fakeResponse(200, { lines: [], version: 1 })
    })
    await getOutline({ path: 'chapters/intro.tex' }, makeCtx())
    expect(calls).to.have.lengthOf(1)
    expect(calls[0]).to.include('/project/proj123/doc/doc222/peek')
  })

  it('falls back to the loading endpoint when /peek returns 404 (cold doc)', async function () {
    const calls = []
    stubFetch(async url => {
      calls.push(url)
      if (url.includes('/peek')) return fakeResponse(404)
      return fakeResponse(200, { lines: ['\\section{Hi}'], version: 0 })
    })
    const result = await getOutline({ path: 'chapters/intro.tex' }, makeCtx())
    expect(calls).to.have.lengthOf(2)
    expect(calls[0]).to.include('/peek')
    expect(calls[1]).to.match(/\/project\/proj123\/doc\/doc222$/)
    expect(result).to.deep.equal([
      { type: 'section', title: 'Hi', lineNumber: 1 },
    ])
  })

  it('returns "not found in project storage" when both /peek and getDoc return 404', async function () {
    stubFetch(async () => fakeResponse(404))
    const result = await getOutline({ path: 'main.tex' }, makeCtx())
    expect(result).to.include('not found in project storage')
  })

  it('returns an error string (not throw) for unknown path', async function () {
    let called = false
    stubFetch(async () => { called = true; return fakeResponse(200, { lines: [], version: 1 }) })
    const result = await getOutline({ path: 'nope.tex' }, makeCtx())
    expect(result).to.be.a('string')
    expect(result).to.include('nope.tex')
    expect(result).to.include('list_files')
    expect(called).to.be.false
  })
})
