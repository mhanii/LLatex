// @ts-check
import { expect } from 'chai'
import { editFile } from '../../../app/js/tools/edit_file.js'
import { fakeResponse, CTX, stubFetch, restoreFetch } from './helpers.js'

describe('editFile', function () {
  afterEach(restoreFetch)

  it('returns "Change applied." on success', async function () {
    stubFetch(async () => fakeResponse(204))
    const result = await editFile(
      { path: 'main.tex', oldText: 'hello', newText: 'world' },
      CTX
    )
    expect(result).to.equal('Change applied.')
  })

  it('returns not-found string on 404', async function () {
    stubFetch(async () => fakeResponse(404))
    const result = await editFile(
      { path: 'main.tex', oldText: 'missing text', newText: 'replacement' },
      CTX
    )
    expect(result).to.include('not found')
    expect(result).to.include('main.tex')
  })

  it('returns error string on other HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const result = await editFile(
      { path: 'main.tex', oldText: 'x', newText: 'y' },
      CTX
    )
    expect(result).to.include('500')
  })

  it('posts to agent-replace with correct body', async function () {
    let capturedUrl, capturedBody
    stubFetch(async (url, opts) => {
      capturedUrl = url
      capturedBody = JSON.parse(opts.body)
      return fakeResponse(204)
    })
    await editFile(
      { path: 'main.tex', oldText: 'old', newText: 'new' },
      CTX
    )
    expect(capturedUrl).to.include('/project/proj123/doc/doc111/agent-replace')
    expect(capturedBody).to.deep.equal({
      old_text: 'old',
      new_text: 'new',
      user_id: 'user123',
    })
  })

  it('throws for unknown path', async function () {
    stubFetch(async () => fakeResponse(204))
    let err
    try { await editFile({ path: 'ghost.tex', oldText: 'x', newText: 'y' }, CTX) } catch (e) { err = e }
    expect(err).to.be.an('error')
    expect(err.message).to.include('ghost.tex')
  })
})
