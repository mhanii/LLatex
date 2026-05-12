// @ts-check
import { expect } from 'chai'
import { readSkill } from '../../../app/js/tools/read_skill.js'

const CTX = { projectId: 'p', userId: 'u', runId: 'r' }

describe('readSkill', function () {
  it('returns "not found" message for an unknown skill', async function () {
    const result = await readSkill({ name: 'nonexistent_skill' }, CTX)
    expect(result).to.be.a('string')
    expect(result).to.include('not found')
    expect(result).to.include('list_skills')
  })

  it('returns the guide + template index for a real skill (no template)', async function () {
    const result = await readSkill({ name: 'pgfplots_charts' }, CTX)
    expect(result).to.be.a('string')
    expect(result).to.match(/# Guide/)
    expect(result).to.match(/# Available Templates/)
  })

  it('does NOT crash with EISDIR when template is ".."', async function () {
    // `..` survives the [^a-z0-9_.-] regex; joined with templatesDir it
    // resolves to the skill dir, which is a directory → readFileSync throws.
    let result, err
    try {
      result = await readSkill(
        { name: 'pgfplots_charts', template: '..' },
        CTX
      )
    } catch (e) {
      err = e
    }
    expect(err, `should not throw, got: ${err?.message}`).to.be.undefined
    expect(result).to.be.a('string')
    // Should be a graceful "not found" / invalid-name message, not EISDIR.
    expect(result.toLowerCase()).to.not.include('eisdir')
  })

  it('does NOT crash with EISDIR when template is "."', async function () {
    let result, err
    try {
      result = await readSkill(
        { name: 'pgfplots_charts', template: '.' },
        CTX
      )
    } catch (e) {
      err = e
    }
    expect(err, `should not throw, got: ${err?.message}`).to.be.undefined
    expect(result).to.be.a('string')
    expect(result.toLowerCase()).to.not.include('eisdir')
  })
})
