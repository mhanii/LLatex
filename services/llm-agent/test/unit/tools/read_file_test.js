// @ts-check
import { expect } from 'chai'
import { readFile } from '../../../app/js/tools/read_file.js'
import { fakeResponse, makeCtx, stubFetch, restoreFetch } from './helpers.js'

describe('readFile', function () {
  afterEach(restoreFetch)

  it('returns numbered lines for the whole file', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['\\documentclass{article}', '\\begin{document}', '\\end{document}'], version: 1 })
    )
    const result = await readFile({ path: 'main.tex' }, makeCtx())
    expect(result).to.equal(
      '1: \\documentclass{article}\n2: \\begin{document}\n3: \\end{document}'
    )
  })

  it('slices with fromLine (1-indexed)', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['a', 'b', 'c', 'd'], version: 1 })
    )
    const result = await readFile({ path: 'main.tex', fromLine: 2 }, makeCtx())
    expect(result).to.equal('2: b\n3: c\n4: d')
  })

  it('slices with toLine (1-indexed)', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['a', 'b', 'c', 'd'], version: 1 })
    )
    const result = await readFile({ path: 'main.tex', toLine: 1 }, makeCtx())
    expect(result).to.equal('1: a')
  })

  it('slices with fromLine and toLine (1-indexed)', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['a', 'b', 'c', 'd'], version: 1 })
    )
    const result = await readFile({ path: 'main.tex', fromLine: 1, toLine: 2 }, makeCtx())
    expect(result).to.equal('1: a\n2: b')
  })

  it('returns an error string for invalid line ranges', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['a', 'b'], version: 1 })
    )
    const result = await readFile({ path: 'main.tex', fromLine: 0 }, makeCtx())
    expect(result).to.include('Invalid line range')
  })

  it('returns an error string when toLine < fromLine', async function () {
    stubFetch(async () =>
      fakeResponse(200, { lines: ['a', 'b'], version: 1 })
    )
    const result = await readFile({ path: 'main.tex', fromLine: 2, toLine: 1 }, makeCtx())
    expect(result).to.include('toLine must be greater than or equal')
  })

  it('returns an error string on non-404 HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const result = await readFile({ path: 'main.tex' }, makeCtx())
    expect(result).to.include('500')
  })

  it('hits /peek first (Redis-only, lock-free) when the doc is hot', async function () {
    const calls = []
    stubFetch(async url => {
      calls.push(url)
      return fakeResponse(200, { lines: ['hot'], version: 1 })
    })
    await readFile({ path: 'main.tex' }, makeCtx())
    expect(calls).to.have.lengthOf(1)
    expect(calls[0]).to.include('/project/proj123/doc/doc111/peek')
  })

  it('falls back to the loading endpoint when /peek returns 404 (cold doc)', async function () {
    const calls = []
    stubFetch(async url => {
      calls.push(url)
      if (url.includes('/peek')) return fakeResponse(404)
      return fakeResponse(200, { lines: ['cold'], version: 0 })
    })
    const result = await readFile({ path: 'main.tex' }, makeCtx())
    expect(calls).to.have.lengthOf(2)
    expect(calls[0]).to.include('/peek')
    expect(calls[1]).to.match(/\/project\/proj123\/doc\/doc111$/)
    expect(result).to.include('cold')
  })

  it('returns "not found in project storage" when both /peek and getDoc return 404', async function () {
    stubFetch(async () => fakeResponse(404))
    const result = await readFile({ path: 'main.tex' }, makeCtx())
    expect(result).to.include('not found in project storage')
  })

  it('returns an error string (not throw) when path is not in context files', async function () {
    let called = false
    stubFetch(async () => { called = true; return fakeResponse(200, { lines: [], version: 1 }) })
    const result = await readFile({ path: 'missing.tex' }, makeCtx())
    expect(result).to.be.a('string')
    expect(result).to.include('missing.tex')
    expect(result).to.include('list_files')
    expect(called).to.be.false
  })
})
