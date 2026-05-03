#!/usr/bin/env node
/**
 * Integration test for all 8 agent tools running against the live Docker stack.
 *
 * Runs INSIDE the llm-agent container (has access to document-updater, web, mongo).
 *
 * Usage (from repo root):
 * docker compose -f develop/docker-compose.yml -f develop/docker-compose.dev.yml \
 * exec llm-agent node /overleaf/services/llm-agent/app/js/scripts/test-tools.mjs
 *
 * Or shorthand if llm-agent is running in dev mode:
 * docker exec $(cd develop && docker compose ps -q llm-agent) \
 * node /overleaf/services/llm-agent/app/js/scripts/test-tools.mjs
 *
 * Optional env vars:
 * ADMIN_EMAIL     existing admin account (default: creates a throw-away user)
 * ADMIN_PASSWORD
 */

import { MongoClient, ObjectId } from 'mongodb'
// import bcrypt from 'bcrypt'

// ── Tool imports ──────────────────────────────────────────────────────────────
import { listFiles }       from '../tools/list_files.js'
import { readFile }        from '../tools/read_file.js'
import { getOutline }      from '../tools/get_outline.js'
import { editFile }        from '../tools/edit_file.js'
import { createFile }      from '../tools/create_file.js'
import { compileAndCheck } from '../tools/compile_and_check.js'
import { checkSyntax }     from '../tools/check_syntax.js'
import { getPdfPage }      from '../tools/get_pdf_page.js'

// ── Config ────────────────────────────────────────────────────────────────────
const WEB_URL   = `http://${process.env.WEB_HOST   || 'web'}:3000`
const DOCUP_URL = `http://${process.env.DOCUMENT_UPDATER_HOST || 'document-updater'}:3003`
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo/sharelatex'

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'agent-tools-test@overleaf.dev'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ToolsTest!1'

// ── The new file we'll create and manipulate ──────────────────────────────────
const NEW_FILE_PATH = 'new.tex'
const NEW_FILE_CONTENT = `\\documentclass{article}
\\usepackage{graphicx}
\\title{Test Paper}
\\author{Agent Test}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
We propose a novel approach to automated reasoning.
The key insight is that language models can decompose
complex tasks into simpler subtasks.

\\section{Methodology}

Our method consists of three stages:
first, we identify the problem structure;
second, we apply domain-specific heuristics;
third, we verify the solution.

\\subsection{Approach}

Details of the approach.

\\subsection{Results}

Experiments demonstrate a 42\\% improvement over baselines.
\\end{document}
`

// ── Logging ───────────────────────────────────────────────────────────────────
const ok   = msg => console.log(`  ✓  ${msg}`)
const info = msg => console.log(`  ·  ${msg}`)
const fail = msg => { console.error(`  ✗  ${msg}`); process.exit(1) }

function assert(cond, msg) {
  if (!cond) fail(msg)
    else ok(msg)
}

function step(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`)
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

// ── Auth ──────────────────────────────────────────────────────────────────────
let createdUserId = null
let activeUserId = null

async function ensureUser(mongo) {
  const users = mongo.db().collection('users')
  const existing = await users.findOne({ email: ADMIN_EMAIL })

  if (existing) {
    info(`using existing user ${ADMIN_EMAIL}`)
    // Upgrade existing user to admin to ensure tools pass permissions
    await users.updateOne(
      { _id: existing._id },
      { $set: {
        isAdmin: true,
        "features.versioning": true,
        "features.collaborators": -1,
        "features.compileTimeout": 60
      } }
    )
    activeUserId = existing._id
    createdUserId = null // IMPORTANT: Prevents cleanup from deleting your account
    return
  }

  // Create throw-away user if it doesn't exist using bcrypt logic
  info(`creating new test user ${ADMIN_EMAIL}`)
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12)
  const reversedHostname = ADMIN_EMAIL.split('@')[1].split('').reverse().join('')
  const now = new Date()

  const r = await users.insertOne({
    email: ADMIN_EMAIL,
    emails: [{ email: ADMIN_EMAIL, createdAt: now, reversedHostname }],
    hashedPassword,
    first_name: 'Tools',
    last_name: 'Test',
    isAdmin: true,
    signUpDate: now,
    lastUpdated: now,
    holdingAccount: false,
    features: { collaborators: -1, versioning: true, compileTimeout: 60 },
    ace: { syntaxValidation: true },
  })
  createdUserId = r.insertedId
  activeUserId = r.insertedId
  ok(`created test user ${ADMIN_EMAIL}`)
}

async function login() {
  const csrfRes = await webGet('/dev/csrf')
  assert(csrfRes.status === 200, `/dev/csrf → 200`)
  csrfToken = await csrfRes.text()

  const res = await webPost('/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    'g-recaptcha-response': 'valid',
  })
  assert(res.status === 200 || res.status === 302, `login → ${res.status}`)

  // Refresh CSRF — token rotates with session
  const csrf2 = await webGet('/dev/csrf')
  csrfToken = await csrf2.text()
}

// ── Project creation ──────────────────────────────────────────────────────────
async function createProject() {
  const res = await webPost('/project/new', {
    projectName: `tools-test-${Date.now()}`,
  })
  assert(res.status === 200, `POST /project/new → 200`)
  const body = await res.json()
  const id = body?.project_id?.toString()
  assert(!!id, `project created: ${id}`)
  return id
}

// ── File structure from MongoDB ───────────────────────────────────────────────
function collectDocs(folder, prefix = '') {
  const result = []
  for (const doc of folder.docs ?? []) {
    if (doc != null) result.push({ path: prefix + doc.name, docId: doc._id.toString() })
  }
  for (const sub of folder.folders ?? []) {
    if (sub != null) result.push(...collectDocs(sub, prefix + sub.name + '/'))
  }
  return result
}

async function getProjectFiles(mongo, projectId) {
  const project = await mongo
  .db()
  .collection('projects')
  .findOne({ _id: new ObjectId(projectId) }, { projection: { rootFolder: 1 } })
  if (!project) fail(`project ${projectId} not found in MongoDB`)
    return collectDocs(project.rootFolder[0])
}

// ── Pre-load a doc into document-updater Redis ────────────────────────────────
async function loadDocIntoRedis(projectId, docId) {
  const res = await fetch(
    `${DOCUP_URL}/project/${projectId}/doc/${docId}`,
    { headers: { Accept: 'application/json' } }
  )
  if (!res.ok && res.status !== 404) {
    info(`Warning: preloading doc ${docId} returned HTTP ${res.status}`)
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
async function cleanup(mongo, projectId) {
  if (createdUserId) {
    // ONLY DELETES IF THE SCRIPT CREATED IT FROM SCRATCH
    await mongo.db().collection('users').deleteOne({ _id: createdUserId })
    info(`test user removed`)
  } else {
    info(`test user removal skipped (using pre-existing account)`)
  }
  if (projectId) {
    // await mongo.db().collection('projects').deleteOne({ _id: new ObjectId(projectId) })
    // info(`test project removed`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nTarget: WEB=${WEB_URL}  DOCUP=${DOCUP_URL}  MONGO=${MONGO_URL}`)

  const mongo = new MongoClient(MONGO_URL)
  await mongo.connect()

  let projectId = null
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    step('Auth')
    await ensureUser(mongo)
    await login()

    // ── Project setup ─────────────────────────────────────────────────────────
    step('Create project')
    projectId = await createProject()
    const files = await getProjectFiles(mongo, projectId)
    info(`initial files: ${files.map(f => f.path).join(', ')}`)

    for (const f of files) await loadDocIntoRedis(projectId, f.docId)

      /** @type {import('../types.js').RunContext} */
      const ctx = {
        projectId,
        userId: activeUserId?.toString() ?? 'unknown',
        runId: new ObjectId().toString(),
        context: {
          projectName: 'tools-test',
          compiler: 'pdflatex',
          files,
        },
      }

      // ── Step 1: listFiles ─────────────────────────────────────────────────────
      step('1 · listFiles')
      const listed = await listFiles({}, ctx)
      const paths = listed.map(f => f.path)
      assert(paths.includes('main.tex'), `main.tex is in the file list`)
      ok(`files: ${paths.join(', ')}`)

      // ── Step 2: readFile ──────────────────────────────────────────────────────
      step('2 · readFile(main.tex)')
      const mainContent = await readFile({ path: 'main.tex' }, ctx)
      assert(typeof mainContent === 'string' && mainContent.length > 0, `got content`)
      assert(!mainContent.includes('not loaded yet'), `doc loaded (no 404)`)
      info(`first 3 lines:\n${mainContent.split('\n').slice(0, 3).map(l => '    ' + l).join('\n')}`)

      // ── Step 3: createFile ────────────────────────────────────────────────────
      step(`3 · createFile(${NEW_FILE_PATH})`)
      const created = await createFile({ path: NEW_FILE_PATH, content: NEW_FILE_CONTENT }, ctx)
      console.log("DEBUG created result:", created);
      assert(typeof created === 'object' && created.docId, `got {path, docId}`)
      ok(`docId: ${created.docId}`)
      ctx.context.files = ctx.context.files.filter(f => f.path !== NEW_FILE_PATH)
      ctx.context.files.push({ path: NEW_FILE_PATH, docId: created.docId })
      await loadDocIntoRedis(projectId, created.docId)

      // ── Step 4: readFile (new file) ───────────────────────────────────────────
      step(`4 · readFile(${NEW_FILE_PATH})`)
      const newContent = await readFile({ path: NEW_FILE_PATH }, ctx)
      assert(typeof newContent === 'string', `got content`)
      assert(newContent.includes('novel approach'), `initial content present`)
      info(`lines: ${newContent.split('\n').length}`)

      // ── Step 5: editFile ──────────────────────────────────────────────────────
      step(`5 · editFile — change paragraph`)
      const editResult = await editFile(
        {
          path: NEW_FILE_PATH,
          oldText: 'We propose a novel approach to automated reasoning.',
          newText: 'We propose a groundbreaking approach to automated reasoning.',
        },
        ctx
      )
      assert(editResult === 'Change applied.', `edit succeeded: "${editResult}"`)

      // ── Step 6: readFile again (verify edit) ──────────────────────────────────
      step(`6 · readFile(${NEW_FILE_PATH}) — verify edit`)
      const afterEdit = await readFile({ path: NEW_FILE_PATH }, ctx)
      assert(
        afterEdit.includes('groundbreaking approach'),
             `edited text visible in file`
      )
      assert(
        !afterEdit.includes('novel approach to automated reasoning'),
             `old text no longer present`
      )

      // ── Step 7: getOutline ────────────────────────────────────────────────────
      step(`7 · getOutline(${NEW_FILE_PATH})`)
      const outline = await getOutline({ path: NEW_FILE_PATH }, ctx)
      assert(Array.isArray(outline), `got array`)
      const sectionTitles = outline
      .filter(e => e.type === 'section' || e.type === 'subsection')
      .map(e => `${e.type}:${e.title}@L${e.lineNumber}`)
      assert(sectionTitles.length >= 3, `found ≥3 section entries`)
      ok(`outline: ${sectionTitles.join(', ')}`)

      // ── Step 8: checkSyntax (clean file) ─────────────────────────────────────
      step(`8 · checkSyntax(${NEW_FILE_PATH}) — clean file`)
      const syntax1 = await checkSyntax({ path: NEW_FILE_PATH }, ctx)
      assert(Array.isArray(syntax1.issues), `got issues array`)
      const errors1 = syntax1.issues.filter(i => i.type === 'error')
      assert(errors1.length === 0, `no errors on clean file (found ${errors1.length})`)
      ok(`issues on clean file: ${syntax1.issues.length}`)

      // ── Step 9: compileAndCheck (clean) ──────────────────────────────────────
      step('9 · compileAndCheck (should succeed)')
      const compile1 = await compileAndCheck({}, ctx)
      info(`status: ${compile1.status}`)
      if (compile1.status === 'too-recently-compiled') {
        info('skipped (compiled too recently — wait a moment and retry)')
      } else if (compile1.status === 'clsi-unavailable' || compile1.status?.includes('unavailable')) {
        info('⚠  CLSI not available — compile steps skipped')
      } else {
        assert(
          compile1.success || compile1.status === 'success',
          `compile succeeded (status="${compile1.status}")`
        )
        if (compile1.errors?.length) info(`warnings: ${compile1.errors.join('; ')}`)
      }

      // ── Step 10: getPdfPage ───────────────────────────────────────────────────
      // Only run if the compile produced a PDF (status === 'success').
      step('10 · getPdfPage(1) — first page of compiled PDF')
      if (compile1.status === 'success' && compile1.pageCount != null) {
        info(`PDF has ${compile1.pageCount} page(s)`)
        const pageResult = await getPdfPage({ page: 1 }, ctx)
        if (typeof pageResult === 'string') {
          info(`⚠  getPdfPage returned: ${pageResult}`)
        } else {
          assert(typeof pageResult.imageBase64 === 'string' && pageResult.imageBase64.length > 0, `got non-empty base64 PNG`)
          assert(pageResult.mimeType === 'image/png', `mimeType is image/png`)
          ok(`page 1 returned ${pageResult.imageBase64.length} base64 chars`)
        }
      } else {
        info(`skipped (compile status="${compile1.status}", pageCount=${compile1.pageCount})`)
      }

      // ── Step 11: editFile — introduce LaTeX error ─────────────────────────────
      step(`11 · editFile — introduce syntax error`)
      const breakResult = await editFile(
        {
          path: NEW_FILE_PATH,
          oldText: '\\subsection{Results}',
          newText: '\\subsection{Results}\n\\begin{table}\nbroken table',
        },
        ctx
      )
      assert(breakResult === 'Change applied.', `error introduced: "${breakResult}"`)

      // ── Step 12: compileAndCheck (broken) ────────────────────────────────────
      // Compile new.tex directly as the root document so CLSI sees the error.
      step('12 · compileAndCheck (should fail)')
      const compile2 = await compileAndCheck({ path: NEW_FILE_PATH }, ctx)
      info(`status: ${compile2.status}`)
      if (compile2.status === 'too-recently-compiled') {
        info('skipped (compiled too recently)')
      } else if (compile2.status?.includes('unavailable') || compile2.status === 'clsi-unavailable') {
        info('⚠  CLSI not available — skipped')
      } else {
        assert(
          !compile2.success || compile2.status === 'failure',
          `compile failed as expected (status="${compile2.status}")`
        )
      }

      // ── Step 13: checkSyntax (broken file — detects unclosed \begin{table}) ──
      step(`13 · checkSyntax(${NEW_FILE_PATH}) — broken file`)
      const syntax2 = await checkSyntax({ path: NEW_FILE_PATH }, ctx)
      assert(Array.isArray(syntax2.issues), `got issues array`)
      const tableIssue = syntax2.issues.filter(
        i => i.message.includes('table')
      )
      assert(tableIssue.length > 0, `detected unclosed \\begin{table}`)
      ok(`issues on broken file: ${syntax2.issues.length} (includes unclosed table)`)

      // ── Step 14: compileAndCheck returns non-empty errors[] on failure ────────
      // Verifies the log-parser path introduced in the P1 fix: when compilation
      // fails, output.log is fetched from CLSI and parsed into actionable strings.
      step('14 · compileAndCheck errors[] are non-empty on failure')
      if (compile2.status === 'too-recently-compiled' || compile2.status?.includes('unavailable')) {
        info(`skipped (compile2 status="${compile2.status}")`)
      } else if (!compile2.success) {
        assert(
          Array.isArray(compile2.errors),
          `errors field is an array`
        )
        assert(
          compile2.errors.length > 0,
          `errors[] is non-empty (got ${compile2.errors.length} error(s))`
        )
        info(`first error: ${compile2.errors[0]}`)
      } else {
        info(`skipped — compile2 unexpectedly succeeded`)
      }

      // ── Step 15: checkSyntax detects duplicate \label{} ──────────────────────
      // Introduces a duplicate label in new.tex and verifies SyntaxChecker
      // reports it (the P1 fix to SyntaxChecker.mjs).
      step(`15 · checkSyntax — duplicate \\label{} detection`)
      const dupLabelEdit = await editFile(
        {
          path: NEW_FILE_PATH,
          oldText: '\\subsection{Approach}',
          newText: '\\label{dup-label}\n\\subsection{Approach}\n\\label{dup-label}',
        },
        ctx
      )
      assert(dupLabelEdit === 'Change applied.', `duplicate label inserted: "${dupLabelEdit}"`)

      const syntax3 = await checkSyntax({ path: NEW_FILE_PATH }, ctx)
      assert(Array.isArray(syntax3.issues), `got issues array`)
      const dupIssue = syntax3.issues.find(
        i => i.message.includes('dup-label')
      )
      assert(!!dupIssue, `duplicate label detected`)
      assert(dupIssue.type === 'warning', `duplicate label is a warning`)
      ok(`duplicate label issue: "${dupIssue.message}"`)

      // ── Step 16: restore new.tex — remove duplicate label ────────────────────
      step(`16 · editFile — remove duplicate label (restore)`)
      const restoreResult = await editFile(
        {
          path: NEW_FILE_PATH,
          oldText: '\\label{dup-label}\n\\subsection{Approach}\n\\label{dup-label}',
          newText: '\\subsection{Approach}',
        },
        ctx
      )
      assert(restoreResult === 'Change applied.', `duplicate label removed: "${restoreResult}"`)

      const syntax4 = await checkSyntax({ path: NEW_FILE_PATH }, ctx)
      const dupAfterRestore = syntax4.issues.filter(i => i.message.includes('dup-label'))
      assert(dupAfterRestore.length === 0, `no duplicate-label warning after restore`)

      // ── Summary ───────────────────────────────────────────────────────────────
      console.log('\n' + '─'.repeat(56))
      console.log('  All tool steps completed.')
      console.log(`  Project: ${WEB_URL}/project/${projectId}`)
      console.log('')

  } finally {
    await cleanup(mongo, projectId)
    await mongo.close()
  }
}

main().catch(err => {
  console.error('\nFatal:', err.message, err.stack)
  process.exit(1)
})
