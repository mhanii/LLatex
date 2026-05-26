// @ts-check

import { expressify } from '@overleaf/promise-utils'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import ChatManager from '../../../../app/src/Features/Chat/ChatManager.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import RestoreManager from '../../../../app/src/Features/History/RestoreManager.mjs'
import ProjectAuditLogHandler from '../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs'
import logger from '@overleaf/logger'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import UserUpdater from '../../../../app/src/Features/User/UserUpdater.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import AgentCompileCoordinator from './AgentCompileCoordinator.mjs'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectCreationHandler from '../../../../app/src/Features/Project/ProjectCreationHandler.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import Settings from '@overleaf/settings'
import SyntaxChecker from './SyntaxChecker.mjs'
import LlmAgentApiHandler from './LlmAgentApiHandler.mjs'
import AgentConversationManager from './AgentConversationManager.mjs'
import { parseCompileLogs } from './parsers/LogParser.mjs'

function normalizeProjectPath(path) {
  return path.startsWith('/') ? path.slice(1) : path
}

// Bill partial-or-full run usage back to the user's lifetime totals.
// Called from the llm-agent service's run-complete and run-cancelled
// callbacks. Both deltas are optional — silently no-op if absent or zero so
// older callers (or retried no-token runs) don't blow up.
async function applyUsageDelta(userId, outputTokensDelta, costUsdDelta) {
  if (!userId) return
  const outTok = Number(outputTokensDelta) || 0
  const costUsd = Number(costUsdDelta) || 0
  if (outTok === 0 && costUsd === 0) return
  await UserUpdater.promises.updateUser(userId.toString(), {
    $inc: {
      'agentQuota.outputTokensUsed': outTok,
      'agentQuota.costUsdUsed': costUsd,
    },
  })
}

// ---------------------------------------------------------------------------
// Quota gate with in-memory reservations to close the TOCTOU race that a
// plain "read then write later" check leaves open: N concurrent sendMessage
// calls for the same user would all read the same pre-run usage, all pass,
// and all bill afterwards — letting the user consume N× their cap before
// any delta lands. We pre-reserve a pessimistic per-run allotment between
// the gate and the run-complete callback. tryReserveQuota runs SYNCHRONOUSLY
// between awaits so concurrent gates serialize on JS's single-threaded
// continuation queue.
//
// Multi-worker caveat: state is per-process. A web service running with
// multiple Node workers (e.g. behind a load balancer) needs a shared store
// (Redis INCR/DECR or an atomic mongo findAndModify) for full correctness.
// Acceptable for the single-worker MVP deployment.
// ---------------------------------------------------------------------------

const ESTIMATE_OUTPUT_TOKENS = 4000
// Pessimistic per-run cost reservation: ESTIMATE_OUTPUT_TOKENS at the
// most expensive output price currently in services/llm-agent/app/js/
// cost/priceTable.js ($10/1M for gpt-4o). Bumping a model past this
// price under-reserves cost briefly; the actual billing on completion
// catches up.
const ESTIMATE_COST_USD =
  (ESTIMATE_OUTPUT_TOKENS / 1_000_000) * 10

// userId -> { tokens, costUsd } summed over the user's in-flight runs.
const inflightByUser = new Map()
// runId -> reservation registered against the user. Released on
// agentComplete / agentCancelled.
const reservationsByRun = new Map()

function tryReserveQuota(userId, q) {
  const tokensLimit = q?.outputTokensLimit ?? -1
  const costLimit = q?.costUsdLimit ?? -1
  const tokensUsed = q?.outputTokensUsed ?? 0
  const costUsed = q?.costUsdUsed ?? 0

  // SYNCHRONOUS read-decide-write — no awaits, so concurrent invocations
  // serialize on the JS event loop. Two gates that each pass `await
  // getUser` separately will run their continuations one after another,
  // and the second sees the first's reservation in inflight.
  //
  // -1 is the documented sentinel for unlimited; everything else
  // (including 0 — a deliberate "deny all" value) is an active cap.
  // Earlier revisions used `> 0` here, which silently collapsed 0 with
  // -1 and unblocked deny-all users.
  const inflight = inflightByUser.get(userId) ?? { tokens: 0, costUsd: 0 }
  const tokensHeadroom =
    tokensLimit !== -1
      ? tokensLimit - tokensUsed - inflight.tokens
      : Infinity
  const costHeadroom =
    costLimit !== -1
      ? costLimit - costUsed - inflight.costUsd
      : Infinity

  // Cost takes precedence when both caps are crossed (matches the
  // original LimitationsManager-style behaviour).
  if (costHeadroom <= 0) return { ok: false, reason: 'cost', quota: q }
  if (tokensHeadroom <= 0)
    return { ok: false, reason: 'output_tokens', quota: q }

  const reservedTokens = Math.min(ESTIMATE_OUTPUT_TOKENS, tokensHeadroom)
  const reservedCostUsd = Math.min(ESTIMATE_COST_USD, costHeadroom)

  if (tokensLimit !== -1 || costLimit !== -1) {
    inflightByUser.set(userId, {
      tokens: inflight.tokens + reservedTokens,
      costUsd: inflight.costUsd + reservedCostUsd,
    })
  }
  return { ok: true, reservedTokens, reservedCostUsd, quota: q }
}

function registerReservation(runId, userId, reservedTokens, reservedCostUsd) {
  reservationsByRun.set(runId, { userId, reservedTokens, reservedCostUsd })
}

function releaseReservationByRunId(runId) {
  const r = reservationsByRun.get(runId)
  if (!r) return
  reservationsByRun.delete(runId)
  decreaseInflight(r.userId, r.reservedTokens, r.reservedCostUsd)
}

// Used when we reserved synchronously but startRun threw before we had a
// runId to register against — releases by amount instead of by id.
function releaseReservationByAmount(userId, reservedTokens, reservedCostUsd) {
  decreaseInflight(userId, reservedTokens, reservedCostUsd)
}

function decreaseInflight(userId, reservedTokens, reservedCostUsd) {
  const inflight = inflightByUser.get(userId)
  if (!inflight) return
  const tokens = inflight.tokens - reservedTokens
  const costUsd = inflight.costUsd - reservedCostUsd
  if (tokens <= 0 && costUsd <= 0) {
    inflightByUser.delete(userId)
  } else {
    inflightByUser.set(userId, { tokens, costUsd })
  }
}

function buildProjectContext(project) {
  const { docs } = ProjectEntityHandler.getAllEntitiesFromProject(project)
  const files = docs
    .map(({ path, doc }) => ({
      path: normalizeProjectPath(path),
      docId: doc._id.toString(),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  return {
    projectName: project.name ?? '',
    compiler: project.compiler ?? 'pdflatex',
    files,
  }
}

// Force any pending doc-updater / project-history ops to land in history-v1,
// then read the resulting end version. Returns null on any failure: rollback
// for this turn just won't be offered, and the user message still records.
//
// The history-v1 `/latest/history` endpoint returns
// `{ chunk: { history: { changes: [...] }, startVersion } }` — no top-level
// endVersion. The current end version is `startVersion + changes.length`.
async function captureProjectVersion(projectId) {
  try {
    await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
    await HistoryManager.promises.flushProject(projectId)
    const history = await HistoryManager.promises.getLatestHistory(projectId)
    const startVersion = history?.chunk?.startVersion
    const changeCount = history?.chunk?.history?.changes?.length
    if (typeof startVersion !== 'number' || typeof changeCount !== 'number') {
      logger.warn(
        { projectId, historyKeys: Object.keys(history?.chunk ?? {}) },
        'unexpected getLatestHistory response shape; ' +
          'cannot derive end version for agent rollback'
      )
      return null
    }
    return startVersion + changeCount
  } catch (err) {
    logger.warn(
      { err, projectId },
      'failed to capture project history version for agent rollback; ' +
        'rollback to this message will be unavailable'
    )
    return null
  }
}

async function buildAgentChatHistory(projectId, conversationId, excludeMessageId) {
  let thread
  try {
    thread = await ChatApiHandler.promises.getThread(projectId, conversationId)
  } catch (err) {
    if (err?.statusCode === 404 || err?.response?.status === 404) return []
    throw err
  }
  const meta = await AgentConversationManager.promises.getMessageMetadata(
    projectId,
    conversationId
  )
  return (thread.messages ?? [])
    .filter(m => m.id !== excludeMessageId)
    .map(m => {
      const info = meta.get(m.id) ?? { role: 'user', runId: null }
      return {
        id: m.id,
        user_id: m.user_id,
        content: m.content,
        timestamp: m.timestamp,
        role: info.role,
        runId: info.runId,
      }
    })
}

async function sendMessage(req, res) {
  const { project_id: projectId } = req.params
  const { message, selection, conversationId: bodyConversationId } = req.body

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'message is required' })
  }

  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(403).json({ error: 'not logged in' })
  }

  // Block before any side effects (chat message, conversation creation, etc.)
  // so a quota-exceeded user doesn't leave an orphan user message in the
  // thread waiting for a reply that will never come.
  //
  // The reservation must register SYNCHRONOUSLY after the getUser await —
  // any await between read and write here would re-open the TOCTOU race
  // that tryReserveQuota is designed to close.
  const userForQuota = await UserGetter.promises.getUser(userId, {
    agentQuota: 1,
  })
  const reservation = tryReserveQuota(userId, userForQuota?.agentQuota)
  if (!reservation.ok) {
    return res.status(402).json({
      error: 'agent_quota_exceeded',
      reason: reservation.reason,
      message:
        reservation.reason === 'cost'
          ? 'You have reached your agent cost limit. Please contact an administrator to raise it.'
          : 'You have reached your agent output-token limit. Please contact an administrator to raise it.',
      quota: reservation.quota,
    })
  }

  // From here on, anything that throws must release the reservation —
  // otherwise the user's in-flight count leaks until process restart.
  let runRegistered = false
  try {
    const conversationId =
      bodyConversationId ?? new ObjectId().toHexString()
    const conversation =
      await AgentConversationManager.promises.ensureConversation(
        projectId,
        conversationId,
        userId,
        message
      )

    const project = await ProjectGetter.promises.getProject(projectId, {
      name: 1,
      compiler: 1,
      rootFolder: 1,
    })
    if (!project) {
      releaseReservationByAmount(
        userId,
        reservation.reservedTokens,
        reservation.reservedCostUsd
      )
      return res.status(404).json({ error: 'project not found' })
    }
    const context = buildProjectContext(project)

    const chatMessage = await ChatApiHandler.promises.sendComment(
      projectId,
      conversationId,
      userId,
      message
    )

    const user = await UserInfoManager.promises.getPersonalInfo(
      chatMessage.user_id
    )
    chatMessage.user = UserInfoController.formatPersonalInfo(user)

    // Capture the project's history version so we can offer rollback to this
    // point later. The two flushes here make sure any in-flight ops from the
    // user (or a prior accept-on-edit pass) are in history-v1 before we read
    // the version. Failures must not block the user message — rollback simply
    // won't be offered for this message.
    const projectVersionBefore = await captureProjectVersion(projectId)

    await AgentConversationManager.promises.recordMessage(
      projectId,
      conversationId,
      chatMessage,
      'user',
      null,
      projectVersionBefore
    )

    EditorRealTimeController.emitToRoom(projectId, 'agent:message', {
      conversationId,
      conversation,
      message: {
        ...chatMessage,
        role: 'user',
        ...(typeof projectVersionBefore === 'number'
          ? { projectVersionBefore }
          : {}),
      },
    })

    // Build chat history for the agent. The chat thread alone does not carry
    // role information (agent messages are stored with the human user_id), and
    // tool calls/outputs from prior assistant turns are not in the chat thread
    // at all. We assemble both here and pass them in the run payload so the
    // agent sees a coherent multi-turn context.
    const chatHistory = await buildAgentChatHistory(
      projectId,
      conversationId,
      chatMessage.id
    )

    const { runId } = await LlmAgentApiHandler.promises.startRun(projectId, {
      userId,
      conversationId,
      userMessage: message,
      selection: selection ?? undefined,
      context,
      chatHistory,
    })
    registerReservation(
      runId,
      userId,
      reservation.reservedTokens,
      reservation.reservedCostUsd
    )
    runRegistered = true
    await AgentConversationManager.promises.recordRun(
      projectId,
      conversationId,
      runId
    )

    res.status(202).json({ runId, messageId: chatMessage.id, conversationId })
  } catch (err) {
    // If we never made it as far as runId (or even if we did, the
    // run-complete callback will release once it fires — releasing here
    // would double-release). Only release if no runId is registered yet.
    if (!runRegistered) {
      releaseReservationByAmount(
        userId,
        reservation.reservedTokens,
        reservation.reservedCostUsd
      )
    }
    throw err
  }
}

async function createConversation(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(403).json({ error: 'not logged in' })
  }

  const conversation =
    await AgentConversationManager.promises.createConversation(projectId, userId)
  res.status(201).json(conversation)
}

async function listConversations(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(403).json({ error: 'not logged in' })
  }
  const conversations =
    await AgentConversationManager.promises.listConversations(projectId, userId)
  res.json(conversations)
}

async function cancelRun(req, res) {
  const {
    project_id: projectId,
    conversation_id: conversationId,
    run_id: runId,
  } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(403).json({ error: 'not logged in' })
  }
  // Auth: the requesting user must own the conversation, and the runId must
  // be the conversation's currently-active run (set by recordRun on each
  // startRun and never re-pointed elsewhere). This prevents a project
  // collaborator from cancelling another user's run by guessing the runId.
  const conversation = await AgentConversationManager.promises.getConversation(
    projectId,
    conversationId,
    userId
  )
  if (!conversation) {
    return res.status(404).json({ error: 'agent conversation not found' })
  }
  if (!runId || conversation.lastRunId !== runId) {
    return res
      .status(404)
      .json({ error: 'run not found on this conversation' })
  }
  try {
    const result = await LlmAgentApiHandler.promises.cancelRun(projectId, runId)
    res.status(202).json(result)
  } catch (err) {
    // 404 from llm-agent means the run is already gone — treat as success
    // from the caller's perspective.
    if (err?.response?.status === 404 || err?.statusCode === 404) {
      return res.status(202).json({ cancelled: false })
    }
    throw err
  }
}

async function agentCancelled(req, res) {
  const { project_id: projectId } = req.params
  const { conversationId, runId, userId, outputTokensDelta, costUsdDelta } =
    req.body
  if (!conversationId || !runId) {
    return res
      .status(400)
      .json({ error: 'conversationId and runId required' })
  }
  // Apply delta FIRST so any concurrent gate that reads dbUsed sees the
  // billed value, THEN release the reservation. The other order would
  // briefly under-count the user (delta not yet billed, reservation
  // already gone) and let a concurrent request slip through.
  await applyUsageDelta(userId, outputTokensDelta, costUsdDelta)
  releaseReservationByRunId(runId)
  // Mark the run as cancelled on the conversation so getActiveRunId
  // doesn't classify it as in-flight. Without this, the rollback
  // endpoint's in-flight guard would permanently 409 after cancel
  // (no assistant message ever lands for a cancelled run, so the
  // "completed" check stays false forever).
  try {
    await AgentConversationManager.promises.markRunCancelled(
      projectId,
      conversationId,
      runId
    )
  } catch (err) {
    logger.warn(
      { err, projectId, conversationId, runId },
      'agentCancelled: failed to mark run cancelled on the conversation'
    )
  }
  EditorRealTimeController.emitToRoom(projectId, 'agent:cancelled', {
    conversationId,
    runId,
  })
  res.sendStatus(204)
}

async function deleteConversation(req, res) {
  const { project_id: projectId, conversation_id: conversationId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(403).json({ error: 'not logged in' })
  }
  // Scope the delete to the requesting user. Without this, any collaborator
  // with read access to the project could delete any other user's conversation
  // by guessing the conversationId.
  const conversation = await AgentConversationManager.promises.getConversation(
    projectId,
    conversationId,
    userId
  )
  if (!conversation) {
    return res.status(404).json({ error: 'agent conversation not found' })
  }
  const deletedCount = await AgentConversationManager.promises.deleteConversation(
    projectId,
    conversationId
  )
  if (!deletedCount) {
    return res.status(404).json({ error: 'agent conversation not found' })
  }
  res.sendStatus(204)
}

// Steps arrive over HTTP, so Date fields are ISO strings after JSON parsing,
// not Date instances — `.getTime()` would be undefined on them.
function toEpochMs(value) {
  if (value == null) return null
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

// A toolResult counts as an error if it was never written (the tool crashed
// or the run was interrupted before it returned), if it carries an explicit
// `error` field, or if its output object signals failure.
function toolResultStatus(result) {
  if (!result) return 'error'
  if (result.error) return 'error'
  if (result.output && typeof result.output === 'object' && result.output.error) {
    return 'error'
  }
  return 'completed'
}

function buildToolEvents(steps) {
  const events = []
  for (const step of steps) {
    const output = step.output
    if (!output) continue
    const toolCalls = output.toolCalls ?? []
    const resultsById = new Map(
      (output.toolResults ?? []).map(r => [r.toolCallId, r])
    )
    for (const tc of toolCalls) {
      events.push({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        status: toolResultStatus(resultsById.get(tc.toolCallId)),
        input: tc.input ?? tc.args ?? {},
        timestamp:
          toEpochMs(step.finishedAt) ?? toEpochMs(step.startedAt) ?? Date.now(),
      })
    }
  }
  return events
}

async function getConversationMessages(req, res) {
  const { project_id: projectId, conversation_id: conversationId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(403).json({ error: 'not logged in' })
  }
  const conversation = await AgentConversationManager.promises.getConversation(
    projectId,
    conversationId,
    userId
  )
  if (!conversation) {
    return res.status(404).json({ error: 'agent conversation not found' })
  }

  let thread
  try {
    thread = await ChatApiHandler.promises.getThread(projectId, conversationId)
  } catch (err) {
    if (err?.statusCode === 404 || err?.response?.status === 404) {
      return res.json([])
    }
    throw err
  }

  await ChatManager.promises.injectUserInfoIntoThreads({
    [conversationId]: thread,
  })
  const meta = await AgentConversationManager.promises.getMessageMetadata(
    projectId,
    conversationId
  )
  const enrichedMessages = await Promise.all(
    thread.messages.map(async message => {
      const info = meta.get(message.id) ?? {
        role: message.user_id ? 'user' : 'assistant',
        runId: null,
        projectVersionBefore: null,
      }
      const baseExtras =
        info.role === 'user' &&
        typeof info.projectVersionBefore === 'number'
          ? { projectVersionBefore: info.projectVersionBefore }
          : {}
      if (info.role !== 'assistant' || !info.runId) {
        return { ...message, role: info.role, ...baseExtras }
      }
      let toolEvents = []
      let questions = null
      try {
        const run = await LlmAgentApiHandler.promises.getRunSteps(
          projectId,
          info.runId
        )
        const { steps } = run
        if (run.output?.type === 'question' && Array.isArray(run.output.questions)) {
          questions = run.output.questions
        }
        toolEvents = buildToolEvents(steps)
      } catch {
        // Non-fatal: run steps may not exist if the run was pruned or the
        // llm-agent service is unavailable. Return the message without toolEvents.
      }
      return {
        ...message,
        role: info.role,
        runId: info.runId,
        ...(questions ? { questions } : {}),
        ...baseExtras,
        ...(toolEvents.length > 0 ? { toolEvents } : {}),
      }
    })
  )
  res.json(enrichedMessages)
}

// Restore the project to the version that was recorded against this user
// message and discard the message (plus everything after it) from the
// conversation. Reuses the existing `RestoreManager.revertProject` primitive
// so file create/delete/move *and* accepted tracked changes all unwind in
// one shot — see the plan in
// .claude/plans/study-the-track-changes-implementation-swirling-peacock.md
// for why surgical change-tagging is the wrong primitive here.
async function rollbackToMessage(req, res) {
  const {
    project_id: projectId,
    conversation_id: conversationId,
    message_id: messageId,
  } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(403).json({ error: 'not logged in' })
  }

  const targetMessage = await AgentConversationManager.promises.findUserMessage(
    projectId,
    conversationId,
    messageId,
    userId
  )
  if (!targetMessage) {
    return res.status(404).json({ error: 'message not found' })
  }
  if (targetMessage.role !== 'user') {
    return res
      .status(400)
      .json({ error: 'rollback target must be a user message' })
  }
  if (typeof targetMessage.projectVersionBefore !== 'number') {
    return res.status(400).json({
      error: 'no_recorded_version',
      message:
        'This message was sent before rollback was supported. Rollback is ' +
        'unavailable here.',
    })
  }

  // Server-side guard against rolling back mid-run. The frontend disables
  // the button while `isGenerating`, but a direct API hit (or stale frontend
  // state) could otherwise revert files the agent is actively writing.
  // A run is "in flight" when the conversation's lastRunId hasn't yet been
  // matched by a recorded assistant message.
  const activeRunId = await AgentConversationManager.promises.getActiveRunId(
    projectId,
    conversationId
  )
  if (activeRunId) {
    return res.status(409).json({
      error: 'run_in_flight',
      message:
        'The agent is still working on this conversation. Cancel the ' +
        'current run before rolling back.',
    })
  }

  // Pre-check `rangesSupportEnabled` ourselves rather than relying on
  // string-matching `RestoreManager.revertProject`'s OError message.
  // The upstream throws `new OError('project does not have ranges
  // support', ...)` today; if that wording changes we'd silently fall
  // through to the generic 500 path. A typed pre-check + a kept-as-fallback
  // string match makes the error mapping resilient.
  const project = await ProjectGetter.promises.getProject(projectId, {
    'overleaf.history.rangesSupportEnabled': 1,
  })
  if (!project?.overleaf?.history?.rangesSupportEnabled) {
    return res.status(400).json({
      error: 'history_not_supported',
      message:
        'This project does not have ranges-aware history enabled, so ' +
        'rollback is unavailable.',
    })
  }

  const version = targetMessage.projectVersionBefore

  // Revert the project first — this is the expensive, risky step. If it
  // fails we leave the conversation intact so the user can retry.
  try {
    await RestoreManager.promises.revertProject(userId, projectId, version)
  } catch (err) {
    logger.error(
      { err, projectId, conversationId, messageId, version },
      'agent rollback: revertProject failed'
    )
    // Belt-and-suspenders: if the project's rangesSupport state changed
    // between our pre-check and revertProject (very unlikely but possible
    // — e.g. an admin toggling it off mid-request), still map the error
    // back to the typed code.
    if (err?.message?.includes('ranges support')) {
      return res.status(400).json({
        error: 'history_not_supported',
        message:
          'This project does not have ranges-aware history enabled, so ' +
          'rollback is unavailable.',
      })
    }
    return res
      .status(500)
      .json({ error: 'rollback_failed', message: 'Project restore failed.' })
  }

  // Truncate the agent-conversation metadata. After this, getMessageMetadata
  // will no longer return the rolled-back messages, so subsequent agent
  // turns won't replay them.
  //
  // We're in a partial-success window here: revertProject already
  // committed the project files. If truncate throws (e.g. mongo
  // unavailable), the convo would silently retain the rolled-back
  // messages — the next turn would then replay tool calls referencing
  // files that no longer exist in the project state. Surface this as a
  // distinct `rollback_partial` so the frontend can warn the user to
  // refresh instead of leaving them with mismatched client + server
  // state. The realtime event is also emitted in `partial: true` form
  // so other tabs at least know the project changed.
  let removedMessageIds
  try {
    removedMessageIds =
      await AgentConversationManager.promises.truncateFromMessage(
        projectId,
        conversationId,
        targetMessage.createdAt
      )
  } catch (err) {
    logger.error(
      { err, projectId, conversationId, messageId, version },
      'agent rollback: truncateFromMessage failed AFTER successful revertProject — partial state'
    )
    EditorRealTimeController.emitToRoom(
      projectId,
      'agent:conversation-rolled-back',
      {
        conversationId,
        rolledBackToMessageId: messageId,
        rolledBackToVersion: version,
        removedMessageIds: [],
        partial: true,
      }
    )
    return res.status(500).json({
      error: 'rollback_partial',
      message:
        'Project files were restored, but cleaning up the conversation ' +
        'failed. Refresh the page to sync your view.',
      rolledBackToVersion: version,
    })
  }

  // Best-effort cleanup of the chat-service thread. A failure here leaves
  // dangling chat messages, but the agent-side conversation is already
  // truncated and the next sendMessage will work — the only visible cost is
  // stale chat entries. Log and continue.
  for (const removedId of removedMessageIds) {
    try {
      await ChatApiHandler.promises.deleteMessage(
        projectId,
        conversationId,
        removedId
      )
    } catch (err) {
      logger.warn(
        { err, projectId, conversationId, removedId },
        'agent rollback: failed to delete chat-service message'
      )
    }
  }

  ProjectAuditLogHandler.addEntryIfManagedInBackground(
    projectId,
    'project-history-version-restored',
    userId,
    req.ip,
    {
      version,
      scope: 'agent-rollback',
      conversationId,
      rolledBackToMessageId: messageId,
      removedMessageCount: removedMessageIds.length,
    }
  )

  EditorRealTimeController.emitToRoom(
    projectId,
    'agent:conversation-rolled-back',
    {
      conversationId,
      rolledBackToMessageId: messageId,
      rolledBackToVersion: version,
      removedMessageIds,
    }
  )

  return res.json({
    rolledBackToVersion: version,
    rolledBackToMessageId: messageId,
    removedMessageIds,
  })
}

// Called by llm-agent service after run completes — emits reply over WebSocket.
// Accepts either:
// - { conversationId, messageId } to re-emit an existing chat message
// - { conversationId, userId, content } to create and emit a new chat message
async function agentComplete(req, res) {
  const { project_id: projectId } = req.params
  const {
    conversationId,
    messageId,
    userId,
    content,
    runId,
    questions,
    outputTokensDelta,
    costUsdDelta,
  } = req.body
  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId required' })
  }

  // Bill the actual usage first, then release the in-flight reservation
  // — keeps the per-user projection (dbUsed + inflight) monotonically
  // consistent for a concurrent gate that fires between these two writes.
  await applyUsageDelta(userId, outputTokensDelta, costUsdDelta)
  if (runId) releaseReservationByRunId(runId)

  let message
  if (messageId) {
    message = await ChatApiHandler.promises.getThreadMessage(
      projectId,
      conversationId,
      messageId
    )
  } else if (userId && typeof content === 'string' && content.trim() !== '') {
    message = await ChatApiHandler.promises.sendComment(
      projectId,
      conversationId,
      userId,
      content
    )
    const user = await UserInfoManager.promises.getPersonalInfo(message.user_id)
    message.user = UserInfoController.formatPersonalInfo(user)
  } else {
    return res
      .status(400)
      .json({ error: 'messageId or (userId and content) required' })
  }

  if (!message) {
    return res.status(500).json({
      error: 'agent completion message was not found',
    })
  }

  await AgentConversationManager.promises.recordMessage(
    projectId,
    conversationId,
    message,
    'assistant',
    runId
  )
  const updatedConversation =
    await AgentConversationManager.promises.getConversation(
      projectId,
      conversationId
    )
  EditorRealTimeController.emitToRoom(projectId, 'agent:message', {
    conversationId,
    conversation: updatedConversation,
    message: {
      ...message,
      role: 'assistant',
      runId,
      ...(Array.isArray(questions) && questions.length > 0 ? { questions } : {}),
    },
  })
  res.sendStatus(204)
}

async function agentToolCall(req, res) {
  const { project_id: projectId } = req.params
  const {
    conversationId,
    runId,
    toolCallId,
    toolName,
    status,
    input,
    output,
    error,
  } = req.body
  if (!conversationId || !runId || !toolName || !status) {
    return res
      .status(400)
      .json({ error: 'conversationId, runId, toolName and status required' })
  }

  EditorRealTimeController.emitToRoom(projectId, 'agent:tool-call', {
    conversationId,
    runId,
    toolCallId,
    toolName,
    status,
    input,
    output,
    error,
    timestamp: Date.now(),
  })
  res.sendStatus(204)
}

async function agentAcceptChanges(req, res) {
  const { project_id: projectId } = req.params
  const { docId, changeIds, userId } = req.body
  if (!docId || !Array.isArray(changeIds) || !userId) {
    return res
      .status(400)
      .json({ error: 'docId, changeIds and userId required' })
  }

  const response = await DocumentUpdaterHandler.promises.acceptChanges(
    projectId,
    docId,
    changeIds,
    userId
  )

  EditorRealTimeController.emitToRoom(
    projectId,
    'accept-changes',
    docId,
    response.acceptedChangeIds
  )

  res.json(response)
}

async function agentCreateFile(req, res) {
  const { project_id: projectId } = req.params
  const { path, content, userId } = req.body
  if (!path || !userId) {
    return res.status(400).json({ error: 'path and userId required' })
  }
  const lines = content ? content.split('\n') : []
  // upsertDocWithPath expects an absolute path — Path.dirname('main.tex') returns '.'
  // which mkdirp rejects, so we normalise here the same way TPDS does.
  const absPath = path.startsWith('/') ? path : '/' + path
  const { doc } = await EditorController.promises.upsertDocWithPath(
    projectId,
    absPath,
    lines,
    'llm-agent',
    userId
  )
  res.status(201).json({ path, docId: doc._id.toString() })
}

async function agentDeleteFile(req, res) {
  const { project_id: projectId } = req.params
  const { path, userId } = req.body
  if (!path || !userId) {
    return res.status(400).json({ error: 'path and userId required' })
  }
  try {
    await EditorController.promises.deleteEntityWithPath(
      projectId,
      path,
      'llm-agent',
      userId
    )
  } catch (err) {
    if (err.message?.includes('not found') || err.name === 'NotFoundError') {
      return res.status(404).json({ error: 'not found' })
    }
    throw err
  }
  res.sendStatus(204)
}

async function agentMoveFile(req, res) {
  const { project_id: projectId } = req.params
  const { oldPath, newPath, userId } = req.body
  if (!oldPath || !newPath || !userId) {
    return res.status(400).json({ error: 'oldPath, newPath and userId required' })
  }

  const { element, type, folder } =
    await ProjectLocator.promises.findElementByPath({
    project_id: projectId,
    path: oldPath,
  })
  if (!element) {
    return res.status(404).json({ error: 'not found' })
  }

  const oldName = oldPath.split('/').pop()
  const newName = newPath.split('/').pop()
  const newDir = newPath.includes('/')
    ? newPath.slice(0, newPath.lastIndexOf('/'))
    : ''
  const oldDir = oldPath.includes('/')
    ? oldPath.slice(0, oldPath.lastIndexOf('/'))
    : ''

  const entityId = element._id.toString()
  const oldFolderId = folder?._id?.toString()

  // Resolve destination folder before any mutation to reduce partial-state risk.
  let destinationFolderId
  if (oldDir !== newDir) {
    const { lastFolder } = await EditorController.promises.mkdirp(
      projectId,
      newDir || '/',
      userId
    )
    destinationFolderId = lastFolder._id.toString()
  }

  let moved = false
  try {
    if (destinationFolderId && oldFolderId && oldFolderId !== destinationFolderId) {
      await EditorController.promises.moveEntity(
        projectId,
        entityId,
        destinationFolderId,
        type,
        userId,
        'llm-agent'
      )
      moved = true
    }

    if (oldName !== newName) {
      await EditorController.promises.renameEntity(
        projectId,
        entityId,
        type,
        newName,
        userId,
        'llm-agent'
      )
    }
  } catch (err) {
    if (moved && oldFolderId && destinationFolderId && oldFolderId !== destinationFolderId) {
      try {
        await EditorController.promises.moveEntity(
          projectId,
          entityId,
          oldFolderId,
          type,
          userId,
          'llm-agent-rollback'
        )
      } catch {
        // If rollback fails we still propagate the original error.
      }
    }
    throw err
  }

  res.sendStatus(204)
}

function clsiUrl(projectId, userId, action) {
  const clsiUserId = Settings.disablePerUserCompiles ? undefined : userId
  const base = Settings.apis.clsi.url
  const prefix = clsiUserId
    ? `/project/${projectId}/user/${clsiUserId}`
    : `/project/${projectId}`
  return `${base}${prefix}/${action}`
}

/**
 * Base URL for fetching CLSI output files (output.log, *.blg, etc.) — the
 * same target web's _proxyToClsiWithLimits hits for non-zip output.
 *
 * Defensive fallback: develop/dev.env sets DOWNLOAD_HOST to a full URL
 * because services/clsi/config/settings.defaults.cjs treats it that way.
 * services/web's settings template (settings.defaults.js:248) instead
 * expects a hostname and re-wraps it as `http://${DOWNLOAD_HOST}:8080`,
 * producing `http://http://clsi-nginx:8080:8080` in dev. The frontend never
 * notices because webpack proxies /build/* to clsi-nginx directly. We need
 * a real URL on the backend, so detect the malformed case and fall back to
 * the raw env value.
 */
function clsiOutputBaseUrl() {
  const v = Settings.apis.clsi.downloadHost
  try {
    const parsed = new URL(v)
    // node's URL is permissive: 'http://http://clsi-nginx:8080:8080' parses
    // as host='http', pathname='//clsi-nginx:8080:8080'. Reject the case
    // where the host itself looks like a scheme.
    if (/^https?$/i.test(parsed.host)) throw new Error('malformed')
    return v
  } catch {
    return process.env.DOWNLOAD_HOST || v
  }
}

async function internalCompile(req, res) {
  const { project_id: projectId } = req.params
  const { userId, rootDoc_id: rootDocId, stopOnFirstError } = req.body
  if (!userId) {
    return res.status(400).json({ error: 'userId required' })
  }
  const compileOptions = { isAutoCompile: false, fileLineErrors: true }
  if (rootDocId) compileOptions.rootDoc_id = rootDocId
  if (stopOnFirstError) compileOptions.stopOnFirstError = true
  const result = await AgentCompileCoordinator.compile(
    projectId,
    userId,
    compileOptions
  )
  const { status, outputFiles = [] } = result

  // Parse logs the same way the editor does — same parsers, same byte stream
  // (output.log + every *.blg) — so the LLM sees what the user sees.
  const { errors, warnings, typesetting } = await parseCompileLogs(
    outputFiles,
    clsiOutputBaseUrl(),
    { stoppedOnFirstError: status === 'stopped-on-first-error' }
  )

  let pageCount = null
  if (status === 'success') {
    try {
      const infoRes = await fetch(clsiUrl(projectId, userId, 'pdf-info'))
      if (infoRes.ok) {
        const info = await infoRes.json()
        pageCount = info.pageCount ?? null
      }
    } catch {
      // non-fatal — pageCount stays null
    }
  }

  res.json({
    success: status === 'success',
    status,
    errors,
    warnings,
    typesetting,
    pageCount,
  })
}

async function agentPdfPage(req, res) {
  const { project_id: projectId } = req.params
  const { userId, page: pageStr } = req.query
  const page = parseInt(pageStr, 10)
  if (!userId || !page || page < 1) {
    return res
      .status(400)
      .json({ error: 'userId and page (1-indexed) query params required' })
  }
  let clsiRes
  try {
    clsiRes = await fetch(
      `${clsiUrl(projectId, userId, 'pdf-page')}?page=${page}`
    )
  } catch {
    return res.status(502).json({ error: 'CLSI unreachable' })
  }
  if (clsiRes.status === 404 || clsiRes.status === 416) {
    const body = await clsiRes
      .json()
      .catch(() => ({ error: clsiRes.statusText || 'CLSI error' }))
    return res.status(clsiRes.status).json(body)
  }
  if (!clsiRes.ok) {
    return res.status(502).json({ error: 'CLSI error' })
  }
  let buf
  try {
    buf = Buffer.from(await clsiRes.arrayBuffer())
  } catch {
    return res.status(502).json({ error: 'CLSI error' })
  }
  res.json({ imageBase64: buf.toString('base64'), mimeType: 'image/png' })
}

async function agentCreateProject(req, res) {
  const { userId, projectName, docLines } = req.body
  if (!userId || !projectName) {
    return res.status(400).json({ error: 'userId and projectName required' })
  }
  if (docLines != null && !Array.isArray(docLines)) {
    return res.status(400).json({ error: 'docLines must be an array of strings' })
  }
  const lines = docLines ?? ['\\documentclass{article}', '\\begin{document}', '\\end{document}']
  const project = await ProjectCreationHandler.promises.createProjectFromSnippet(
    userId,
    projectName,
    lines
  )
  res.json({ projectId: project._id.toString() })
}

async function agentSyntaxCheck(req, res) {
  const { project_id: projectId } = req.params
  const scopePath = req.query.path ?? null
  const result = await SyntaxChecker.check(projectId, scopePath)
  res.json(result)
}

export default {
  createConversation: expressify(createConversation),
  listConversations: expressify(listConversations),
  deleteConversation: expressify(deleteConversation),
  getConversationMessages: expressify(getConversationMessages),
  rollbackToMessage: expressify(rollbackToMessage),
  sendMessage: expressify(sendMessage),
  cancelRun: expressify(cancelRun),
  agentComplete: expressify(agentComplete),
  agentCancelled: expressify(agentCancelled),
  agentToolCall: expressify(agentToolCall),
  agentAcceptChanges: expressify(agentAcceptChanges),
  agentCreateFile: expressify(agentCreateFile),
  agentDeleteFile: expressify(agentDeleteFile),
  agentMoveFile: expressify(agentMoveFile),
  internalCompile: expressify(internalCompile),
  agentPdfPage: expressify(agentPdfPage),
  agentSyntaxCheck: expressify(agentSyntaxCheck),
  agentCreateProject: expressify(agentCreateProject),
}
