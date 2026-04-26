#!/usr/bin/env node
/**
 * End-to-end smoke test for the llm-agent backend.
 * Runs against the live Docker dev environment (bin/up or bin/dev).
 *
 * Usage:
 *   node develop/scripts/test-agent.mjs
 *   node develop/scripts/test-agent.mjs --email=you@example.com --password=secret
 *   node develop/scripts/test-agent.mjs --project=<existingProjectId>
 *
 * Env vars (override defaults):
 *   WEB_URL        base URL of the web service  (default: http://localhost)
 *   TEST_MONGO_URL connection string from host  (default: mongodb://localhost:27017/sharelatex)
 *                  NOTE: do not use MONGO_URL — that resolves to the Docker-internal hostname
 *
 * When no --email/--password is given the script creates a throw-away test
 * user directly in MongoDB (bcrypt hash included) and deletes it on exit.
 */

import { MongoClient, ObjectId } from 'mongodb'
import bcrypt from 'bcrypt'

// ── Config ────────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).flatMap(a => {
    const m = a.match(/^--(\w[\w-]*)=(.*)$/)
    return m ? [[m[1], m[2]]] : []
  })
)

const WEB_URL = process.env.WEB_URL ?? 'http://localhost'
const MONGO_URL =
  process.env.TEST_MONGO_URL ?? 'mongodb://localhost:27017/sharelatex?directConnection=true'

const USE_EXISTING_CREDS = !!(args.email && args.password)
const EMAIL = args.email ?? 'agent-test@overleaf.dev'
const PASSWORD = args.password ?? 'AgentTest!1'
const EXISTING_PROJECT = args.project ?? null

// ── Simple cookie jar ─────────────────────────────────────────────────────────

const cookieJar = new Map()

function updateCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? []
  for (const entry of raw) {
    const [nameValue] = entry.split(';')
    const [name, ...rest] = nameValue.split('=')
    cookieJar.set(name.trim(), rest.join('=').trim())
  }
}

function cookieString() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

let csrfToken = ''

async function get(path) {
  const res = await fetch(`${WEB_URL}${path}`, {
    headers: { Cookie: cookieString() },
    redirect: 'manual',
  })
  updateCookies(res)
  return res
}

async function post(path, body) {
  const res = await fetch(`${WEB_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieString(),
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  })
  updateCookies(res)
  return res
}

// ── Logging helpers ───────────────────────────────────────────────────────────

const ok = msg => console.log(`  ✓ ${msg}`)
const fail = msg => { console.error(`  ✗ ${msg}`); process.exit(1) }

function assert(condition, msg) {
  if (!condition) fail(msg)
  else ok(msg)
}

// ── Test user lifecycle ───────────────────────────────────────────────────────

let createdUserId = null

async function ensureTestUser() {
  if (USE_EXISTING_CREDS) return

  const mongo = new MongoClient(MONGO_URL)
  try {
    await mongo.connect()
    const users = mongo.db().collection('users')

    const existing = await users.findOne({ email: EMAIL })
    if (existing) {
      ok(`test user already exists (${EMAIL})`)
      return
    }

    const hashedPassword = await bcrypt.hash(PASSWORD, 12)
    const reversedHostname = EMAIL.split('@')[1].split('').reverse().join('')
    const now = new Date()

    const result = await users.insertOne({
      email: EMAIL,
      emails: [{ email: EMAIL, createdAt: now, reversedHostname }],
      hashedPassword,
      first_name: 'Agent',
      last_name: 'Test',
      isAdmin: true,
      signUpDate: now,
      lastUpdated: now,
      holdingAccount: false,
      features: { collaborators: -1, versioning: true, compileTimeout: 60 },
      ace: { syntaxValidation: true },
    })
    createdUserId = result.insertedId
    ok(`test user created (${EMAIL})`)
  } finally {
    await mongo.close()
  }
}

async function cleanupTestUser() {
  if (!createdUserId) return
  const mongo = new MongoClient(MONGO_URL)
  try {
    await mongo.connect()
    await mongo.db().collection('users').deleteOne({ _id: createdUserId })
    ok(`test user removed (${EMAIL})`)
  } finally {
    await mongo.close()
  }
}

// ── Test steps ────────────────────────────────────────────────────────────────

async function getCsrfToken() {
  const res = await get('/dev/csrf')
  assert(res.status === 200, `/dev/csrf returned ${res.status}`)
  csrfToken = await res.text()
  assert(csrfToken.length > 0, `CSRF token obtained: ${csrfToken.slice(0, 12)}…`)
}

async function login() {
  const res = await post('/login', {
    email: EMAIL,
    password: PASSWORD,
    'g-recaptcha-response': 'valid',
  })
  const ok302 = res.status === 302
  const ok200 =
    res.status === 200 &&
    (await res.clone().json().then(b => b?.redir === '/project').catch(() => false))

  assert(ok302 || ok200, `login succeeded (status ${res.status})`)

  // Refresh CSRF after login — the token rotates with the session
  await getCsrfToken()
}

async function createProject() {
  const res = await post('/project/new', {
    projectName: `agent-test-${Date.now()}`,
  })
  assert(res.status === 200, `POST /project/new returned ${res.status}`)
  const body = await res.json()
  const id = body?.project_id?.toString()
  assert(!!id, `project created: ${id}`)
  return id
}

async function sendAgentMessage(projectId, message, selection) {
  const payload = { message }
  if (selection) payload.selection = selection
  const res = await post(`/project/${projectId}/agent/message`, payload)
  assert(res.status === 202, `POST /agent/message returned ${res.status} (expected 202)`)
  const body = await res.json()
  assert(typeof body.runId === 'string', `got runId: ${body.runId}`)
  assert(typeof body.messageId === 'string', `got messageId: ${body.messageId}`)
  assert(typeof body.conversationId === 'string', `got conversationId`)
  return body
}

async function verifyRunInMongo(runId) {
  const mongo = new MongoClient(MONGO_URL)
  try {
    await mongo.connect()
    const db = mongo.db()

    // The agent finalizes asynchronously — poll briefly
    let doc = null
    for (let i = 0; i < 10; i++) {
      doc = await db
        .collection('agent_runs')
        .findOne({ _id: new ObjectId(runId) })
      if (doc?.status !== 'running') break
      await new Promise(r => setTimeout(r, 100))
    }

    assert(!!doc, `run document found in agent_runs`)
    assert(doc.status === 'done', `run status is "${doc.status}" (expected "done")`)
    assert(typeof doc.durationMs === 'number', `durationMs recorded: ${doc.durationMs}ms`)
    assert(doc.output?.type === 'text', `output type is "${doc.output?.type}"`)
    return doc
  } finally {
    await mongo.close()
  }
}

async function testValidationErrors(projectId) {
  // Missing message
  const r1 = await post(`/project/${projectId}/agent/message`, {})
  assert(r1.status === 400, `empty body → 400 (got ${r1.status})`)

  // Whitespace-only message
  const r2 = await post(`/project/${projectId}/agent/message`, { message: '   ' })
  assert(r2.status === 400, `whitespace message → 400 (got ${r2.status})`)

  // Unauthenticated request (no cookie)
  const r3 = await fetch(`${WEB_URL}/project/${projectId}/agent/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello' }),
    redirect: 'manual',
  })
  assert(
    r3.status === 302 || r3.status === 401 || r3.status === 403,
    `unauthenticated → redirect/401/403 (got ${r3.status})`
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nTarget: ${WEB_URL}  MongoDB: ${MONGO_URL}\n`)

  console.log('── Setup ────────────────────────────────────────')
  await ensureTestUser()

  console.log('\n── Auth ─────────────────────────────────────────')
  await getCsrfToken()
  await login()

  console.log('\n── Project ──────────────────────────────────────')
  const projectId = EXISTING_PROJECT ?? await createProject()
  ok(`using project: ${projectId}`)

  console.log('\n── Happy path ───────────────────────────────────')
  const { runId, messageId, conversationId } = await sendAgentMessage(
    projectId,
    'Fix the grammar in the introduction'
  )

  console.log('\n── With selection ───────────────────────────────')
  const { runId: runId2 } = await sendAgentMessage(
    projectId,
    'Improve this paragraph',
    { fromLine: 5, toLine: 10, content: 'Some selected text here' }
  )
  ok(`second run: ${runId2}`)

  console.log('\n── MongoDB verification ─────────────────────────')
  const doc = await verifyRunInMongo(runId)
  assert(doc.input.userMessage === 'Fix the grammar in the introduction', `userMessage stored correctly`)
  assert(doc.conversationId === conversationId, `conversationId matches`)
  assert(doc.projectId === projectId, `projectId stored correctly`)

  console.log('\n── Validation errors ────────────────────────────')
  await testValidationErrors(projectId)

  console.log('\n── Conversation continuity ──────────────────────')
  const { conversationId: c2 } = await sendAgentMessage(
    projectId,
    'Continue the conversation',
    undefined
  )
  assert(typeof c2 === 'string', `follow-up message returns conversationId`)

  console.log('\n─────────────────────────────────────────────────')
  console.log(`  All checks passed. runId=${runId}`)
  console.log(`  Project URL: ${WEB_URL}/project/${projectId}\n`)
}

main()
  .catch(err => {
    console.error('\nFatal:', err.message)
    process.exit(1)
  })
  .finally(cleanupTestUser)
