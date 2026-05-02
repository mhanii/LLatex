// @ts-check
import { expect } from 'chai'
import { getPdfPage } from '../../../app/js/tools/get_pdf_page.js'
import { fakeResponse, CTX, stubFetch, restoreFetch } from './helpers.js'

const FAKE_IMAGE = { imageBase64: 'iVBORw0KGgo=', mimeType: 'image/png' }

describe('getPdfPage', function () {
  afterEach(restoreFetch)

  it('returns imageBase64 and mimeType on success', async function () {
    stubFetch(async () => fakeResponse(200, FAKE_IMAGE))
    const result = await getPdfPage({ page: 1 }, CTX)
    expect(result).to.deep.equal(FAKE_IMAGE)
  })

  it('returns error string when no compiled PDF exists (404)', async function () {
    stubFetch(async () => fakeResponse(404))
    const result = await getPdfPage({ page: 1 }, CTX)
    expect(result).to.be.a('string')
    expect(result).to.include('No compiled PDF')
  })

  it('returns error string on upstream failure', async function () {
    stubFetch(async () => fakeResponse(502))
    const result = await getPdfPage({ page: 1 }, CTX)
    expect(result).to.be.a('string')
    expect(result).to.include('502')
  })

  it('calls the pdf-page endpoint with correct project id, page, and userId', async function () {
    let capturedUrl
    stubFetch(async url => {
      capturedUrl = url
      return fakeResponse(200, FAKE_IMAGE)
    })
    await getPdfPage({ page: 3 }, CTX)
    expect(capturedUrl).to.include('/internal/project/proj123/agent/pdf-page')
    expect(capturedUrl).to.include('page=3')
    expect(capturedUrl).to.include('userId=user123')
  })

  it('sends Basic auth header', async function () {
    let capturedOpts
    stubFetch(async (_url, opts) => {
      capturedOpts = opts
      return fakeResponse(200, FAKE_IMAGE)
    })
    await getPdfPage({ page: 1 }, CTX)
    expect(capturedOpts.headers.Authorization).to.match(/^Basic /)
  })

  it('returns error string for invalid page number (0)', async function () {
    // No fetch should be needed — the tool guards before calling
    stubFetch(async () => { throw new Error('should not call fetch') })
    const result = await getPdfPage({ page: 0 }, CTX)
    expect(result).to.be.a('string')
  })
})
