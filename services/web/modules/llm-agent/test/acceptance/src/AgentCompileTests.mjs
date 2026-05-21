// Acceptance test: AgentCompileCoordinator lock end-to-end through the
// `/internal/project/:id/agent/compile` route, with real Redis and real
// Express routing. CompileManager is wrapped (not mocked) so we can count
// CLSI roundtrips and inject a delay to guarantee request overlap.

import { expect } from 'chai'
import sinon from 'sinon'
import settings from '@overleaf/settings'
import User from '../../../../../test/acceptance/src/helpers/User.mjs'
import request from '../../../../../test/acceptance/src/helpers/request.js'
import CompileManager from '../../../../../app/src/Features/Compile/CompileManager.mjs'

function authHeader() {
  const token = Buffer.from(
    `${settings.apis.web.user}:${settings.apis.web.pass}`
  ).toString('base64')
  return `Basic ${token}`
}

function postAgentCompile(projectId, body) {
  return request.promises.request({
    method: 'POST',
    url: `/internal/project/${projectId}/agent/compile`,
    json: body,
    headers: { Authorization: authHeader() },
  })
}

describe('Agent compile coordination (lock)', function () {
  this.timeout(20000)

  let userId
  let projectId
  let compileCallCount

  beforeEach(function (done) {
    compileCallCount = 0
    const original = CompileManager.promises.compile
    sinon.replace(CompileManager.promises, 'compile', async (...args) => {
      compileCallCount += 1
      // Delay long enough that a concurrent caller observes the lock and
      // takes the wait-for-result path rather than acquiring on its own.
      await new Promise(r => setTimeout(r, 400))
      return original.apply(CompileManager.promises, args)
    })

    const user = new User()
    user.login(err => {
      if (err) return done(err)
      userId = user.id
      user.createProject('agent-compile-test', (err, id) => {
        if (err) return done(err)
        projectId = id
        done()
      })
    })
  })

  afterEach(function () {
    sinon.restore()
  })

  it('two parallel agent compiles produce a single CLSI roundtrip', async function () {
    const [a, b] = await Promise.all([
      postAgentCompile(projectId, { userId }),
      postAgentCompile(projectId, { userId }),
    ])

    expect(a.statusCode).to.equal(200)
    expect(b.statusCode).to.equal(200)
    expect(a.body.success).to.equal(true)
    expect(b.body.success).to.equal(true)
    expect(compileCallCount).to.equal(1)
  })
})
