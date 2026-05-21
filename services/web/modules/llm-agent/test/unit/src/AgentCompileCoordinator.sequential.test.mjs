// Real-Redis test for the agent compile coordinator.
//
// Uses the actual `RedisWrapper.client('web')` so the lock + result-store
// behavior is verified against real Redis semantics (SETNX, PX, signed-token
// unlock). Tests isolate via random project IDs — no flushall needed, so this
// runs locally against the dev Redis as well as in CI against `redis_test`.
//
// CompileManager and EditorRealTimeController are the only stubs: we need to
// inject failure modes ('compile-in-progress', throws) and verify emissions.

import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RedisWrapper from '../../../../../app/src/infrastructure/RedisWrapper.mjs'

const USER_ID = 'user_bbbbbbbbbbbbbbbbbbbbbbbb'

function randomProjectId() {
  return `proj_test_${crypto.randomBytes(8).toString('hex')}`
}

let CompileManager
let EditorRealTimeController
let AgentCompileCoordinator
const redis = RedisWrapper.client('web')

describe('AgentCompileCoordinator (real Redis)', function () {
  beforeEach(async function () {
    vi.resetModules()

    CompileManager = {
      promises: {
        compile: vi.fn().mockResolvedValue({
          status: 'success',
          outputFiles: [{ path: 'output.pdf', url: '/u/1' }],
          clsiServerId: 'clsi-1',
          buildId: 'build-1',
        }),
      },
    }
    vi.doMock(
      '../../../../../app/src/Features/Compile/CompileManager.mjs',
      () => ({ default: CompileManager })
    )

    EditorRealTimeController = { emitToRoom: vi.fn() }
    vi.doMock(
      '../../../../../app/src/Features/Editor/EditorRealTimeController.mjs',
      () => ({ default: EditorRealTimeController })
    )

    ;({ default: AgentCompileCoordinator } = await import(
      '../../../app/src/AgentCompileCoordinator.mjs'
    ))
  })

  describe('lock contention', function () {
    it('serialises two parallel compiles into a single CompileManager call', async function () {
      const projectId = randomProjectId()
      let resolveCompile
      CompileManager.promises.compile = vi.fn().mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveCompile = resolve
          })
      )

      const first = AgentCompileCoordinator.compile(projectId, USER_ID, {})
      // Yield until the first call has registered its lock in Redis.
      await waitUntil(async () => {
        return (await redis.get(`agent:compile:lock:${projectId}`)) != null
      })
      const second = AgentCompileCoordinator.compile(projectId, USER_ID, {})
      // Yield so the second call observes the lock and starts waiting.
      await new Promise(r => setTimeout(r, 50))

      resolveCompile({
        status: 'success',
        outputFiles: [],
        buildId: 'build-shared',
      })

      const [a, b] = await Promise.all([first, second])
      expect(CompileManager.promises.compile).toHaveBeenCalledTimes(1)
      expect(a.buildId).toBe('build-shared')
      expect(b.buildId).toBe('build-shared')
    })

    it('waiters receive a non-success result instead of timing out', async function () {
      const projectId = randomProjectId()
      let resolveCompile
      CompileManager.promises.compile = vi.fn().mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveCompile = resolve
          })
      )
      const first = AgentCompileCoordinator.compile(projectId, USER_ID, {})
      await waitUntil(async () => {
        return (await redis.get(`agent:compile:lock:${projectId}`)) != null
      })
      const second = AgentCompileCoordinator.compile(projectId, USER_ID, {})
      await new Promise(r => setTimeout(r, 50))

      resolveCompile({ status: 'failure', outputFiles: [] })

      const [a, b] = await Promise.all([first, second])
      expect(a.status).toBe('failure')
      expect(b.status).toBe('failure')
    })

    it('waiters receive an error sentinel when the lock holder throws', async function () {
      const projectId = randomProjectId()
      let rejectCompile
      CompileManager.promises.compile = vi.fn().mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectCompile = reject
          })
      )
      const first = AgentCompileCoordinator.compile(projectId, USER_ID, {}).catch(
        err => ({ thrown: err })
      )
      await waitUntil(async () => {
        return (await redis.get(`agent:compile:lock:${projectId}`)) != null
      })
      const second = AgentCompileCoordinator.compile(projectId, USER_ID, {})
      await new Promise(r => setTimeout(r, 50))

      rejectCompile(new Error('clsi exploded'))

      const [a, b] = await Promise.all([first, second])
      expect(a.thrown?.message).toBe('clsi exploded')
      expect(b.status).toBe('error')
      expect(b.error).toContain('clsi exploded')
    })

    it('releases the lock if the compile throws so the next call can run', async function () {
      const projectId = randomProjectId()
      CompileManager.promises.compile = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({
          status: 'success',
          outputFiles: [],
          buildId: 'build-2',
        })

      let caught
      try {
        await AgentCompileCoordinator.compile(projectId, USER_ID, {})
      } catch (err) {
        caught = err
      }
      expect(caught?.message).toBe('boom')

      // Lock key must not survive a failed compile.
      expect(await redis.get(`agent:compile:lock:${projectId}`)).toBeNull()

      const result = await AgentCompileCoordinator.compile(
        projectId,
        USER_ID,
        {}
      )
      expect(result.buildId).toBe('build-2')
    })
  })

  describe('CLSI compile-in-progress', function () {
    it('retries until success and never surfaces "compile-in-progress" to the caller', async function () {
      const projectId = randomProjectId()
      CompileManager.promises.compile = vi
        .fn()
        .mockResolvedValueOnce({
          status: 'compile-in-progress',
          outputFiles: [],
        })
        .mockResolvedValueOnce({
          status: 'compile-in-progress',
          outputFiles: [],
        })
        .mockResolvedValueOnce({
          status: 'success',
          outputFiles: [],
          buildId: 'build-3',
        })

      const result = await AgentCompileCoordinator.compile(
        projectId,
        USER_ID,
        {}
      )
      expect(result.status).toBe('success')
      expect(result.buildId).toBe('build-3')
      expect(CompileManager.promises.compile).toHaveBeenCalledTimes(3)
    })

    it('surfaces other failure statuses unchanged', async function () {
      const projectId = randomProjectId()
      CompileManager.promises.compile = vi.fn().mockResolvedValueOnce({
        status: 'failure',
        outputFiles: [],
      })
      const result = await AgentCompileCoordinator.compile(
        projectId,
        USER_ID,
        {}
      )
      expect(result.status).toBe('failure')
      expect(CompileManager.promises.compile).toHaveBeenCalledTimes(1)
    })
  })

  describe('frontend sync', function () {
    it('emits pdf:agent-compile-done with the frontend-shaped compile payload', async function () {
      const projectId = randomProjectId()
      CompileManager.promises.compile = vi.fn().mockResolvedValueOnce({
        status: 'success',
        outputFiles: [{ path: 'output.pdf', url: '/u/1' }],
        clsiServerId: 'clsi-1',
        clsiCacheShard: 'shard-A',
        limits: { compileGroup: 'priority' },
        validationProblems: null,
        stats: { foo: 1 },
        timings: { compileE2E: 42 },
        outputUrlPrefix: '/prefix',
        buildId: 'build-1',
      })

      await AgentCompileCoordinator.compile(projectId, USER_ID, {})

      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledTimes(1)
      const [room, event, payload] =
        EditorRealTimeController.emitToRoom.mock.calls[0]
      expect(room).toBe(projectId)
      expect(event).toBe('pdf:agent-compile-done')
      // Required keys for the frontend's compile context.
      expect(payload.status).toBe('success')
      expect(payload.outputFiles).toEqual([{ path: 'output.pdf', url: '/u/1' }])
      expect(payload.clsiServerId).toBe('clsi-1')
      expect(payload.clsiCacheShard).toBe('shard-A')
      // compileGroup must be flattened out of result.limits.
      expect(payload.compileGroup).toBe('priority')
      expect(payload.stats).toEqual({ foo: 1 })
      expect(payload.timings).toEqual({ compileE2E: 42 })
      expect(payload.outputUrlPrefix).toBe('/prefix')
      // pdfCachingMinChunkSize is required (no `?` in the frontend type).
      expect(typeof payload.pdfCachingMinChunkSize).toBe('number')
    })

    it('does not emit when the compile fails', async function () {
      const projectId = randomProjectId()
      CompileManager.promises.compile = vi.fn().mockResolvedValueOnce({
        status: 'failure',
        outputFiles: [],
      })
      await AgentCompileCoordinator.compile(projectId, USER_ID, {})
      expect(EditorRealTimeController.emitToRoom).not.toHaveBeenCalled()
    })

    it('only the lock holder emits — waiters do not double-emit', async function () {
      const projectId = randomProjectId()
      let resolveCompile
      CompileManager.promises.compile = vi.fn().mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveCompile = resolve
          })
      )
      const first = AgentCompileCoordinator.compile(projectId, USER_ID, {})
      await waitUntil(async () => {
        return (await redis.get(`agent:compile:lock:${projectId}`)) != null
      })
      const second = AgentCompileCoordinator.compile(projectId, USER_ID, {})
      await new Promise(r => setTimeout(r, 50))
      resolveCompile({
        status: 'success',
        outputFiles: [],
        buildId: 'build-shared-2',
      })
      await Promise.all([first, second])
      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledTimes(1)
    })
  })
})

async function waitUntil(predicate, { interval = 10, timeout = 2000 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await predicate()) return
    await new Promise(r => setTimeout(r, interval))
  }
  throw new Error('waitUntil: predicate did not become true within timeout')
}
