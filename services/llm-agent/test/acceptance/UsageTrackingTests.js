// @ts-check
//
// End-to-end test for per-run usage tracking:
// - createRun must seed totalInputTokens/totalOutputTokens/totalCostUsd = 0
// - incrementUsage must $inc those fields atomically and accumulate over
//   multiple calls (one per LLM step).
//
// Run against the real MongoDB instance the agent service connects to (see
// AgentApp.ensureRunning). MongoHelper clears agent_runs before the suite.

import { ObjectId } from '../../app/js/mongodb.js'
import { expect } from 'chai'
import * as AgentApp from './helpers/AgentApp.js'
import './helpers/MongoHelper.js'
import {
  createRun,
  incrementUsage,
  finalizeRun,
} from '../../app/js/AgentStore.js'

describe('AgentStore — per-run usage tracking', function () {
  before(async function () {
    // Ensures mongoClient is connected even though we do not need the HTTP
    // server itself for these store-level tests.
    await AgentApp.ensureRunning()
  })

  function baseInput() {
    return {
      projectId: new ObjectId().toString(),
      userId: new ObjectId().toString(),
      conversationId: new ObjectId().toString(),
      userMessage: 'usage tracking test',
    }
  }

  it('initialises total token + cost counters to 0 on createRun', async function () {
    const input = baseInput()
    const runId = await createRun(input.projectId, input)

    const doc = await AgentApp.db.agentRuns.findOne({
      _id: new ObjectId(runId),
    })
    expect(doc).to.exist
    expect(doc.totalInputTokens).to.equal(0)
    expect(doc.totalOutputTokens).to.equal(0)
    expect(doc.totalCostUsd).to.equal(0)
  })

  it('atomically $inc s totals on incrementUsage', async function () {
    const input = baseInput()
    const runId = await createRun(input.projectId, input)

    await incrementUsage(runId, {
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0.0012,
    })

    const doc = await AgentApp.db.agentRuns.findOne({
      _id: new ObjectId(runId),
    })
    expect(doc.totalInputTokens).to.equal(100)
    expect(doc.totalOutputTokens).to.equal(200)
    expect(doc.totalCostUsd).to.be.closeTo(0.0012, 1e-12)
  })

  it('accumulates totals across multiple incrementUsage calls (multi-step run)', async function () {
    const input = baseInput()
    const runId = await createRun(input.projectId, input)

    await incrementUsage(runId, { inputTokens: 10, outputTokens: 20, costUsd: 0.001 })
    await incrementUsage(runId, { inputTokens: 30, outputTokens: 40, costUsd: 0.002 })
    await incrementUsage(runId, { inputTokens: 5, outputTokens: 7, costUsd: 0.0005 })

    const doc = await AgentApp.db.agentRuns.findOne({
      _id: new ObjectId(runId),
    })
    expect(doc.totalInputTokens).to.equal(45)
    expect(doc.totalOutputTokens).to.equal(67)
    expect(doc.totalCostUsd).to.be.closeTo(0.0035, 1e-12)
  })

  it('treats missing delta fields as 0 (no NaN propagation)', async function () {
    const input = baseInput()
    const runId = await createRun(input.projectId, input)

    // Pass only inputTokens; outputTokens and costUsd should default to 0.
    await incrementUsage(runId, { inputTokens: 42 })

    const doc = await AgentApp.db.agentRuns.findOne({
      _id: new ObjectId(runId),
    })
    expect(doc.totalInputTokens).to.equal(42)
    expect(doc.totalOutputTokens).to.equal(0)
    expect(doc.totalCostUsd).to.equal(0)
  })

  it('totals survive finalizeRun (which only $sets status/output/timing fields)', async function () {
    const input = baseInput()
    const runId = await createRun(input.projectId, input)

    await incrementUsage(runId, {
      inputTokens: 7,
      outputTokens: 11,
      costUsd: 0.0007,
    })
    await finalizeRun(
      runId,
      { type: 'text', content: 'all done' },
      new Date(Date.now() - 1000)
    )

    const doc = await AgentApp.db.agentRuns.findOne({
      _id: new ObjectId(runId),
    })
    expect(doc.status).to.equal('done')
    expect(doc.totalInputTokens).to.equal(7)
    expect(doc.totalOutputTokens).to.equal(11)
    expect(doc.totalCostUsd).to.be.closeTo(0.0007, 1e-12)
  })

  it('parallel $inc s from concurrent steps do not lose updates', async function () {
    const input = baseInput()
    const runId = await createRun(input.projectId, input)

    const N = 20
    await Promise.all(
      Array.from({ length: N }, () =>
        incrementUsage(runId, { inputTokens: 1, outputTokens: 2, costUsd: 0.0001 })
      )
    )

    const doc = await AgentApp.db.agentRuns.findOne({
      _id: new ObjectId(runId),
    })
    expect(doc.totalInputTokens).to.equal(N)
    expect(doc.totalOutputTokens).to.equal(2 * N)
    expect(doc.totalCostUsd).to.be.closeTo(N * 0.0001, 1e-9)
  })
})
