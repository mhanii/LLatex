// @ts-check
import { expect } from 'chai'
import { deleteFile } from '../../../app/js/tools/delete_file.js'
import { fakeResponse, makeCtx, stubFetch, restoreFetch } from './helpers.js'

describe('deleteFile', function () {
  afterEach(restoreFetch)

  it('returns "Deleted." on success', async function () {
    stubFetch(async () => fakeResponse(204))
    expect(await deleteFile({ path: 'main.tex' }, makeCtx())).to.equal('Deleted.')
  })

  it('removes the file from ctx.context.files on success', async function () {
    stubFetch(async () => fakeResponse(204))
    const ctx = makeCtx()
    await deleteFile({ path: 'main.tex' }, ctx)
    expect(ctx.context.files).to.have.lengthOf(1)
    expect(ctx.context.files.find(f => f.path === 'main.tex')).to.be.undefined
  })

  it('does NOT mutate ctx.context.files on 404', async function () {
    stubFetch(async () => fakeResponse(404))
    const ctx = makeCtx()
    await deleteFile({ path: 'main.tex' }, ctx)
    expect(ctx.context.files).to.have.lengthOf(2)
  })

  it('does NOT mutate ctx.context.files on HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const ctx = makeCtx()
    await deleteFile({ path: 'main.tex' }, ctx)
    expect(ctx.context.files).to.have.lengthOf(2)
  })

  it('returns not-found string on 404', async function () {
    stubFetch(async () => fakeResponse(404))
    const result = await deleteFile({ path: 'main.tex' }, makeCtx())
    expect(result).to.include('not found')
    expect(result).to.include('main.tex')
  })

  it('returns error string on HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const result = await deleteFile({ path: 'main.tex' }, makeCtx())
    expect(result).to.include('500')
  })

  it('posts to delete-file endpoint with correct body and auth', async function () {
    let capturedUrl, capturedHeaders, capturedBody
    stubFetch(async (url, opts) => {
      capturedUrl = url
      capturedHeaders = opts.headers
      capturedBody = JSON.parse(opts.body)
      return fakeResponse(204)
    })
    await deleteFile({ path: 'main.tex' }, makeCtx())
    expect(capturedUrl).to.include('/internal/project/proj123/agent/delete-file')
    expect(capturedHeaders.Authorization).to.match(/^Basic /)
    expect(capturedBody).to.deep.equal({ path: 'main.tex', userId: 'user123' })
  })
})
