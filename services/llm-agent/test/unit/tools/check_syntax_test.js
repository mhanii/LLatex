// @ts-check
import { expect } from 'chai'
import { checkSyntax } from '../../../app/js/tools/check_syntax.js'
import { fakeResponse, CTX, stubFetch, restoreFetch } from './helpers.js'

const NO_ISSUES = { issues: [] }

describe('checkSyntax', function () {
  afterEach(restoreFetch)

  it('returns issues array from the endpoint', async function () {
    const issues = [
      {
        type: 'warning',
        message: 'Undefined reference \\ref{missing}',
        file: 'main.tex',
      },
    ]
    stubFetch(async () => fakeResponse(200, { issues }))
    const result = await checkSyntax({}, CTX)
    expect(result.issues).to.deep.equal(issues)
  })

  it('returns empty issues array on clean project', async function () {
    stubFetch(async () => fakeResponse(200, NO_ISSUES))
    const result = await checkSyntax({}, CTX)
    expect(result.issues).to.deep.equal([])
  })

  it('calls the syntax-check endpoint with the correct project id', async function () {
    let capturedUrl
    stubFetch(async url => {
      capturedUrl = url
      return fakeResponse(200, NO_ISSUES)
    })
    await checkSyntax({}, CTX)
    expect(capturedUrl).to.include('/internal/project/proj123/agent/syntax-check')
  })

  it('appends path query param when a path is provided', async function () {
    let capturedUrl
    stubFetch(async url => {
      capturedUrl = url
      return fakeResponse(200, NO_ISSUES)
    })
    await checkSyntax({ path: 'main.tex' }, CTX)
    expect(capturedUrl).to.include('path=main.tex')
  })

  it('omits path query param when no path is provided', async function () {
    let capturedUrl
    stubFetch(async url => {
      capturedUrl = url
      return fakeResponse(200, NO_ISSUES)
    })
    await checkSyntax({}, CTX)
    expect(capturedUrl).to.not.include('path=')
  })

  it('sends Basic auth header', async function () {
    let capturedOpts
    stubFetch(async (_url, opts) => {
      capturedOpts = opts
      return fakeResponse(200, NO_ISSUES)
    })
    await checkSyntax({}, CTX)
    expect(capturedOpts.headers.Authorization).to.match(/^Basic /)
  })

  it('wraps HTTP failure in a single error issue', async function () {
    stubFetch(async () => fakeResponse(503))
    const result = await checkSyntax({}, CTX)
    expect(result.issues).to.have.length(1)
    expect(result.issues[0].type).to.equal('error')
    expect(result.issues[0].message).to.include('503')
  })
})
