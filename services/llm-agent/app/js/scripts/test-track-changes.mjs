#!/usr/bin/env node
/**
 * E2E test for agentReplace track-changes consolidation.
 *
 * Each scenario seeds a fresh doc, runs a sequence of agent edits, then reads
 * the live ranges from doc-updater and asserts that for every "touched" region
 * the stored tracked changes form a single clean (insert NEWEST, delete OLDEST)
 * pair — no absorbed inserts, no shrunk delete content, no position drift.
 *
 * Runs INSIDE the llm-agent container.
 *
 * Usage:
 *   docker exec $(cd develop && docker compose ps -q llm-agent) \
 *     node /overleaf/services/llm-agent/app/js/scripts/test-track-changes.mjs
 */

import { MongoClient, ObjectId } from 'mongodb'
import { editFile } from '../tools/edit_file.js'

// ── Config ────────────────────────────────────────────────────────────────────
const WEB_URL = `http://${process.env.WEB_HOST || 'web'}:3000`
const DOCUP_URL = `http://${process.env.DOCUMENT_UPDATER_HOST || 'document-updater'}:3003`
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo/sharelatex'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'agent-tools-test@overleaf.dev'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ToolsTest!1'

// ── Logging ───────────────────────────────────────────────────────────────────
const ok = msg => console.log(`  ✓  ${msg}`)
const info = msg => console.log(`  ·  ${msg}`)
const fail = msg => {
  console.error(`  ✗  ${msg}`)
  process.exit(1)
}
function assert(cond, msg) {
  if (!cond) fail(msg)
  else ok(msg)
}
function step(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`)
}

// ── HTTP helpers (cookie-jar aware) ──────────────────────────────────────────
const cookieJar = new Map()
function updateCookies(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [nv] = raw.split(';')
    const eq = nv.indexOf('=')
    cookieJar.set(nv.slice(0, eq).trim(), nv.slice(eq + 1).trim())
  }
}
function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}
let csrfToken = ''
async function webGet(path) {
  const res = await fetch(`${WEB_URL}${path}`, {
    headers: { Cookie: cookieHeader() },
    redirect: 'manual',
  })
  updateCookies(res)
  return res
}
async function webPost(path, body) {
  const res = await fetch(`${WEB_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(),
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  })
  updateCookies(res)
  return res
}

// ── Auth + project setup ─────────────────────────────────────────────────────
let activeUserId = null
async function ensureUser(mongo) {
  const users = mongo.db().collection('users')
  const existing = await users.findOne({ email: ADMIN_EMAIL })
  if (!existing) fail(`expected user ${ADMIN_EMAIL} to exist (run test-tools.mjs first)`)
  await users.updateOne(
    { _id: existing._id },
    { $set: { isAdmin: true, 'features.compileTimeout': 60 } }
  )
  activeUserId = existing._id
}
async function login() {
  const csrfRes = await webGet('/dev/csrf')
  csrfToken = await csrfRes.text()
  const res = await webPost('/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    'g-recaptcha-response': 'valid',
  })
  assert(res.status === 200 || res.status === 302, `login → ${res.status}`)
  csrfToken = await (await webGet('/dev/csrf')).text()
}
async function createProject(name) {
  const res = await webPost('/project/new', { projectName: name })
  const body = await res.json()
  return body?.project_id?.toString()
}

// ── Helpers for seeding / fetching doc state ─────────────────────────────────
async function seedDoc(projectId, docId, content) {
  // POST /project/:id/doc/:id with lines + version=0 to force-load with content
  const res = await fetch(
    `${DOCUP_URL}/project/${projectId}/doc/${docId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lines: content.split('\n'),
        source: 'test-seed',
        user_id: activeUserId.toString(),
        undoing: false,
      }),
    }
  )
  assert(res.ok, `seedDoc HTTP ${res.status}`)
}
async function fetchDoc(projectId, docId) {
  const res = await fetch(
    `${DOCUP_URL}/project/${projectId}/doc/${docId}`
  )
  assert(res.ok, `fetchDoc HTTP ${res.status}`)
  return await res.json()
}
async function getMainDocId(mongo, projectId) {
  const project = await mongo
    .db()
    .collection('projects')
    .findOne({ _id: new ObjectId(projectId) }, { projection: { rootFolder: 1 } })
  const main = (project.rootFolder[0].docs ?? []).find(d => d.name === 'main.tex')
  assert(!!main, `main.tex doc found`)
  return main._id.toString()
}

// ── Range assertion helpers ──────────────────────────────────────────────────
function pickAgentChanges(ranges) {
  return (ranges?.changes ?? []).filter(c => c.metadata?.source === 'agent')
}

/**
 * Verify that the agent ranges form clean (insert + delete) pairs where each
 * delete sits exactly at insert.p + insert.i.length (canAggregate convention).
 * Returns the matched pairs.
 */
function pairAgentChanges(agentChanges) {
  const sorted = agentChanges.slice().sort((a, b) => {
    if (a.op.p !== b.op.p) return a.op.p - b.op.p
    if (a.op.i != null && b.op.d != null) return -1
    if (a.op.d != null && b.op.i != null) return 1
    return 0
  })
  const pairs = []
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]
    if (c.op.i != null) {
      const next = sorted[i + 1]
      if (
        next &&
        next.op.d != null &&
        next.op.p === c.op.p + c.op.i.length
      ) {
        pairs.push({ insert: c, del: next })
        i++
      } else {
        pairs.push({ insert: c, del: null })
      }
    } else {
      pairs.push({ insert: null, del: c })
    }
  }
  return pairs
}

// ── Scenarios ────────────────────────────────────────────────────────────────
async function scenario1_singleEdit(ctx) {
  step('Scenario 1 · single agent edit → one clean pair')
  const seed = 'AAA BBB CCC DDD EEE'
  await seedDoc(ctx.projectId, ctx.docId, seed)

  await editFile(
    { path: 'main.tex', oldText: 'BBB', newText: 'XXX' },
    ctx
  )

  const after = await fetchDoc(ctx.projectId, ctx.docId)
  const visible = after.lines.join('\n')
  assert(visible === 'AAA XXX CCC DDD EEE', `visible content: "${visible}"`)

  const pairs = pairAgentChanges(pickAgentChanges(after.ranges))
  assert(pairs.length === 1, `exactly one tracked pair (got ${pairs.length})`)
  assert(pairs[0].insert?.op.i === 'XXX', `insert content = "XXX"`)
  assert(pairs[0].del?.op.d === 'BBB', `delete content = "BBB"`)
  assert(
    pairs[0].del.op.p === pairs[0].insert.op.p + pairs[0].insert.op.i.length,
    `delete sits right after insert (canAggregate)`
  )
}

async function scenario2_twoSeparateEdits(ctx) {
  step('Scenario 2 · two non-overlapping edits → two independent pairs')
  const seed = 'AAA BBB CCC DDD EEE'
  await seedDoc(ctx.projectId, ctx.docId, seed)

  await editFile({ path: 'main.tex', oldText: 'BBB', newText: 'XXX' }, ctx)
  await editFile({ path: 'main.tex', oldText: 'DDD', newText: 'YYY' }, ctx)

  const after = await fetchDoc(ctx.projectId, ctx.docId)
  const visible = after.lines.join('\n')
  assert(visible === 'AAA XXX CCC YYY EEE', `visible: "${visible}"`)

  const pairs = pairAgentChanges(pickAgentChanges(after.ranges))
  assert(pairs.length === 2, `exactly two tracked pairs (got ${pairs.length})`)
  const inserts = pairs.map(p => p.insert.op.i).sort()
  const deletes = pairs.map(p => p.del.op.d).sort()
  assert(JSON.stringify(inserts) === JSON.stringify(['XXX', 'YYY']), `inserts XXX, YYY`)
  assert(JSON.stringify(deletes) === JSON.stringify(['BBB', 'DDD']), `deletes BBB, DDD`)
}

async function scenario3_overlappingDoubleChange(ctx) {
  step(
    'Scenario 3 · double-change on same chunk → consolidates to (oldest, newest)'
  )
  const seed = 'AAA BBB CCC DDD EEE'
  await seedDoc(ctx.projectId, ctx.docId, seed)

  // First: BBB → XXX
  await editFile({ path: 'main.tex', oldText: 'BBB', newText: 'XXX' }, ctx)
  // Second: XXX → ZZZ (overlaps the prior agent insert exactly)
  await editFile({ path: 'main.tex', oldText: 'XXX', newText: 'ZZZ' }, ctx)

  const after = await fetchDoc(ctx.projectId, ctx.docId)
  const visible = after.lines.join('\n')
  assert(visible === 'AAA ZZZ CCC DDD EEE', `visible: "${visible}"`)

  const pairs = pairAgentChanges(pickAgentChanges(after.ranges))
  assert(pairs.length === 1, `exactly one consolidated pair (got ${pairs.length})`)
  assert(
    pairs[0].insert?.op.i === 'ZZZ',
    `NEWEST = "ZZZ" (got "${pairs[0].insert?.op.i}")`
  )
  assert(
    pairs[0].del?.op.d === 'BBB',
    `OLDEST = "BBB" (NOT the intermediate "XXX") — got "${pairs[0].del?.op.d}"`
  )
}

async function scenario4_overlappingLargerEdit(ctx) {
  step(
    'Scenario 4 · second edit covers the prior region → consolidates to (oldest, newest)'
  )
  const seed = 'AAA BBB CCC DDD EEE'
  await seedDoc(ctx.projectId, ctx.docId, seed)

  // First: small targeted edit
  await editFile({ path: 'main.tex', oldText: 'BBB', newText: 'XXX' }, ctx)
  // Second: a larger edit that contains the previous result entirely
  await editFile(
    { path: 'main.tex', oldText: 'AAA XXX CCC', newText: 'PPP' },
    ctx
  )

  const after = await fetchDoc(ctx.projectId, ctx.docId)
  const visible = after.lines.join('\n')
  assert(visible === 'PPP DDD EEE', `visible: "${visible}"`)

  const pairs = pairAgentChanges(pickAgentChanges(after.ranges))
  assert(pairs.length === 1, `exactly one consolidated pair (got ${pairs.length})`)
  assert(pairs[0].insert?.op.i === 'PPP', `NEWEST = "PPP"`)
  assert(
    pairs[0].del?.op.d === 'AAA BBB CCC',
    `OLDEST = "AAA BBB CCC" — original content for the union region (got "${pairs[0].del?.op.d}")`
  )
}

async function scenario5_largeEditEngulfsTwo(ctx) {
  step(
    'Scenario 5 · third edit engulfs two prior pair regions → consolidates over union'
  )
  const seed = 'AAA BBB CCC DDD EEE'
  await seedDoc(ctx.projectId, ctx.docId, seed)

  await editFile({ path: 'main.tex', oldText: 'BBB', newText: 'XXX' }, ctx)
  await editFile({ path: 'main.tex', oldText: 'DDD', newText: 'YYY' }, ctx)
  // Third edit engulfs both: 'XXX CCC YYY' covers the two prior tracked regions
  await editFile(
    { path: 'main.tex', oldText: 'XXX CCC YYY', newText: 'ZZZ' },
    ctx
  )

  const after = await fetchDoc(ctx.projectId, ctx.docId)
  const visible = after.lines.join('\n')
  assert(visible === 'AAA ZZZ EEE', `visible: "${visible}"`)

  const pairs = pairAgentChanges(pickAgentChanges(after.ranges))
  assert(pairs.length === 1, `single consolidated pair across union (got ${pairs.length})`)
  assert(pairs[0].insert?.op.i === 'ZZZ', `NEWEST = "ZZZ"`)
  assert(
    pairs[0].del?.op.d === 'BBB CCC DDD',
    `OLDEST = "BBB CCC DDD" — reconstructed original across both regions (got "${pairs[0].del?.op.d}")`
  )
}

async function scenario6_noOpDropped(ctx) {
  step('Scenario 6 · oldText === newText → no tracked change emitted')
  const seed = 'hello world'
  await seedDoc(ctx.projectId, ctx.docId, seed)
  await editFile(
    { path: 'main.tex', oldText: 'hello', newText: 'hello' },
    ctx
  )
  const after = await fetchDoc(ctx.projectId, ctx.docId)
  assert(after.lines.join('\n') === 'hello world', `visible unchanged`)
  assert(
    pickAgentChanges(after.ranges).length === 0,
    `no agent tracked changes (got ${pickAgentChanges(after.ranges).length})`
  )
}

async function scenario7_collapseToNoOp(ctx) {
  step(
    'Scenario 7 · double-change collapses back to original → tracked changes drop out'
  )
  const seed = 'hello world'
  await seedDoc(ctx.projectId, ctx.docId, seed)
  await editFile({ path: 'main.tex', oldText: 'hello', newText: 'goodbye' }, ctx)
  // Second edit reverses the first — net effect is a no-op
  await editFile({ path: 'main.tex', oldText: 'goodbye', newText: 'hello' }, ctx)
  const after = await fetchDoc(ctx.projectId, ctx.docId)
  assert(after.lines.join('\n') === 'hello world', `visible reverts to original`)
  const pairs = pairAgentChanges(pickAgentChanges(after.ranges))
  assert(
    pairs.length === 0,
    `no tracked pair when oldest === newest after consolidation (got ${pairs.length})`
  )
}

// Each scenario gets its own project + main.tex doc so existing ranges from a
// prior scenario can never bleed in (setDoc reconciles existing tracked
// changes against the diff, which would muddy the reset).
async function freshCtx(mongo, label) {
  const projectId = await createProject(`tc-${label}-${Date.now()}`)
  const docId = await getMainDocId(mongo, projectId)
  info(`project ${projectId}, main.tex ${docId}`)
  return {
    projectId,
    userId: activeUserId.toString(),
    runId: new ObjectId().toString(),
    docId,
    context: {
      projectName: `tc-${label}`,
      compiler: 'pdflatex',
      files: [{ path: 'main.tex', docId }],
    },
  }
}

async function scenario8_multiLineBlockOneLineDiff(ctx) {
  step(
    'Scenario 8 · multi-line block, one line differs → one small tracked pair'
  )
  const seed =
    'line one\nline two\nline three\nline four\nline five'
  await seedDoc(ctx.projectId, ctx.docId, seed)

  // Agent passes the whole 5-line block; only line three changes.
  await editFile(
    {
      path: 'main.tex',
      oldText: 'line one\nline two\nline three\nline four\nline five',
      newText: 'line one\nline two\nLINE THREE\nline four\nline five',
    },
    ctx
  )

  const after = await fetchDoc(ctx.projectId, ctx.docId)
  assert(
    after.lines.join('\n') ===
      'line one\nline two\nLINE THREE\nline four\nline five',
    `visible content correct`
  )
  const pairs = pairAgentChanges(pickAgentChanges(after.ranges))
  assert(
    pairs.length === 1,
    `exactly one tracked pair — not the whole block (got ${pairs.length})`
  )
  assert(pairs[0].insert?.op.i === 'LINE THREE', `insert = "LINE THREE"`)
  assert(pairs[0].del?.op.d === 'line three', `delete = "line three"`)
}

async function scenario9_multiLineBlockTwoLineDiffs(ctx) {
  step(
    'Scenario 9 · multi-line block, two non-adjacent lines differ → two tracked pairs'
  )
  const seed =
    'line one\nline two\nline three\nline four\nline five'
  await seedDoc(ctx.projectId, ctx.docId, seed)

  // Agent passes the whole block; lines two and four change.
  await editFile(
    {
      path: 'main.tex',
      oldText: 'line one\nline two\nline three\nline four\nline five',
      newText: 'line one\nLINE TWO\nline three\nLINE FOUR\nline five',
    },
    ctx
  )

  const after = await fetchDoc(ctx.projectId, ctx.docId)
  assert(
    after.lines.join('\n') ===
      'line one\nLINE TWO\nline three\nLINE FOUR\nline five',
    `visible content correct`
  )
  const pairs = pairAgentChanges(pickAgentChanges(after.ranges))
  assert(
    pairs.length === 2,
    `two separate tracked pairs — one per changed line (got ${pairs.length})`
  )
  const inserts = pairs.map(p => p.insert?.op.i).sort()
  const deletes = pairs.map(p => p.del?.op.d).sort()
  assert(
    JSON.stringify(inserts) === JSON.stringify(['LINE FOUR', 'LINE TWO']),
    `inserts LINE TWO, LINE FOUR`
  )
  assert(
    JSON.stringify(deletes) === JSON.stringify(['line four', 'line two']),
    `deletes line two, line four`
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nTarget: WEB=${WEB_URL}  DOCUP=${DOCUP_URL}\n`)
  const mongo = new MongoClient(MONGO_URL)
  await mongo.connect()

  try {
    step('Auth')
    await ensureUser(mongo)
    await login()

    await scenario1_singleEdit(await freshCtx(mongo, 's1'))
    await scenario2_twoSeparateEdits(await freshCtx(mongo, 's2'))
    await scenario3_overlappingDoubleChange(await freshCtx(mongo, 's3'))
    await scenario4_overlappingLargerEdit(await freshCtx(mongo, 's4'))
    await scenario5_largeEditEngulfsTwo(await freshCtx(mongo, 's5'))
    await scenario6_noOpDropped(await freshCtx(mongo, 's6'))
    await scenario7_collapseToNoOp(await freshCtx(mongo, 's7'))
    await scenario8_multiLineBlockOneLineDiff(await freshCtx(mongo, 's8'))
    await scenario9_multiLineBlockTwoLineDiffs(await freshCtx(mongo, 's9'))

    console.log(`\n${'─'.repeat(60)}\n  All track-changes scenarios passed.\n`)
  } finally {
    await mongo.close()
  }
}

main().catch(err => {
  console.error('\nFatal:', err.message, err.stack)
  process.exit(1)
})
