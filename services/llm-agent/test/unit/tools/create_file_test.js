// @ts-check
import { expect } from 'chai'
import { createFile } from '../../../app/js/tools/create_file.js'
import { fakeResponse, makeCtx, stubFetch, restoreFetch } from './helpers.js'

describe('createFile', function () {
  afterEach(restoreFetch)

  it('returns {path, docId} on success', async function () {
    stubFetch(async () =>
      fakeResponse(201, { path: 'new.tex', docId: 'doc999' })
    )
    const result = await createFile({ path: 'new.tex', content: '\\hello' }, makeCtx())
    expect(result).to.deep.equal({ path: 'new.tex', docId: 'doc999' })
  })

  it('appends the new file to ctx.context.files on success', async function () {
    stubFetch(async () =>
      fakeResponse(201, { path: 'figures/new.tex', docId: 'doc999' })
    )
    const ctx = makeCtx()
    await createFile({ path: 'figures/new.tex', content: '' }, ctx)
    expect(ctx.context.files).to.deep.include({
      path: 'figures/new.tex',
      docId: 'doc999',
    })
    expect(ctx.context.files).to.have.lengthOf(3)
  })

  it('does NOT mutate ctx.context.files on HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const ctx = makeCtx()
    await createFile({ path: 'broken.tex' }, ctx)
    expect(ctx.context.files).to.have.lengthOf(2)
    expect(ctx.context.files.find(f => f.path === 'broken.tex')).to.be.undefined
  })

  it('posts with Basic auth and correct body', async function () {
    let capturedUrl, capturedHeaders, capturedBody
    stubFetch(async (url, opts) => {
      capturedUrl = url
      capturedHeaders = opts.headers
      capturedBody = JSON.parse(opts.body)
      return fakeResponse(201, { path: 'new.tex', docId: 'doc999' })
    })
    await createFile({ path: 'new.tex', content: 'hello' }, makeCtx())
    expect(capturedUrl).to.include('/internal/project/proj123/agent/create-file')
    expect(capturedHeaders.Authorization).to.match(/^Basic /)
    expect(capturedBody).to.deep.equal({
      path: 'new.tex',
      content: 'hello',
      userId: 'user123',
    })
  })

  it('sends empty string when content is omitted', async function () {
    let capturedBody
    stubFetch(async (_, opts) => {
      capturedBody = JSON.parse(opts.body)
      return fakeResponse(201, { path: 'new.tex', docId: 'doc999' })
    })
    await createFile({ path: 'new.tex' }, makeCtx())
    expect(capturedBody.content).to.equal('')
  })

  it('returns error string on HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const result = await createFile({ path: 'new.tex' }, makeCtx())
    expect(result).to.include('500')
  })
})
