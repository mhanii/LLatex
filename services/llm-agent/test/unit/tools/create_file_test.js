// @ts-check
import { expect } from 'chai'
import { createFile } from '../../../app/js/tools/create_file.js'
import { fakeResponse, CTX, stubFetch, restoreFetch } from './helpers.js'

describe('createFile', function () {
  afterEach(restoreFetch)

  it('returns {path, docId} on success', async function () {
    stubFetch(async () =>
      fakeResponse(201, { path: 'new.tex', docId: 'doc999' })
    )
    const result = await createFile({ path: 'new.tex', content: '\\hello' }, CTX)
    expect(result).to.deep.equal({ path: 'new.tex', docId: 'doc999' })
  })

  it('posts with Basic auth and correct body', async function () {
    let capturedUrl, capturedHeaders, capturedBody
    stubFetch(async (url, opts) => {
      capturedUrl = url
      capturedHeaders = opts.headers
      capturedBody = JSON.parse(opts.body)
      return fakeResponse(201, { path: 'new.tex', docId: 'doc999' })
    })
    await createFile({ path: 'new.tex', content: 'hello' }, CTX)
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
    await createFile({ path: 'new.tex' }, CTX)
    expect(capturedBody.content).to.equal('')
  })

  it('returns error string on HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const result = await createFile({ path: 'new.tex' }, CTX)
    expect(result).to.include('500')
  })
})
