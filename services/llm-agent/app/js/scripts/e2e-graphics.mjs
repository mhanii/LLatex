#!/usr/bin/env node
// @ts-check

/**
 * End-to-end graphics agent driver against the live dev stack.
 *
 * Tests the skills system (list_skills + read_skill) by giving the agent
 * a paper skeleton that needs four figures created from scratch:
 *
 *   1. figures/pipeline.tex    — TikZ flowchart (tikz_flowchart skill)
 *   2. figures/geometry.tex    — TikZ 2D diagram (tikz_2d_graphics skill)
 *   3. figures/loss_plot.tex   — PGFPlots line chart (pgfplots_charts skill)
 *   4. figures/axes_3d.tex     — TikZ 3D coordinate axes (tikz_3d_graphics skill)
 *
 * The preamble of main.tex is intentionally incomplete (no TikZ/pgfplots
 * packages). The agent must:
 *   a) Call list_skills and read_skill for each relevant skill.
 *   b) Create all four figure files with correct LaTeX.
 *   c) Add the required packages to main.tex.
 *   d) Compile to a clean PDF.
 *
 * After the default-agent run, the readonly agent is asked to critically
 * review the generated figures for LaTeX correctness.
 *
 * Assertions (checked automatically):
 *   • list_skills was called at least once.
 *   • read_skill was called at least twice (different skills).
 *   • All four figure files exist in the final project.
 *   • The document compiled successfully (status=success).
 *
 * Run from the llm-agent container:
 *   docker compose exec llm-agent node app/js/scripts/e2e-graphics.mjs
 */

import { ObjectId } from 'mongodb'
import settings from '@overleaf/settings'
import { db, mongoClient } from '../mongodb.js'
import { run as agentRun } from '../AgentManager.js'
import { createRun } from '../AgentStore.js'

const ADMIN_EMAIL = process.env.E2E_USER_EMAIL ?? 'mohamedhani590@gmail.com'

// ── Project skeleton ─────────────────────────────────────────────────────────
// main.tex: four \input{figures/...} targets that don't exist yet.
// Preamble deliberately omits tikz, tikz-3dplot, pgfplots, and their libraries.

const MAIN_TEX = `\\documentclass{article}
\\usepackage{amsmath}
% NOTE: graphics packages are intentionally missing — the agent must add them.
\\title{Visualising Neural Network Training}
\\author{Test Author}
\\date{2026}
\\begin{document}
\\maketitle

\\section{Training pipeline}
Figure~\\ref{fig:pipeline} shows the end-to-end training workflow.
\\input{figures/pipeline}

\\section{Geometry of activations}
The unit-circle interpretation of the softmax normalisation is illustrated
in Figure~\\ref{fig:geometry}.
\\input{figures/geometry}

\\section{Training curves}
Figure~\\ref{fig:loss} shows training and validation loss over 60 epochs.
\\input{figures/loss_plot}

\\section{3D parameter space}
A point in weight-space is shown in Figure~\\ref{fig:axes3d}.
\\input{figures/axes_3d}

\\end{document}
`

const FILES = {
  'main.tex': MAIN_TEX,
}

// ── Task prompts ──────────────────────────────────────────────────────────────

const TASK_DEFAULT = `This LaTeX paper needs four figures created from scratch.
The figures directory does not yet exist — you will need to create each file.
The preamble in main.tex is missing the required graphics packages — add them.

For EACH figure, you MUST:
  1. Call list_skills to see which skills are available.
  2. Call read_skill with the appropriate skill name to load its guide and templates.
  3. Then write the figure file based on what you learned.

Figure specifications:

--- figures/pipeline.tex ---
A flowchart using TikZ showing a 5-step ML training pipeline:
  Load Data → Preprocess → Forward Pass → Compute Loss → Backpropagate
with an arrow from Backpropagate looping back to Forward Pass to indicate
iteration. Use ellipses for start/end, rectangles for process steps.
Wrap in a figure environment with caption "Training pipeline" and label fig:pipeline.

--- figures/geometry.tex ---
A TikZ 2D diagram of a unit circle (radius 1) centred at the origin.
Draw x and y axes with arrowheads.
Mark a point P = (cos 45°, sin 45°) on the circle.
Draw a radius line from the origin to P with a small arc labeling the angle θ=45°.
Draw dashed lines from P down to the x-axis and across to the y-axis to show
the coordinates (cos θ, sin θ). Label the projections.
Wrap in a figure environment with caption "Unit circle geometry" and label fig:geometry.

--- figures/loss_plot.tex ---
A PGFPlots line chart with two curves over x = 1..60 (epochs):
  - Training loss:    f(x) = 2.5 * exp(-0.07*x) + 0.1
  - Validation loss:  g(x) = 2.8 * exp(-0.06*x) + 0.18 + 0.05*sin(10*x)
Use blue for training, red (dashed) for validation.
Add axis labels (Epoch, Loss), a legend, and a grid.
Wrap in a figure environment with caption "Training and validation loss" and label fig:loss.

--- figures/axes_3d.tex ---
A tikz-3dplot figure showing 3D coordinate axes (x, y, z) from a viewpoint
of elevation 70° and azimuth 110°.
Plot a single point P at spherical coordinates r=1, θ=50°, φ=40°.
Draw the vector OP in red, dashed projection lines to the xy-plane, and
small arcs labeling the polar angle θ and azimuthal angle φ.
Wrap in a figure environment with caption "Point in 3D space" and label fig:axes3d.

After creating all four files:
1. Add the required packages to the preamble of main.tex (tikz and any needed
   libraries, tikz-3dplot, pgfplots with compat=1.18).
2. Run compile_and_check. Fix any errors. Recompile until it succeeds.
3. Final response: list each figure file created, the skill(s) used, and the
   final compile status.`

const TASK_READONLY = `Review the four TikZ/PGFPlots figures in this project (figures/pipeline.tex,
figures/geometry.tex, figures/loss_plot.tex, figures/axes_3d.tex).
For each file:
  1. Read the file.
  2. Check that it uses the packages declared in main.tex.
  3. Identify any LaTeX issues: missing \\end{}, undefined commands, missing
     library loads, or incorrect usage of PGFPlots/TikZ syntax.
  4. Verify the figure is wrapped in a figure environment with a caption and label.
Report your findings per file. End with an overall verdict: ready to publish or
needs fixes (and what fixes).`

// ── Helpers (identical to e2e-agents.mjs) ────────────────────────────────────

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
      source: 'e2e-graphics',
      user_id: userId,
      undoing: false,
    }),
  })
  if (!res.ok) {
    throw new Error(`setDoc ${docId} failed: ${res.status} ${await res.text()}`)
  }
}

async function seedProject(projectId, userId) {
  const { files: existing } = await loadProjectFiles(projectId)
  const byPath = Object.fromEntries(existing.map(f => [f.path, f.docId]))

  for (const [path, content] of Object.entries(FILES)) {
    if (byPath[path]) {
      await setDocViaDocUpdater(projectId, byPath[path], content, userId)
    } else {
      await createFileViaWeb(projectId, path, content, userId)
    }
  }
  const { files } = await loadProjectFiles(projectId)
  const finalByPath = Object.fromEntries(files.map(f => [f.path, f.docId]))
  for (const [path, content] of Object.entries(FILES)) {
    await setDocViaDocUpdater(projectId, finalByPath[path], content, userId)
  }
  return files
}

function shorten(value, n = 120) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return s.replace(/\s+/g, ' ').slice(0, n)
}

function bar(label) {
  console.log('\n══════════ ' + label + ' ══════════')
}

async function runOne(agentName, userMessage, projectId, userId, files, projectName, compiler) {
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
  console.log(`[${agentName}] runId=${runId}  conv=${conversationId}`)
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
    const text = s.output?.text ? `text=${shorten(s.output.text, 80)}` : ''
    console.log(
      `[${i}] tools=[${calls}] ${text}  in=${md.inputTokens ?? '?'} out=${md.outputTokens ?? '?'} ms=${md.latencyMs ?? '?'}`
    )
  }

  console.log(
    `\n--- contextItems (${doc.contextItems?.length ?? 0}; * = replaced) ---`
  )
  for (const c of doc.contextItems ?? []) {
    const r = c.replacedBy ? ' *' : ''
    console.log(
      `  ${String(c.kind).padEnd(22)} ${String(c.role).padEnd(9)}${r}  ${shorten(c.content ?? c.ref, 100)}`
    )
  }
}

// ── Assertions ────────────────────────────────────────────────────────────────

/**
 * Check the run doc for required tool usage and compile success.
 * Returns true if all assertions pass.
 *
 * content fields in MongoDB context items are stored as BSON objects, not JSON
 * strings, so we access them directly without JSON.parse.
 *
 * @param {any} doc
 * @param {string[]} expectedFiles  paths that must exist in the final project
 * @param {any[]}    finalFiles     result of loadProjectFiles after the run
 */
function assertRun(doc, expectedFiles, finalFiles) {
  let ok = true

  /** @param {boolean} cond @param {string} msg */
  function check(cond, msg) {
    console.log(cond ? `  ✅ ${msg}` : `  ❌ ${msg}`)
    if (!cond) ok = false
  }

  // content is a BSON object {toolCallId, name, args} for tool_call items
  const toolCallContents = (doc.contextItems ?? [])
    .filter(c => c.kind === 'tool_call')
    .map(c => c.content)
  const toolNames = toolCallContents.map(c => c?.name ?? '')

  check(
    toolNames.includes('list_skills'),
    'list_skills was called'
  )

  const readSkillContents = toolCallContents.filter(c => c?.name === 'read_skill')
  check(
    readSkillContents.length >= 2,
    `read_skill called at least twice (got ${readSkillContents.length})`
  )

  const skillsRead = new Set(
    readSkillContents.map(c => c?.args?.name).filter(Boolean)
  )
  check(
    skillsRead.size >= 2,
    `at least 2 distinct skills read (got: ${[...skillsRead].join(', ')})`
  )

  // Figure files created
  const finalPaths = new Set(finalFiles.map(f => f.path))
  for (const p of expectedFiles) {
    check(finalPaths.has(p), `figure file created: ${p}`)
  }

  // Compile succeeded — tool_output content is {success, status, errors, ...}
  const compileOutputs = (doc.contextItems ?? [])
    .filter(c => c.kind === 'tool_output')
    .map(c => c.content)
    .filter(c => c && typeof c === 'object' && 'success' in c)
  const lastCompile = compileOutputs.at(-1)
  check(
    lastCompile?.success === true,
    `final compile_and_check succeeded (status=${lastCompile?.status ?? 'n/a'})`
  )

  return ok
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.PORTKEY_API_KEY) {
    throw new Error('PORTKEY_API_KEY is not set in this container')
  }

  const user = await findUser(ADMIN_EMAIL)
  if (!user) throw new Error(`user ${ADMIN_EMAIL} not found in mongo`)
  const userId = user._id.toString()
  console.log(`user: ${user.email} (${userId})`)

  const project = await findProject(user._id)
  if (!project) {
    throw new Error(
      `no project owned by ${ADMIN_EMAIL}. Create one in the UI first.`
    )
  }
  const projectId = project._id.toString()
  console.log(`project: ${project.name} (${projectId})`)
  console.log(
    `model: ${process.env.LLM_MODEL ?? settings.llm?.defaultModel ?? '(unset)'}`
  )

  bar('SEEDING PROJECT SKELETON')
  const seedFiles = await seedProject(projectId, userId)
  console.log('seeded files: ' + seedFiles.map(f => f.path).join(', '))

  // ── Phase 1: default agent creates all four figures ────────────────────────
  const defDoc = await runOne(
    'default',
    TASK_DEFAULT,
    projectId,
    userId,
    seedFiles,
    project.name,
    project.compiler ?? 'pdflatex'
  )
  printRun(defDoc, 'DEFAULT AGENT — CREATE FIGURES')

  // Re-read project file list after agent mutations
  const { files: afterFiles } = await loadProjectFiles(projectId)
  console.log('\nproject files after default agent:')
  for (const f of afterFiles) console.log('  ' + f.path)

  const EXPECTED_FIGURES = [
    'figures/pipeline.tex',
    'figures/geometry.tex',
    'figures/loss_plot.tex',
    'figures/axes_3d.tex',
  ]

  bar('ASSERTIONS — DEFAULT AGENT')
  const defOk = assertRun(defDoc, EXPECTED_FIGURES, afterFiles)

  // ── Phase 2: readonly agent reviews the generated figures ──────────────────
  const roDoc = await runOne(
    'readonly',
    TASK_READONLY,
    projectId,
    userId,
    afterFiles,
    project.name,
    project.compiler ?? 'pdflatex'
  )
  printRun(roDoc, 'READONLY AGENT — REVIEW FIGURES')

  // ── Final summary ──────────────────────────────────────────────────────────
  bar('SUMMARY')
  console.log(`default agent: ${defDoc.status}  (${defDoc.durationMs}ms)`)
  console.log(`readonly agent: ${roDoc.status}  (${roDoc.durationMs}ms)`)
  console.log(`assertions: ${defOk ? '✅ all passed' : '❌ some failed'}`)

  await mongoClient.close()

  if (!defOk) process.exit(1)
}

main().catch(err => {
  console.error('e2e-graphics failed:', err?.stack ?? err)
  process.exit(1)
})
