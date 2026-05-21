import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import RedisWrapper from '../../../../app/src/infrastructure/RedisWrapper.mjs'
import CompileManager from '../../../../app/src/Features/Compile/CompileManager.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'

const rclient = RedisWrapper.client('web')

const LOCK_TTL_MS = 4 * 60 * 1000
const RESULT_TTL_MS = 60 * 1000
const WAITER_POLL_INTERVAL_MS = 200
const WAITER_TIMEOUT_MS = 5 * 60 * 1000
const CLSI_RETRY_DELAY_MS = 2_000
const CLSI_MAX_RETRIES = 30

const UNLOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end'

function lockKey(projectId) {
  return `agent:compile:lock:${projectId}`
}

function resultKey(projectId) {
  return `agent:compile:result:${projectId}`
}

function newLockToken() {
  return crypto.randomBytes(16).toString('hex')
}

async function tryAcquireLock(projectId, token) {
  const reply = await rclient.set(
    lockKey(projectId),
    token,
    'PX',
    LOCK_TTL_MS,
    'NX'
  )
  return reply === 'OK'
}

async function releaseLock(projectId, token) {
  try {
    await rclient.eval(UNLOCK_SCRIPT, 1, lockKey(projectId), token)
  } catch (err) {
    logger.warn({ err, projectId }, 'agent compile lock release failed')
  }
}

async function storeResult(projectId, result) {
  await rclient.set(
    resultKey(projectId),
    JSON.stringify(result),
    'PX',
    RESULT_TTL_MS
  )
}

async function readResult(projectId) {
  const raw = await rclient.get(resultKey(projectId))
  return raw ? JSON.parse(raw) : null
}

async function waitForResult(projectId) {
  const deadline = Date.now() + WAITER_TIMEOUT_MS
  while (Date.now() < deadline) {
    const result = await readResult(projectId)
    if (result) return result
    await new Promise(r => setTimeout(r, WAITER_POLL_INTERVAL_MS))
  }
  throw new Error(
    `agent compile waiter timed out for project ${projectId} after ${WAITER_TIMEOUT_MS}ms`
  )
}

async function runCompileWithRetries(projectId, userId, options) {
  for (let attempt = 0; attempt < CLSI_MAX_RETRIES; attempt++) {
    const result = await CompileManager.promises.compile(
      projectId,
      userId,
      options
    )
    if (result.status !== 'compile-in-progress') return result
    await new Promise(r => setTimeout(r, CLSI_RETRY_DELAY_MS))
  }
  return { status: 'compile-in-progress', outputFiles: [] }
}

// Shape the CompileManager result into the same payload the frontend's
// pdf-preview compile context consumes after a normal user-driven compile,
// so it can be applied directly without a re-fetch. `options` mirrors what
// the frontend's compiler.ts attaches before setData — the data-processing
// effect reads `data.options.stopOnFirstError` unconditionally and would
// crash without it.
function toCompileResponsePayload(result) {
  return {
    status: result.status,
    outputFiles: result.outputFiles,
    clsiServerId: result.clsiServerId,
    clsiCacheShard: result.clsiCacheShard,
    compileGroup: result.limits?.compileGroup,
    validationProblems: result.validationProblems,
    stats: result.stats,
    timings: result.timings,
    outputUrlPrefix: result.outputUrlPrefix,
    pdfDownloadDomain: Settings.pdfDownloadDomain,
    pdfCachingMinChunkSize: Settings.pdfCachingMinChunkSize ?? 0,
    options: { stopOnFirstError: false },
  }
}

async function compile(projectId, userId, options = {}) {
  const token = newLockToken()

  if (await tryAcquireLock(projectId, token)) {
    let result
    try {
      try {
        result = await runCompileWithRetries(projectId, userId, options)
      } catch (err) {
        // Surface as a structured result so waiters don't poll for the full
        // WAITER_TIMEOUT_MS before erroring. Re-thrown to the lock holder.
        result = { status: 'error', outputFiles: [], error: String(err) }
        await storeResult(projectId, result)
        throw err
      }
      await storeResult(projectId, result)
      if (result.status === 'success') {
        EditorRealTimeController.emitToRoom(
          projectId,
          'pdf:agent-compile-done',
          toCompileResponsePayload(result)
        )
      }
      return result
    } finally {
      await releaseLock(projectId, token)
    }
  }

  // Someone else holds the lock; wait for them to publish the result.
  return await waitForResult(projectId)
}

export default { compile }
