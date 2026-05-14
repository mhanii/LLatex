// @ts-check
import { expect } from 'chai'
import { moveFile } from '../../../app/js/tools/move_file.js'
import { fakeResponse, makeCtx, stubFetch, restoreFetch } from './helpers.js'

describe('moveFile', function () {
  afterEach(restoreFetch)

  it('returns "Moved." on success', async function () {
    stubFetch(async () => fakeResponse(204))
    expect(
      await moveFile({ oldPath: 'main.tex', newPath: 'src/main.tex' }, makeCtx())
    ).to.equal('Moved.')
  })

  it('updates the path in ctx.context.files on success', async function () {
    stubFetch(async () => fakeResponse(204))
    const ctx = makeCtx()
    await moveFile({ oldPath: 'main.tex', newPath: 'src/main.tex' }, ctx)
    const entry = ctx.context.files.find(f => f.docId === 'doc111')
    expect(entry).to.exist
    expect(entry.path).to.equal('src/main.tex')
    expect(ctx.context.files.find(f => f.path === 'main.tex')).to.be.undefined
  })

  it('does NOT mutate ctx.context.files on 404', async function () {
    stubFetch(async () => fakeResponse(404))
    const ctx = makeCtx()
    await moveFile({ oldPath: 'main.tex', newPath: 'src/main.tex' }, ctx)
    expect(ctx.context.files.find(f => f.path === 'main.tex')).to.exist
    expect(ctx.context.files.find(f => f.path === 'src/main.tex')).to.be.undefined
  })

  it('does NOT mutate ctx.context.files on HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const ctx = makeCtx()
    await moveFile({ oldPath: 'main.tex', newPath: 'src/main.tex' }, ctx)
    expect(ctx.context.files.find(f => f.path === 'main.tex')).to.exist
  })

  it('returns not-found string on 404', async function () {
    stubFetch(async () => fakeResponse(404))
    const result = await moveFile(
      { oldPath: 'main.tex', newPath: 'src/main.tex' },
      makeCtx()
    )
    expect(result).to.include('not found')
    expect(result).to.include('main.tex')
  })

  it('returns error string on HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const result = await moveFile(
      { oldPath: 'main.tex', newPath: 'src/main.tex' },
      makeCtx()
    )
    expect(result).to.include('500')
  })

  it('posts to move-file endpoint with correct body and auth', async function () {
    let capturedUrl, capturedHeaders, capturedBody
    stubFetch(async (url, opts) => {
      capturedUrl = url
      capturedHeaders = opts.headers
      capturedBody = JSON.parse(opts.body)
      return fakeResponse(204)
    })
    await moveFile({ oldPath: 'main.tex', newPath: 'src/main.tex' }, makeCtx())
    expect(capturedUrl).to.include('/internal/project/proj123/agent/move-file')
    expect(capturedHeaders.Authorization).to.match(/^Basic /)
    expect(capturedBody).to.deep.equal({
      oldPath: 'main.tex',
      newPath: 'src/main.tex',
      userId: 'user123',
    })
  })
})
