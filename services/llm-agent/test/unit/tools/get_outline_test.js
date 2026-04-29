// @ts-check
import { expect } from 'chai'
import { getOutline } from '../../../app/js/tools/get_outline.js'
import { fakeResponse, CTX, stubFetch, restoreFetch } from './helpers.js'

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
    const result = await getOutline({ path: 'main.tex' }, CTX)
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
    const result = await getOutline({ path: 'main.tex' }, CTX)
    expect(result).to.deep.equal([])
  })

  it('returns error string on 404', async function () {
    stubFetch(async () => fakeResponse(404))
    const result = await getOutline({ path: 'main.tex' }, CTX)
    expect(result).to.include('not loaded yet')
  })

  it('returns error string on non-404 HTTP error', async function () {
    stubFetch(async () => fakeResponse(503))
    const result = await getOutline({ path: 'main.tex' }, CTX)
    expect(result).to.include('503')
  })

  it('calls the peek endpoint with correct ids', async function () {
    let capturedUrl
    stubFetch(async url => {
      capturedUrl = url
      return fakeResponse(200, { lines: [], version: 1 })
    })
    await getOutline({ path: 'chapters/intro.tex' }, CTX)
    expect(capturedUrl).to.include('/project/proj123/doc/doc222/peek')
  })

  it('throws for unknown path', async function () {
    stubFetch(async () => fakeResponse(200, { lines: [], version: 1 }))
    let err
    try { await getOutline({ path: 'nope.tex' }, CTX) } catch (e) { err = e }
    expect(err).to.be.an('error')
    expect(err.message).to.include('nope.tex')
  })
})
