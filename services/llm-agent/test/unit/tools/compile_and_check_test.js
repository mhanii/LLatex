// @ts-check
import { expect } from 'chai'
import { compileAndCheck } from '../../../app/js/tools/compile_and_check.js'
import { fakeResponse, CTX, stubFetch, restoreFetch } from './helpers.js'

const EMPTY_OK = {
  success: true,
  status: 'success',
  errors: [],
  warnings: [],
  typesetting: [],
  pageCount: 0,
}

describe('compileAndCheck', function () {
  afterEach(restoreFetch)

  it('passes the structured success payload through unchanged', async function () {
    stubFetch(async () => fakeResponse(200, { ...EMPTY_OK, pageCount: 4 }))
    const result = await compileAndCheck({}, CTX)
    expect(result).to.deep.equal({ ...EMPTY_OK, pageCount: 4 })
  })

  it('passes the structured failure payload through unchanged', async function () {
    const failure = {
      success: false,
      status: 'failure',
      errors: [
        {
          level: 'error',
          file: './main.tex',
          line: 5,
          message: 'Undefined control sequence.',
          ruleId: 'hint_undefined_control_sequence',
        },
      ],
      warnings: [],
      typesetting: [],
      pageCount: null,
    }
    stubFetch(async () => fakeResponse(200, failure))
    const result = await compileAndCheck({}, CTX)
    expect(result).to.deep.equal(failure)
  })

  it('returns {success: false, status: "too-recently-compiled"} without throwing', async function () {
    stubFetch(async () =>
      fakeResponse(200, {
        ...EMPTY_OK,
        success: false,
        status: 'too-recently-compiled',
      })
    )
    const result = await compileAndCheck({}, CTX)
    expect(result.success).to.be.false
    expect(result.status).to.equal('too-recently-compiled')
  })

  it('returns empty entries with HTTP error status when fetch fails', async function () {
    stubFetch(async () => fakeResponse(500))
    const result = await compileAndCheck({}, CTX)
    expect(result.success).to.be.false
    expect(result.status).to.include('500')
    expect(result.errors).to.deep.equal([])
    expect(result.warnings).to.deep.equal([])
    expect(result.typesetting).to.deep.equal([])
    expect(result.pageCount).to.be.null
  })

  it('returns "file not found" without calling fetch when path is unknown', async function () {
    let called = false
    stubFetch(async () => {
      called = true
      return fakeResponse(200, EMPTY_OK)
    })
    const result = await compileAndCheck({ path: 'nope.tex' }, CTX)
    expect(called).to.be.false
    expect(result.success).to.be.false
    expect(result.status).to.include('file not found')
    expect(result.errors).to.deep.equal([])
    expect(result.warnings).to.deep.equal([])
    expect(result.typesetting).to.deep.equal([])
  })

  it('posts to compile endpoint with Basic auth and userId', async function () {
    let capturedUrl, capturedHeaders, capturedBody
    stubFetch(async (url, opts) => {
      capturedUrl = url
      capturedHeaders = opts.headers
      capturedBody = JSON.parse(opts.body)
      return fakeResponse(200, EMPTY_OK)
    })
    await compileAndCheck({}, CTX)
    expect(capturedUrl).to.include('/internal/project/proj123/agent/compile')
    expect(capturedHeaders.Authorization).to.match(/^Basic /)
    expect(capturedBody).to.deep.equal({ userId: 'user123' })
  })
})
