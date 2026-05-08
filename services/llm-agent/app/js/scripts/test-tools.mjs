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
        assert(Array.isArray(compile1.warnings), `warnings is an array`)
        assert(Array.isArray(compile1.typesetting), `typesetting is an array`)
        assert(compile1.errors.length === 0, `no errors on clean project (got ${compile1.errors.length})`)
        if (compile1.warnings.length) {
          info(`warnings: ${compile1.warnings.length}; first: ${JSON.stringify(compile1.warnings[0])}`)
        }
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

      // ── Step 14: compileAndCheck errors[] match the editor's view ────────────
      // Verifies the ported log-parser pipeline: each error is the same
      // structured entry the editor renders (level/file/line/message/ruleId).
      // Also implicitly verifies no sync/cache lag — the broken edit from
      // step 11 must show up in this compile's errors.
      step('14 · compileAndCheck errors carry the editor-shape and are sync-fresh')
      if (compile2.status === 'too-recently-compiled' || compile2.status?.includes('unavailable')) {
        info(`skipped (compile2 status="${compile2.status}")`)
      } else if (!compile2.success) {
        assert(Array.isArray(compile2.errors), `errors field is an array`)
        assert(compile2.errors.length > 0, `errors[] non-empty (got ${compile2.errors.length})`)
        const first = compile2.errors[0]
        assert(typeof first === 'object' && first !== null, `errors[0] is an object`)
        assert(first.level === 'error', `errors[0].level === 'error' (got "${first.level}")`)
        assert(typeof first.message === 'string' && first.message.length > 0, `errors[0].message is non-empty string`)
        const anyWithFile = compile2.errors.some(e => e.file && e.file.includes('new.tex'))
        assert(anyWithFile, `at least one error references new.tex (proves edit propagated to CLSI)`)
        const anyWithRuleId = compile2.errors.some(e => e.ruleId)
        assert(anyWithRuleId, `at least one error has a ruleId (proves HumanReadableLogs ran)`)
        info(`first error: ${JSON.stringify(first)}`)
        info(`warnings: ${compile2.warnings.length}, typesetting: ${compile2.typesetting.length}`)
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

      // ── Steps 16a–16f: rapid edit / check_syntax loop — staleness regression ─
      // Reproduces the agent-loop bug: agent edits, calls check_syntax to
      // confirm, edits again, calls check_syntax again. Every check_syntax
      // call must reflect the *current* doc state, no stale carryover.
      step('16a · rapid edit/check_syntax loop — staleness regression')

      // 16a: introduce env-mismatch + duplicate label in one edit
      const loopBreak = await editFile(
        {
          path: NEW_FILE_PATH,
          oldText: '\\section{Methodology}',
          newText:
            '\\subsection{Methodology}\n\\label{loop-a}\n\\label{loop-a}\n\\begin{equation}\n\\end{align}',
        },
        ctx
      )
      assert(loopBreak === 'Change applied.', `step 16a edit applied`)
      const syntaxLoop1 = await checkSyntax({ path: NEW_FILE_PATH }, ctx)
      const hasDupLoopA = syntaxLoop1.issues.some(i =>
        i.message.includes('loop-a')
      )
      const hasEnvMismatch1 = syntaxLoop1.issues.some(
        i => i.message.includes('equation') || i.message.includes('align')
      )
      assert(hasDupLoopA, `16a: detects duplicate \\label{loop-a}`)
      assert(hasEnvMismatch1, `16a: detects equation/align mismatch`)

      // 16b: fix the env mismatch — duplicate label still there
      step('16b · fix mismatched env, re-check (dup label must remain visible)')
      const loopFixEnv = await editFile(
        {
          path: NEW_FILE_PATH,
          oldText: '\\begin{equation}\n\\end{align}',
          newText: '\\begin{equation}\n\\end{equation}',
        },
        ctx
      )
      assert(loopFixEnv === 'Change applied.', `step 16b edit applied`)
      const syntaxLoop2 = await checkSyntax({ path: NEW_FILE_PATH }, ctx)
      const stillHasMismatch = syntaxLoop2.issues.some(
        i => i.message.includes('align') && i.message.includes('equation')
      )
      const stillHasDupLoopA = syntaxLoop2.issues.some(i =>
        i.message.includes('loop-a')
      )
      assert(!stillHasMismatch, `16b: env mismatch is gone (proves fresh read)`)
      assert(stillHasDupLoopA, `16b: dup-label still detected (sanity)`)

      // 16c: fix the duplicate label — issues must drop to zero
      step('16c · fix dup label, re-check (must show zero issues for our edits)')
      const loopFixLabel = await editFile(
        {
          path: NEW_FILE_PATH,
          oldText:
            '\\subsection{Methodology}\n\\label{loop-a}\n\\label{loop-a}\n\\begin{equation}\n\\end{equation}',
          newText: '\\section{Methodology}',
        },
        ctx
      )
      assert(loopFixLabel === 'Change applied.', `step 16c edit applied`)
      const syntaxLoop3 = await checkSyntax({ path: NEW_FILE_PATH }, ctx)
      const stillHasDup = syntaxLoop3.issues.some(i =>
        i.message.includes('loop-a')
      )
      const stillHasEnv = syntaxLoop3.issues.some(
        i => i.message.includes('equation') || i.message.includes('align')
      )
      assert(!stillHasDup, `16c: duplicate label gone (proves fresh read)`)
      assert(!stillHasEnv, `16c: no stale env errors`)

      // 16d: same content, second call must be identical (idempotency)
      step('16d · check_syntax is idempotent on unchanged content')
      const syntaxLoop4 = await checkSyntax({ path: NEW_FILE_PATH }, ctx)
      assert(
        syntaxLoop4.issues.length === syntaxLoop3.issues.length,
        `16d: same issue count on repeat (got ${syntaxLoop4.issues.length} vs ${syntaxLoop3.issues.length})`
      )

      // 16e: project-wide call (no path arg) must reflect latest edits too
      step('16e · check_syntax with no path (project-wide) sees latest state')
      const breakAgain = await editFile(
        {
          path: NEW_FILE_PATH,
          oldText: '\\section{Methodology}',
          newText: '\\section{Methodology}\n\\begin{quote}',
        },
        ctx
      )
      assert(breakAgain === 'Change applied.', `16e edit applied`)
      const syntaxAll1 = await checkSyntax({}, ctx)
      const detectedQuote = syntaxAll1.issues.some(
        i => i.message.includes('quote') && i.file === NEW_FILE_PATH
      )
      assert(detectedQuote, `16e: project-wide check sees new \\begin{quote}`)
      const fixAgain = await editFile(
        {
          path: NEW_FILE_PATH,
          oldText: '\\section{Methodology}\n\\begin{quote}',
          newText: '\\section{Methodology}',
        },
        ctx
      )
      assert(fixAgain === 'Change applied.', `16e fix applied`)
      const syntaxAll2 = await checkSyntax({}, ctx)
      const stillHasQuote = syntaxAll2.issues.some(
        i => i.message.includes('quote') && i.file === NEW_FILE_PATH
      )
      assert(!stillHasQuote, `16e: project-wide check sees the fix (no stale)`)

      // 16f: check_syntax called 5x in tight loop on unchanged content —
      // must return the same issue count every time. Reproduces the agent's
      // repeated polling pattern.
      step('16f · 5x check_syntax on unchanged content — must be consistent')
      const repeated = []
      for (let i = 0; i < 5; i++) {
        repeated.push((await checkSyntax({ path: NEW_FILE_PATH }, ctx)).issues.length)
      }
      const allEqual = repeated.every(n => n === repeated[0])
      assert(
        allEqual,
        `16f: counts equal across 5 calls (got [${repeated.join(', ')}])`
      )

      // ── Step 17: identical old/new content — no tracked change ───────────────
      // Regression guard: agent-replace must NOT emit a delete+insert when
      // old_text === new_text. The server returns 204 immediately without
      // touching the doc, so content must be byte-for-byte unchanged.
      step('17 · editFile with identical old/new — no diff emitted')
      const identicalTarget = '\\section{Methodology}'
      const beforeNoOp = await readFile({ path: NEW_FILE_PATH }, ctx)
      assert(
        beforeNoOp.includes(identicalTarget),
        `17: target line is present before no-op edit`
      )
      const noOpResult = await editFile(
        { path: NEW_FILE_PATH, oldText: identicalTarget, newText: identicalTarget },
        ctx
      )
      assert(noOpResult === 'Change applied.', `17: identical edit returns ok (${noOpResult})`)
      const afterNoOp = await readFile({ path: NEW_FILE_PATH }, ctx)
      assert(afterNoOp === beforeNoOp, `17: file content unchanged after no-op edit`)

      // ── Step 18: double-change collapse — old is oldest, new is newest ────────
      // Two sequential agent edits on the same region. The ranges-tracker
      // collapses them: tracked delete = original old text, tracked insert =
      // final new text. Verified by content: the document must contain the
      // final replacement only.
      step('18 · double editFile on same region — collapses to single tracked change')
      const doubleBase = '\\section{Methodology}'
      const doubleIntermediate = '\\section{Revised Methodology}'
      const doubleFinal = '\\section{Final Methodology}'

      const dc1 = await editFile(
        { path: NEW_FILE_PATH, oldText: doubleBase, newText: doubleIntermediate },
        ctx
      )
      assert(dc1 === 'Change applied.', `18a: first edit applied`)

      const dc2 = await editFile(
        { path: NEW_FILE_PATH, oldText: doubleIntermediate, newText: doubleFinal },
        ctx
      )
      assert(dc2 === 'Change applied.', `18b: second edit applied`)

      const afterDouble = await readFile({ path: NEW_FILE_PATH }, ctx)
      assert(afterDouble.includes(doubleFinal), `18c: file contains final replacement text`)
      assert(!afterDouble.includes(doubleIntermediate), `18d: intermediate text is gone`)
      assert(!afterDouble.includes(doubleBase), `18e: original text is gone`)

      // Restore
      await editFile(
        { path: NEW_FILE_PATH, oldText: doubleFinal, newText: doubleBase },
        ctx
      )

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
