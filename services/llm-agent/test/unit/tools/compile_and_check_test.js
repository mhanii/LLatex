// @ts-check
import { expect } from 'chai'
import { compileAndCheck } from '../../../app/js/tools/compile_and_check.js'
import { fakeResponse, CTX, stubFetch, restoreFetch } from './helpers.js'

describe('compileAndCheck', function () {
  afterEach(restoreFetch)

  it('returns {success: true, status, errors: []} on success', async function () {
    stubFetch(async () =>
      fakeResponse(200, { success: true, status: 'success', errors: [] })
    )
    const result = await compileAndCheck({}, CTX)
    expect(result).to.deep.equal({ success: true, status: 'success', errors: [] })
  })

  it('passes through pageCount when the endpoint returns it', async function () {
    stubFetch(async () =>
      fakeResponse(200, {
        success: true,
        status: 'success',
        errors: [],
        pageCount: 4,
      })
    )
    const result = await compileAndCheck({}, CTX)
    expect(result.pageCount).to.equal(4)
  })

  it('passes through null pageCount when compile fails', async function () {
    stubFetch(async () =>
      fakeResponse(200, {
        success: false,
        status: 'failure',
        errors: ['Undefined control sequence'],
        pageCount: null,
      })
    )
    const result = await compileAndCheck({}, CTX)
    expect(result.pageCount).to.be.null
  })

  it('returns {success: false, status: "too-recently-compiled"} without throwing', async function () {
    stubFetch(async () =>
      fakeResponse(200, {
        success: false,
        status: 'too-recently-compiled',
        errors: [],
      })
    )
    const result = await compileAndCheck({}, CTX)
    expect(result.success).to.be.false
    expect(result.status).to.equal('too-recently-compiled')
  })

  it('returns {success: false} with HTTP error info when fetch fails', async function () {
    stubFetch(async () => fakeResponse(500))
    const result = await compileAndCheck({}, CTX)
    expect(result.success).to.be.false
    expect(result.status).to.include('500')
    expect(result.errors).to.deep.equal([])
  })

  it('posts to compile endpoint with Basic auth and userId', async function () {
    let capturedUrl, capturedHeaders, capturedBody
    stubFetch(async (url, opts) => {
      capturedUrl = url
      capturedHeaders = opts.headers
      capturedBody = JSON.parse(opts.body)
      return fakeResponse(200, { success: true, status: 'success', errors: [] })
    })
    await compileAndCheck({}, CTX)
    expect(capturedUrl).to.include('/internal/project/proj123/agent/compile')
    expect(capturedHeaders.Authorization).to.match(/^Basic /)
    expect(capturedBody).to.deep.equal({ userId: 'user123' })
  })
})
