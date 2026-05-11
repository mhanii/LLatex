// @ts-check
import { expect } from 'chai'
import { editFile } from '../../../app/js/tools/edit_file.js'
import { fakeResponse, makeCtx, stubFetch, restoreFetch } from './helpers.js'

describe('editFile', function () {
  afterEach(restoreFetch)

  it('returns "Change applied." on success', async function () {
    stubFetch(async () => fakeResponse(204))
    const result = await editFile(
      { path: 'main.tex', oldText: 'hello', newText: 'world' },
      makeCtx()
    )
    expect(result).to.equal('Change applied.')
  })

  it('returns not-found string on 404', async function () {
    stubFetch(async () => fakeResponse(404))
    const result = await editFile(
      { path: 'main.tex', oldText: 'missing text', newText: 'replacement' },
      makeCtx()
    )
    expect(result).to.include('not found')
    expect(result).to.include('main.tex')
  })

  it('returns disambiguation string on 409', async function () {
    stubFetch(async () =>
      fakeResponse(409, {
        error: 'old_text matched multiple locations',
        code: 'AMBIGUOUS_OLD_TEXT',
      })
    )
    const result = await editFile(
      { path: 'main.tex', oldText: 'repeated', newText: 'replacement' },
      makeCtx()
    )
    expect(result).to.include('multiple times')
  })

  it('returns error string on other HTTP error', async function () {
    stubFetch(async () => fakeResponse(500))
    const result = await editFile(
      { path: 'main.tex', oldText: 'x', newText: 'y' },
      makeCtx()
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
      makeCtx()
    )
    expect(capturedUrl).to.include('/project/proj123/doc/doc111/agent-replace')
    expect(capturedBody).to.deep.equal({
      old_text: 'old',
      new_text: 'new',
      user_id: 'user123',
    })
  })

  it('returns an error string (not throw) for unknown path', async function () {
    let called = false
    stubFetch(async () => { called = true; return fakeResponse(204) })
    const result = await editFile(
      { path: 'ghost.tex', oldText: 'x', newText: 'y' },
      makeCtx()
    )
    expect(result).to.be.a('string')
    expect(result).to.include('ghost.tex')
    expect(result).to.include('list_files')
    expect(called).to.be.false
  })
})
