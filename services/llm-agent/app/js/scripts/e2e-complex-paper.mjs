#!/usr/bin/env node
// @ts-check

/**
 * End-to-end complex paper generation test.
 *
 * Topic: "The Geometry of Machine Learning: Optimization Landscapes,
 *         Trajectory Control, and Neural Approximations in Aerospace"
 *
 * Tests the agent's ability to:
 *   - Discover and use the skills system without being told which tools to call
 *   - Produce 10 structurally diverse figures (3D, 2D, data-driven, engineering,
 *     CS diagrams, mathematical) by recognising which template fits each task
 *   - Respect specific numerical data given for data-driven diagrams
 *
 * Assertions:
 *   - list_skills called
 *   - read_skill used for ≥ 4 distinct skills
 *   - read_skill called with a template argument ≥ 5 times
 *   - all 10 figure files created
 *   - ≥ 5 section files + refs.bib created
 *   - specific data values appear verbatim in the relevant figures
 *   - final compile succeeded with ≥ 6 pages and 0 errors
 *
 * Run from the llm-agent container:
 *   LLM_MODEL=@deepseek/deepseek-v4-flash \
 *   docker compose exec -e LLM_MODEL=@deepseek/deepseek-v4-flash llm-agent \
 *     node app/js/scripts/e2e-complex-paper.mjs
 */

import { readFileSync, existsSync } from 'fs'
import { ObjectId } from 'mongodb'
import settings from '@overleaf/settings'
import { db, mongoClient } from '../mongodb.js'
import { run as agentRun } from '../AgentManager.js'
import { createRun } from '../AgentStore.js'

const ADMIN_EMAIL = process.env.E2E_USER_EMAIL ?? 'mohamedhani590@gmail.com'

// ── Seed: truly empty ────────────────────────────────────────────────────────

const MAIN_TEX = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\end{document}',
]

// ── Task ─────────────────────────────────────────────────────────────────────

const TASK = `Build a complete, well-written technical paper titled:

  "The Geometry of Machine Learning: Optimization, Trajectory Control,
   and Neural Approximations in Aerospace Engineering"

The paper should run to at least 6 printed pages. Produce all files
from scratch — the project currently contains only a bare main.tex.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Split the paper across these files and \\input them into main.tex:

  sections/abstract.tex
    150 words. Summarise the connection between geometric machine learning,
    loss landscape analysis, and aerospace trajectory optimisation.

  sections/intro.tex
    Two pages of text. Cover: the geometric view of neural network training
    (loss surfaces, critical points), the analogy between gradient flow in
    ML and optimal control in aerospace, and the paper's contributions.
    Cite at least 4 references.

  sections/geometry.tex
    Gradient descent as a flow on a Riemannian manifold. Define the loss
    \\(L(\\mathbf{w})\\) and the gradient flow ODE
    \\(\\dot{\\mathbf{w}} = -\\nabla L(\\mathbf{w})\\).
    Include figure: phase_portrait.tex.
    Include figure: loss_landscape.tex.

  sections/trajectory.tex
    Optimal trajectory planning in 3D state space using Pontryagin's
    minimum principle. Define the state \\((x, y, z, v_x, v_y, v_z)\\)
    and the Hamiltonian. Include figure: trajectory_3d.tex.
    Include figure: parallelepiped.tex.

  sections/neural_control.tex
    Neural approximation of the value function. Describe the network
    architecture: input (state), two hidden layers (64 units, ReLU),
    output (control command). Include figure: attention_matrix.tex.
    Include figure: autopilot_fsm.tex.

  sections/experiments.tex
    Experimental evaluation on a synthetic 3D flight corridor.
    Reference the training curves (figure: training_curves.tex),
    the performance comparison (figure: performance_bars.tex),
    and the Pareto frontier (figure: pareto_frontier.tex).

  sections/conclusion.tex
    One paragraph, 80 words.

  refs.bib
    At least 5 BibTeX entries:
      Pontryagin et al. 1962 (Mathematical Theory of Optimal Processes)
      Bellman 1957 (Dynamic Programming)
      Bengio et al. 2013 (representation learning review)
      Li & Liang 2018 (loss landscape visualisation)
      Duriez, Brunton & Noack 2017 (machine learning for fluid control)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIGURES  (create all 10; place each in the figures/ directory)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

figures/phase_portrait.tex
  A 2D diagram on a coordinate plane (x ∈ [−2, 2], y ∈ [−2, 2]).
  Draw three concentric ellipses centred at the origin — level sets of
  L = x² + 3y² — with semi-axes scaled so the curves are clearly visible.
  From four starting points (±1.8, ±1.2), draw curved arrow paths that
  descend perpendicularly to the ellipses and converge toward the minimum
  at the origin. Mark the origin with a filled circle labelled "w*".
  Caption: "Gradient flow on elliptic loss level sets." Label: fig:phase.

figures/loss_landscape.tex
  A 3D surface plot of L(w₁, w₂) = (w₁ − 1)² + 2(w₂ + 0.5)²
  over w₁ ∈ [−2, 2], w₂ ∈ [−2, 2], with at least 30 samples per axis.
  The global minimum is visually at (1, −0.5). Use a "cool" or "hot"
  colormap. Label the axes w₁, w₂, L.
  Caption: "Quadratic loss landscape; minimum at $(1,\,-0.5)$." Label: fig:landscape.

figures/trajectory_3d.tex
  A 3D coordinate system (labelled x, y, z axes) showing a flight
  trajectory as a smooth curve through 3D space. The curve passes through
  these five waypoints in order:
    (0, 0, 0), (1, 0.5, 2), (2, 1, 3), (3, 1.5, 2.5), (4, 2, 1)
  Project the trajectory onto the xy-plane as a dashed curve.
  Mark each waypoint with a small filled circle and number it (W0–W4).
  Label the trajectory "Optimal path".
  Caption: "3D optimal flight trajectory through five waypoints." Label: fig:traj.

figures/parallelepiped.tex
  Two 3D parallelepipeds drawn side by side in 3D perspective.
  The left one represents the original parameter space (a unit cube).
  The right one represents the rotated space after applying a rotation R.
  Connect corresponding vertices with dashed arrows.
  Label the left "\\(\\mathcal{W}\\)" and the right "\\(R\\mathcal{W}\\)".
  Caption: "Parameter space before and after rotation R." Label: fig:param.

figures/attention_matrix.tex
  A 5×5 grid of filled rectangles representing attention weights between
  five flight phases: Start, Climb, Cruise, Descend, Land (rows = query,
  columns = key). Fill each rectangle with a shade of blue proportional
  to the weight. Use EXACTLY these values (row by row):
    Row 1 (Start):   0.80  0.10  0.05  0.03  0.02
    Row 2 (Climb):   0.15  0.70  0.10  0.03  0.02
    Row 3 (Cruise):  0.05  0.10  0.75  0.07  0.03
    Row 4 (Descend): 0.02  0.03  0.12  0.78  0.05
    Row 5 (Land):    0.01  0.02  0.05  0.15  0.77
  Label each row and column. Include a colour scale on the right.
  Caption: "Self-attention weights across flight phases." Label: fig:attn.

figures/autopilot_fsm.tex
  A finite state machine with six states arranged in a clear layout:
    GROUND, TAKEOFF, CRUISE, APPROACH, LANDING, EMERGENCY
  Transitions (with labels):
    GROUND    → TAKEOFF   : "engines on"
    TAKEOFF   → CRUISE    : "alt > 1000 m"
    CRUISE    → APPROACH  : "dist < 50 km"
    APPROACH  → LANDING   : "alt < 200 m"
    LANDING   → GROUND    : "speed = 0"
    GROUND    → EMERGENCY : "fault"
    TAKEOFF   → EMERGENCY : "fault"
    CRUISE    → EMERGENCY : "fault"
    APPROACH  → EMERGENCY : "fault"
    EMERGENCY → GROUND    : "resolved"
  Draw EMERGENCY in red. All other states in standard style.
  Caption: "Autopilot FSM with emergency fallback." Label: fig:fsm.

figures/training_curves.tex
  A line chart with three optimiser curves over iterations 0 to 100.
  Use EXACTLY these six coordinate pairs for each curve:
    Newton-CG : (0,1.00) (20,0.38) (40,0.14) (60,0.06) (80,0.03) (100,0.02)
    Adam      : (0,1.00) (20,0.52) (40,0.28) (60,0.15) (80,0.09) (100,0.06)
    SGD       : (0,1.00) (20,0.79) (40,0.62) (60,0.49) (80,0.38) (100,0.30)
  Solid blue for Newton-CG, dashed red for Adam, dotted green for SGD.
  x-axis: Iteration; y-axis: Loss (log scale optional). Grid on. Legend.
  Caption: "Convergence of three optimisers on the synthetic task." Label: fig:curves.

figures/performance_bars.tex
  A grouped bar chart comparing five controllers on two metrics.
  Use EXACTLY this data:
    Controller  Accuracy(%)  Latency(ms)
    PID         82.3         14.2
    MPC         91.7         38.5
    RL-PPO      89.4         12.8
    NeuralODE   93.2         45.1
    Ours        94.8         11.3
  One bar group per controller; two bars per group (accuracy left, latency right).
  Use different colours for accuracy and latency bars. Add a legend.
  x-axis: Controller; left y-axis: Accuracy (%); right y-axis may be omitted —
  scaling both metrics to the same axis is acceptable.
  Caption: "Performance comparison of control strategies." Label: fig:bars.

figures/pareto_frontier.tex
  A scatter plot with Latency (ms) on the x-axis [0, 55] and
  Accuracy (%) on the y-axis [78, 98].
  Plot EXACTLY the five points from the performance table above as
  filled circles. Label each point with its controller name.
  Connect the Pareto-optimal points (those not dominated by any other)
  with a dashed line to indicate the Pareto frontier.
  The Pareto-optimal set from the data is: PID, RL-PPO, Ours.
  Caption: "Pareto frontier: accuracy vs. latency trade-off." Label: fig:pareto.

figures/nozzle_section.tex
  A symmetric engineering cross-section of a convergent-divergent rocket
  nozzle. Draw the upper and lower profiles as mirror images about the
  horizontal centre axis. Use the following dimensions:
    Throat diameter  D_t = 12 mm  (narrowest point)
    Exit diameter    D_e = 48 mm  (at right end)
    Total length     L   = 85 mm
  Fill the solid nozzle walls with diagonal hatching.
  Add dimension lines for D_t, D_e, and L with arrows and numeric labels.
  Draw the centre axis as a dash-dot line.
  Caption: "Convergent-divergent nozzle cross-section ($D_t=12\\,\\text{mm}$,
            $D_e=48\\,\\text{mm}$, $L=85\\,\\text{mm}$)." Label: fig:nozzle.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREAMBLE & COMPILATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Build main.tex with all packages required by the figures and text:
  geometry (a4paper, margin=2.5cm), amsmath, amssymb, booktabs,
  tikz with all needed libraries, pgfplots (compat=1.18),
  bibliography style plain.

After writing all files, compile repeatedly until the PDF is error-free.
Report the final page count, any remaining warnings, and which skill
templates you used for each figure.`

// ── Infrastructure ────────────────────────────────────────────────────────────

function basicAuth() {
  return (
    'Basic ' +
    Buffer.from(`${settings.httpAuthUser}:${settings.httpAuthPass}`).toString('base64')
  )
}

async function findUser(email) {
  return await mongoClient.db().collection('users').findOne({ email })
}

async function createFreshProject(userId) {
  const name = `e2e-complex-${Date.now()}`
  const url = `${settings.apis.web.url}/internal/agent/create-project`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuth() },
    body: JSON.stringify({ userId, projectName: name, docLines: MAIN_TEX }),
  })
  if (!res.ok) throw new Error(`create-project failed: ${res.status} ${await res.text()}`)
  const { projectId } = await res.json()
  return { projectId, projectName: name }
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
      if (d?._id && d?.name) out.push({ path: prefix + d.name, docId: d._id.toString() })
    }
    for (const sub of folder.folders ?? []) walk(sub, `${prefix}${sub.name}/`)
  }
  const roots = Array.isArray(p.rootFolder) ? p.rootFolder : p.rootFolder ? [p.rootFolder] : []
  for (const r of roots) walk(r, '')
  return { files: out, projectName: p.name ?? '(unnamed)', compiler: p.compiler ?? 'pdflatex' }
}

async function runAgent(agentName, userMessage, projectId, userId, files, projectName, compiler) {
  const conversationId = new ObjectId().toHexString()
  const main = files.find(f => f.path === 'main.tex') ?? files[0]
  /** @type {import('../types.js').AgentInput} */
  const input = {
    projectId, userId, conversationId, userMessage,
    context: { projectName, compiler, files },
    currentFile: main,
  }
  const startedAt = new Date()
  const runId = await createRun(projectId, input)
  console.log(`[${agentName}] runId=${runId}`)
  await agentRun(runId, input, startedAt, { agentName, maxSteps: Number(process.env.E2E_MAX_STEPS ?? 80) })
  return /** @type {any} */ (await db.agentRuns.findOne({ _id: new ObjectId(runId) }))
}

function shorten(value, n = 120) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return s.replace(/\s+/g, ' ').slice(0, n)
}

function bar(label) { console.log('\n══════════ ' + label + ' ══════════') }

function printRun(doc, label) {
  bar(label)
  console.log(`status=${doc.status}  durationMs=${doc.durationMs}`)
  if (doc.error) console.log(`error: ${doc.error}`)
  console.log('\n--- final output ---')
  console.log(doc.output?.content ?? '(no content)')
  console.log(`\n--- steps (${doc.steps?.length ?? 0}) ---`)
  for (const [i, s] of (doc.steps ?? []).entries()) {
    const md = s.metadata ?? {}
    const calls = (s.output?.toolCalls ?? []).map(c => c.toolName ?? c.name).join(',')
    const text = s.output?.text ? `  text=${shorten(s.output.text, 90)}` : ''
    console.log(
      `  [${i}] [${calls}]${text}  in=${md.inputTokens ?? '?'} out=${md.outputTokens ?? '?'} ms=${md.latencyMs ?? '?'}`
    )
  }
}

// ── Assertions ────────────────────────────────────────────────────────────────

/**
 * Read a file's committed content by docId via document-updater's peek endpoint.
 * Returns the joined lines, or null if the file is unknown or unreachable.
 * @param {string} projectId
 * @param {string} filePath
 * @param {{path: string, docId: string}[]} finalFiles
 * @returns {Promise<string|null>}
 */
async function readProjectFile(projectId, filePath, finalFiles) {
  const entry = finalFiles.find(f => f.path === filePath)
  if (!entry) return null
  const base = `${settings.apis.documentUpdater.url}/project/${projectId}/doc/${entry.docId}`
  // Peek first (Redis-only, lock-free, sees the latest in-flight state). If the
  // doc has been flushed from Redis since the run finished, fall back to the
  // loading endpoint, which reads from docstore.
  try {
    let res = await fetch(`${base}/peek`)
    if (res.status === 404) res = await fetch(base)
    if (!res.ok) return null
    const { lines } = await res.json()
    return Array.isArray(lines) ? lines.join('\n') : null
  } catch {
    return null
  }
}

/**
 * @param {string} projectId
 * @param {{path: string, docId: string}[]} finalFiles
 * @param {string[]} paths
 * @returns {Promise<Map<string, string>>}
 */
async function loadFileContents(projectId, finalFiles, paths) {
  /** @type {Map<string, string>} */
  const out = new Map()
  await Promise.all(
    paths.map(async p => {
      const content = await readProjectFile(projectId, p, finalFiles)
      if (content != null) out.set(p, content)
    })
  )
  return out
}

/**
 * @param {any}    doc
 * @param {any[]}  seedFiles
 * @param {any[]}  finalFiles
 * @param {string} projectId
 * @param {Map<string, string>} fileContents  Real on-disk content of figure files, keyed by path.
 */
function assertRun(doc, seedFiles, finalFiles, projectId, fileContents) {
  let ok = true
  /** @param {boolean} cond @param {string} msg */
  function check(cond, msg) {
    console.log(cond ? `  ✅ ${msg}` : `  ❌ ${msg}`)
    if (!cond) ok = false
  }

  const toolCallContents = (doc.contextItems ?? [])
    .filter(c => c.kind === 'tool_call')
    .map(c => c.content)
  const toolNames = toolCallContents.map(c => c?.name ?? '')

  // ── Skills usage ─────────────────────────────────────────────────────────
  check(toolNames.includes('list_skills'), 'list_skills was called')

  const readSkillCalls = toolCallContents.filter(c => c?.name === 'read_skill')
  check(
    readSkillCalls.length >= 5,
    `read_skill called at least 5 times (got ${readSkillCalls.length})`
  )

  const skillsRead = new Set(readSkillCalls.map(c => c?.args?.name).filter(Boolean))
  check(
    skillsRead.size >= 4,
    `at least 4 distinct skills used (got: ${[...skillsRead].join(', ')})`
  )

  const templateCalls = readSkillCalls.filter(c => c?.args?.template)
  check(
    templateCalls.length >= 5,
    `read_skill called with a specific template ≥ 5 times (got ${templateCalls.length})`
  )

  // ── File creation ─────────────────────────────────────────────────────────
  const seedPaths = new Set(seedFiles.map(f => f.path))
  const newFiles = finalFiles.filter(f => !seedPaths.has(f.path))
  console.log(`  (${newFiles.length} new files: ${newFiles.map(f => f.path).join(', ')})`)

  const finalPaths = new Set(finalFiles.map(f => f.path))
  check(finalPaths.has('refs.bib'), 'refs.bib created')

  const expectedFigures = [
    'figures/phase_portrait.tex',
    'figures/loss_landscape.tex',
    'figures/trajectory_3d.tex',
    'figures/parallelepiped.tex',
    'figures/attention_matrix.tex',
    'figures/autopilot_fsm.tex',
    'figures/training_curves.tex',
    'figures/performance_bars.tex',
    'figures/pareto_frontier.tex',
    'figures/nozzle_section.tex',
  ]
  for (const fig of expectedFigures) {
    check(finalPaths.has(fig), `${fig} created`)
  }

  const sectionFiles = finalFiles.filter(f => f.path.startsWith('sections/'))
  check(
    sectionFiles.length >= 5,
    `at least 5 section files (got ${sectionFiles.length}: ${sectionFiles.map(f => f.path).join(', ')})`
  )

  // ── Data integrity — check specific numbers appear in the committed file content.
  // Reads come from document-updater's peek endpoint (real on-disk state), not
  // from tool-call argument strings, so an agent that issues correct args and
  // then overwrites the file would still fail these assertions.
  /** @param {string} filePath @param {string} value */
  function dataInFile(filePath, value) {
    const content = fileContents.get(filePath)
    if (content == null) return false
    return content.includes(value)
  }

  check(
    dataInFile('figures/training_curves.tex', '0.38'),
    'training_curves.tex contains Newton-CG value 0.38 at iter 20'
  )
  check(
    dataInFile('figures/training_curves.tex', '0.30'),
    'training_curves.tex contains SGD value 0.30 at iter 100'
  )
  check(
    dataInFile('figures/performance_bars.tex', '94.8'),
    'performance_bars.tex contains "Ours" accuracy 94.8'
  )
  check(
    dataInFile('figures/performance_bars.tex', '82.3'),
    'performance_bars.tex contains PID accuracy 82.3'
  )
  check(
    dataInFile('figures/attention_matrix.tex', '0.75') ||
      dataInFile('figures/attention_matrix.tex', '75'),
    'attention_matrix.tex contains Cruise→Cruise weight 0.75'
  )
  check(
    dataInFile('figures/nozzle_section.tex', '12') &&
      dataInFile('figures/nozzle_section.tex', '48'),
    'nozzle_section.tex contains throat 12mm and exit 48mm dimensions'
  )

  // ── Compile result ────────────────────────────────────────────────────────
  const compileOutputs = (doc.contextItems ?? [])
    .filter(c => c.kind === 'tool_output')
    .map(c => c.content)
    .filter(c => c && typeof c === 'object' && 'success' in c && c.status !== 'compile-in-progress')

  const lastCompile = compileOutputs.at(-1)
  check(
    lastCompile?.success === true,
    `final compile succeeded (status=${lastCompile?.status ?? 'n/a'})`
  )
  check(
    (lastCompile?.pageCount ?? 0) >= 6,
    `PDF has at least 6 pages (got ${lastCompile?.pageCount ?? 'n/a'})`
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
  console.log(`model: ${process.env.LLM_MODEL ?? settings.llm?.defaultModel ?? '(unset)'}`)

  bar('CREATING FRESH PROJECT')
  const { projectId, projectName } = await createFreshProject(userId)
  console.log(`project: ${projectName} (${projectId})`)
  const { files: seedFiles, compiler } = await loadProjectFiles(projectId)
  console.log(`seed: ${seedFiles.map(f => f.path).join(', ')}`)

  const doc = await runAgent('default', TASK, projectId, userId, seedFiles, projectName, compiler)

  printRun(doc, 'DEFAULT AGENT — COMPLEX PAPER')

  const { files: finalFiles } = await loadProjectFiles(projectId)
  console.log('\nproject files after run:')
  for (const f of finalFiles.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log('  ' + f.path)
  }

  bar('ASSERTIONS')
  const dataPaths = [
    'figures/training_curves.tex',
    'figures/performance_bars.tex',
    'figures/attention_matrix.tex',
    'figures/nozzle_section.tex',
  ]
  const fileContents = await loadFileContents(projectId, finalFiles, dataPaths)
  for (const p of dataPaths) {
    if (!fileContents.has(p)) {
      console.warn(`  ⚠ could not fetch content for ${p} — data assertions will fail`)
    }
  }
  const passed = assertRun(doc, seedFiles, finalFiles, projectId, fileContents)

  bar('SUMMARY')
  console.log(`status:     ${doc.status}`)
  console.log(`duration:   ${doc.durationMs}ms  (${(doc.durationMs / 1000).toFixed(1)}s)`)
  console.log(`steps:      ${doc.steps?.length ?? 0}`)
  console.log(`assertions: ${passed ? '✅ all passed' : '❌ some failed'}`)

  await mongoClient.close()
  if (!passed) process.exit(1)
}

main().catch(err => {
  console.error('e2e-complex-paper failed:', err?.stack ?? err)
  process.exit(1)
})
