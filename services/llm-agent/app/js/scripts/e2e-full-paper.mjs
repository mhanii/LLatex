#!/usr/bin/env node
// @ts-check

/**
 * End-to-end full-paper generation test.
 *
 * Starts from a single empty-skeleton main.tex and asks the default agent to
 * build a complete, multi-section technical paper from scratch. The paper must
 * include real written content, multiple figures produced with the skills
 * system (flowchart, 2D diagram, PGFPlots chart, 3D figure), equations,
 * a table, and a bibliography.
 *
 * Assertions (checked automatically):
 *   • list_skills called at least once.
 *   • read_skill called for at least 3 distinct skills.
 *   • At least 4 new files were created beyond the seed (figures + chapters + bib).
 *   • Final compile succeeded with at least 4 pages.
 *   • No compile errors in the final run.
 *
 * Run from the llm-agent container:
 *   docker compose exec llm-agent node app/js/scripts/e2e-full-paper.mjs
 */

import { ObjectId } from 'mongodb'
import settings from '@overleaf/settings'
import { db, mongoClient } from '../mongodb.js'
import { run as agentRun } from '../AgentManager.js'
import { createRun } from '../AgentStore.js'

const ADMIN_EMAIL = process.env.E2E_USER_EMAIL ?? 'mohamedhani590@gmail.com'

// ── Seed: one near-empty file ─────────────────────────────────────────────────

const MAIN_TEX = `\\documentclass[11pt]{article}
\\title{Gradient Descent: Theory, Variants, and Visualisation}
\\author{Anonymous}
\\date{\\today}
\\begin{document}
\\maketitle
% Paper body goes here.
\\end{document}
`

const FILES = { 'main.tex': MAIN_TEX }

// ── Task prompt ───────────────────────────────────────────────────────────────

const TASK = `Build a complete, well-written technical paper titled
"Gradient Descent: Theory, Variants, and Visualisation".

The paper must be structured and substantial — aim for at least 4 pages when
compiled. Follow these requirements exactly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRUCTURE  (use \\input to keep main.tex clean)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Create the following files and \\input them in main.tex:

  sections/abstract.tex     — 1-paragraph abstract (~100 words)
  sections/intro.tex        — Introduction (2–3 paragraphs, cite 2–3 references)
  sections/theory.tex       — Mathematical background: define loss L(θ),
                              state the gradient descent update rule as a
                              numbered equation, discuss learning rate and
                              convergence conditions
  sections/variants.tex     — Three variants (SGD, Momentum, Adam) each
                              described in one paragraph; include their update
                              rules as equations; include a comparison table
                              (tabular) of the three variants by: update rule,
                              memory overhead, and typical use case
  sections/experiments.tex  — Describe a synthetic experiment comparing the
                              three variants on a quadratic loss; the figures
                              (referenced below) illustrate the results
  sections/conclusion.tex   — Conclusion (1 paragraph)
  refs.bib                  — BibTeX file with at least 3 real-looking entries
                              (Rumelhart 1986 backprop, Kingma 2015 Adam,
                               Robbins 1951 SGD)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIGURES  (use list_skills + read_skill before writing each one)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Create four figure files and \\input them at appropriate points in the text:

  figures/gd_algorithm.tex
    A flowchart (tikz_flowchart skill) of the gradient descent loop:
    Initialise θ → Compute Loss L(θ) → Compute Gradient ∇L → Update θ ← θ − η∇L
    → Converged? → Yes: Stop / No: loop back to Compute Loss.
    Caption: "Gradient descent iteration." Label: fig:gd-algo.

  figures/loss_landscape.tex
    A PGFPlots 3D surface plot (pgfplots_charts skill) of the loss function
    L(x,y) = x^2 + 5*y^2 over x,y ∈ [−2,2], samples=25.
    Use colormap/cool, view={30}{50}. Show x, y, L axes.
    Caption: "Quadratic loss landscape." Label: fig:landscape.

  figures/convergence.tex
    A PGFPlots line chart (pgfplots_charts skill) with three curves over
    iterations t = 1..80:
      SGD:      f(t) = 1.8 * (0.97^t) + 0.05
      Momentum: g(t) = 1.8 * (0.94^t) + 0.04
      Adam:     h(t) = 1.8 * (0.91^t) + 0.03
    Blue solid for SGD, red dashed for Momentum, green dotted for Adam.
    Axis labels: Iteration, Loss. Legend top right. Grid on.
    Caption: "Convergence comparison of GD variants." Label: fig:convergence.

  figures/gradient_geometry.tex
    A TikZ 2D diagram (tikz_2d_graphics skill) on a coordinate plane:
    Draw concentric ellipses centred at origin representing level sets of
    L(x,y) = x^2 + 5*y^2 (use three radii: 0.6, 1.1, 1.7 scaled to
    semi-axes a=r, b=r/sqrt(5)).
    Draw a gradient descent path as a sequence of 4 arrows stepping from
    (1.6, 0.7) toward (0,0), each arrow roughly perpendicular to the ellipses.
    Label the starting point "θ₀" and the final point "θ*".
    Caption: "Gradient descent path on level sets." Label: fig:geometry.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREAMBLE & COMPILATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Update main.tex to include:
  - All required \\usepackage commands (amsmath, amssymb, tikz + libraries,
    tikz-3dplot, pgfplots, booktabs, geometry with reasonable margins)
  - \\pgfplotsset{compat=1.18}
  - All \\input{sections/...} and \\input{figures/...} in the right order
  - \\bibliography{refs} and \\bibliographystyle{plain}

After writing everything:
1. Run check_syntax on the whole project.
2. Run compile_and_check. Fix every error. Recompile until it succeeds.
3. Verify with get_pdf_page that the first 3 pages look correct.
4. Final response: list all files created, the skills used for each figure,
   and the final compile status (page count, errors, warnings).`

// ── Helpers ───────────────────────────────────────────────────────────────────

function basicAuth() {
  return (
    'Basic ' +
    Buffer.from(
      `${settings.httpAuthUser}:${settings.httpAuthPass}`
    ).toString('base64')
  )
}

async function findUser(email) {
  return await mongoClient.db().collection('users').findOne({ email })
}

async function findProject(ownerId) {
  const projects = mongoClient.db().collection('projects')
  return (
    (await projects.findOne({ owner_ref: ownerId, name: 'Test' })) ??
    (await projects.findOne({ owner_ref: ownerId }))
  )
}

async function loadProjectFiles(projectId) {
  const p = await mongoClient
    .db()
    .collection('projects')
    .findOne({ _id: new ObjectId(projectId) })
  if (!p) throw new Error(`project ${projectId} not found`)
  /** @type {{path: string, docId: string}[]} */
  const out = []
  /** @param {any} folder @param {string} prefix */
  function walk(folder, prefix) {
    for (const d of folder.docs ?? []) {
      if (d?._id && d?.name) {
        out.push({ path: prefix + d.name, docId: d._id.toString() })
      }
    }
    for (const sub of folder.folders ?? []) {
      walk(sub, `${prefix}${sub.name}/`)
    }
  }
  const roots = Array.isArray(p.rootFolder)
    ? p.rootFolder
    : p.rootFolder
      ? [p.rootFolder]
      : []
  for (const r of roots) walk(r, '')
  return {
    files: out,
    projectName: p.name ?? '(unnamed)',
    compiler: p.compiler ?? 'pdflatex',
  }
}

async function createFileViaWeb(projectId, path, content, userId) {
  const url = `${settings.apis.web.url}/internal/project/${projectId}/agent/create-file`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuth(),
    },
    body: JSON.stringify({ path, content, userId }),
  })
  if (!res.ok) {
    throw new Error(
      `create-file ${path} failed: ${res.status} ${await res.text()}`
    )
  }
  return /** @type {{path: string, docId: string}} */ (await res.json())
}

async function setDocViaDocUpdater(projectId, docId, content, userId) {
  const url = `${settings.apis.documentUpdater.url}/project/${projectId}/doc/${docId}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lines: content.split('\n'),
      source: 'e2e-full-paper',
      user_id: userId,
      undoing: false,
    }),
  })
  if (!res.ok) {
    throw new Error(`setDoc ${docId} failed: ${res.status} ${await res.text()}`)
  }
}

/** Reset project to skeleton (main.tex only). Any extra files from a prior run
 *  are left in the project — the agent will overwrite them via edit_file or
 *  create_file as needed. We just ensure main.tex is the bare skeleton. */
async function seedProject(projectId, userId) {
  const { files: existing } = await loadProjectFiles(projectId)
  const byPath = Object.fromEntries(existing.map(f => [f.path, f.docId]))

  if (byPath['main.tex']) {
    await setDocViaDocUpdater(projectId, byPath['main.tex'], MAIN_TEX, userId)
  } else {
    await createFileViaWeb(projectId, 'main.tex', MAIN_TEX, userId)
  }

  const { files } = await loadProjectFiles(projectId)
  const finalByPath = Object.fromEntries(files.map(f => [f.path, f.docId]))
  await setDocViaDocUpdater(projectId, finalByPath['main.tex'], MAIN_TEX, userId)
  return files
}

function shorten(value, n = 120) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return s.replace(/\s+/g, ' ').slice(0, n)
}

function bar(label) {
  console.log('\n══════════ ' + label + ' ══════════')
}

async function runAgent(agentName, userMessage, projectId, userId, files, projectName, compiler) {
  const conversationId = new ObjectId().toHexString()
  const main = files.find(f => f.path === 'main.tex') ?? files[0]
  /** @type {import('../types.js').AgentInput} */
  const input = {
    projectId,
    userId,
    conversationId,
    userMessage,
    context: { projectName, compiler, files },
    currentFile: main,
  }
  const startedAt = new Date()
  const runId = await createRun(projectId, input)
  console.log(`[${agentName}] runId=${runId}`)
  await agentRun(runId, input, startedAt, { agentName })
  return /** @type {any} */ (
    await db.agentRuns.findOne({ _id: new ObjectId(runId) })
  )
}

function printRun(doc, label) {
  bar(label)
  console.log(`status=${doc.status}  durationMs=${doc.durationMs}`)
  if (doc.error) console.log(`error: ${doc.error}`)

  console.log('\n--- final output ---')
  console.log(doc.output?.content ?? '(no content)')

  console.log(`\n--- steps (${doc.steps?.length ?? 0}) ---`)
  for (const [i, s] of (doc.steps ?? []).entries()) {
    const md = s.metadata ?? {}
    const calls = (s.output?.toolCalls ?? [])
      .map(c => c.toolName ?? c.name)
      .join(',')
    const text = s.output?.text ? `  text=${shorten(s.output.text, 90)}` : ''
    console.log(
      `  [${i}] [${calls}]${text}  in=${md.inputTokens ?? '?'} out=${md.outputTokens ?? '?'} ms=${md.latencyMs ?? '?'}`
    )
  }
}

// ── Assertions ────────────────────────────────────────────────────────────────

/**
 * @param {any}    doc
 * @param {any[]}  seedFiles    files present before the run
 * @param {any[]}  finalFiles   files present after the run
 */
function assertRun(doc, seedFiles, finalFiles) {
  let ok = true
  /** @param {boolean} cond @param {string} msg */
  function check(cond, msg) {
    console.log(cond ? `  ✅ ${msg}` : `  ❌ ${msg}`)
    if (!cond) ok = false
  }

  // ── Skill tool usage ───────────────────────────────────────────────────────
  const toolCallContents = (doc.contextItems ?? [])
    .filter(c => c.kind === 'tool_call')
    .map(c => c.content)

  const toolNames = toolCallContents.map(c => c?.name ?? '')

  check(toolNames.includes('list_skills'), 'list_skills was called')

  const readSkillContents = toolCallContents.filter(c => c?.name === 'read_skill')
  check(
    readSkillContents.length >= 3,
    `read_skill called at least 3 times (got ${readSkillContents.length})`
  )

  const skillsRead = new Set(
    readSkillContents.map(c => c?.args?.name).filter(Boolean)
  )
  check(
    skillsRead.size >= 3,
    `at least 3 distinct skills read (got: ${[...skillsRead].join(', ')})`
  )

  // ── File creation ──────────────────────────────────────────────────────────
  const seedPaths = new Set(seedFiles.map(f => f.path))
  const newFiles = finalFiles.filter(f => !seedPaths.has(f.path))
  console.log(`  (${newFiles.length} new files created: ${newFiles.map(f => f.path).join(', ')})`)

  check(
    newFiles.length >= 4,
    `at least 4 new files created beyond the seed (got ${newFiles.length})`
  )

  const finalPaths = new Set(finalFiles.map(f => f.path))
  check(finalPaths.has('refs.bib'), 'refs.bib created')

  const figureFiles = finalFiles.filter(f => f.path.startsWith('figures/'))
  check(
    figureFiles.length >= 3,
    `at least 3 figure files created (got ${figureFiles.length}: ${figureFiles.map(f => f.path).join(', ')})`
  )

  const sectionFiles = finalFiles.filter(f => f.path.startsWith('sections/'))
  check(
    sectionFiles.length >= 3,
    `at least 3 section files created (got ${sectionFiles.length}: ${sectionFiles.map(f => f.path).join(', ')})`
  )

  // ── Compile result ─────────────────────────────────────────────────────────
  const compileOutputs = (doc.contextItems ?? [])
    .filter(c => c.kind === 'tool_output')
    .map(c => c.content)
    .filter(c => c && typeof c === 'object' && 'success' in c)

  const lastCompile = compileOutputs.at(-1)
  check(
    lastCompile?.success === true,
    `final compile succeeded (status=${lastCompile?.status ?? 'n/a'})`
  )
  check(
    (lastCompile?.pageCount ?? 0) >= 4,
    `PDF has at least 4 pages (got ${lastCompile?.pageCount ?? 'n/a'})`
  )
  check(
    (lastCompile?.errors ?? []).length === 0,
    `zero compile errors (got ${(lastCompile?.errors ?? []).length})`
  )

  return ok
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.PORTKEY_API_KEY) {
    throw new Error('PORTKEY_API_KEY is not set in this container')
  }

  const user = await findUser(ADMIN_EMAIL)
  if (!user) throw new Error(`user ${ADMIN_EMAIL} not found`)
  const userId = user._id.toString()
  console.log(`user: ${user.email} (${userId})`)

  const project = await findProject(user._id)
  if (!project) throw new Error(`no project owned by ${ADMIN_EMAIL}`)
  const projectId = project._id.toString()
  const compiler = project.compiler ?? 'pdflatex'
  console.log(`project: ${project.name} (${projectId})`)
  console.log(`model: ${process.env.LLM_MODEL ?? settings.llm?.defaultModel ?? '(unset)'}`)

  bar('SEEDING EMPTY SKELETON')
  const seedFiles = await seedProject(projectId, userId)
  console.log(`seed: ${seedFiles.map(f => f.path).join(', ')}`)

  // ── Run default agent ──────────────────────────────────────────────────────
  const doc = await runAgent(
    'default',
    TASK,
    projectId,
    userId,
    seedFiles,
    project.name,
    compiler
  )

  printRun(doc, 'DEFAULT AGENT — FULL PAPER BUILD')

  // Re-read project after mutations
  const { files: finalFiles } = await loadProjectFiles(projectId)

  console.log('\nproject files after run:')
  for (const f of finalFiles.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log('  ' + f.path)
  }

  bar('ASSERTIONS')
  const passed = assertRun(doc, seedFiles, finalFiles)

  bar('SUMMARY')
  console.log(`status:     ${doc.status}`)
  console.log(`duration:   ${doc.durationMs}ms  (${(doc.durationMs / 1000).toFixed(1)}s)`)
  console.log(`steps:      ${doc.steps?.length ?? 0}`)
  console.log(`assertions: ${passed ? '✅ all passed' : '❌ some failed'}`)

  await mongoClient.close()
  if (!passed) process.exit(1)
}

main().catch(err => {
  console.error('e2e-full-paper failed:', err?.stack ?? err)
  process.exit(1)
})
