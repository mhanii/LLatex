// @ts-check
import { expect } from 'chai'
import { readFile } from '../../../app/js/tools/read_file.js'
import { fakeResponse, CTX, stubFetch, restoreFetch } from './helpers.js'

describe('readFile', function () {
  afterEach(restoreFetch)

  it('returns numbered lines for the whole file', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['\\documentclass{article}', '\\begin{document}', '\\end{document}'], version: 1 })
    )
    const result = await readFile({ path: 'main.tex' }, CTX)
    expect(result).to.equal(
      '1: \\documentclass{article}\n2: \\begin{document}\n3: \\end{document}'
    )
  })

  it('slices with fromLine', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['a', 'b', 'c', 'd'], version: 1 })
    )
    const result = await readFile({ path: 'main.tex', fromLine: 2 }, CTX)
    expect(result).to.equal('3: c\n4: d')
  })

  it('slices with toLine', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['a', 'b', 'c', 'd'], version: 1 })
    )
    const result = await readFile({ path: 'main.tex', toLine: 1 }, CTX)
    expect(result).to.equal('1: a\n2: b')
  })

  it('slices with fromLine and toLine', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['a', 'b', 'c', 'd'], version: 1 })
    )
    const result = await readFile({ path: 'main.tex', fromLine: 1, toLine: 2 }, CTX)
    expect(result).to.equal('2: b\n3: c')
  })

  it('returns an error string on 404', async function () {
    stubFetch(async () => fakeResponse(404))
    const result = await readFile({ path: 'main.tex' }, CTX)
    expect(result).to.include('not loaded yet')
    expect(result).to.not.throw
  })

  it('returns an error string on non-404 HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const result = await readFile({ path: 'main.tex' }, CTX)
    expect(result).to.include('500')
  })

  it('calls document-updater peek endpoint with correct projectId and docId', async function () {
    let capturedUrl
    stubFetch(async url => {
      capturedUrl = url
      return fakeResponse(200, { lines: [], version: 1 })
    })
    await readFile({ path: 'main.tex' }, CTX)
    expect(capturedUrl).to.include('/project/proj123/doc/doc111/peek')
  })

  it('throws when path is not in context files', async function () {
    let called = false
    stubFetch(async () => { called = true; return fakeResponse(200, { lines: [], version: 1 }) })
    let err
    try {
      await readFile({ path: 'missing.tex' }, CTX)
    } catch (e) {
      err = e
    }
    expect(err).to.be.an('error')
    expect(err.message).to.include('missing.tex')
    expect(called).to.be.false
  })
})
