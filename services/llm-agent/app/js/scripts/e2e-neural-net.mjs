#!/usr/bin/env node
// @ts-check

/**
 * End-to-end neural-network paper generation test.
 *
 * Seeds a single near-empty main.tex and asks the default agent to build a
 * complete technical paper on neural networks. The paper requires five figures
 * that are structurally different from any skill template — the agent must
 * genuinely adapt what it reads, not copy-paste:
 *
 *   neuron.tex      — weighted-input neuron graph   (≠ shapes / arrows templates)
 *   mlp.tex         — layered MLP architecture       (≠ any existing template)
 *   activations.tex — sigmoid/ReLU/tanh chart with annotation arrows
 *   backprop.tex    — computation DAG with forward+backward edges
 *   training.tex    — train/val loss curves with shaded overfitting region
 *
 * Assertions (all must pass):
 *   • list_skills called at least once
 *   • read_skill called at least 5 times (index + template calls)
 *   • at least 3 distinct skills read
 *   • at least 5 figure files created
 *   • at least 4 section files created
 *   • refs.bib created
 *   • final compile succeeded
 *   • PDF has at least 5 pages
 *   • zero compile errors
 *
 * Run from the llm-agent container:
 *   LLM_MODEL=@deepseek/deepseek-v4-flash \
 *   docker compose exec llm-agent node app/js/scripts/e2e-neural-net.mjs
 */

import { ObjectId } from 'mongodb'
import settings from '@overleaf/settings'
import { db, mongoClient } from '../mongodb.js'
import { run as agentRun } from '../AgentManager.js'
import { createRun } from '../AgentStore.js'

const ADMIN_EMAIL = process.env.E2E_USER_EMAIL ?? 'mohamedhani590@gmail.com'

// ── Seed ──────────────────────────────────────────────────────────────────────

const MAIN_TEX = `\\documentclass{article}
\\begin{document}
\\end{document}
`

// ── Task ──────────────────────────────────────────────────────────────────────

const TASK = `Build a complete, well-written technical paper titled
"Neural Networks: Architecture, Learning, and Visualisation".

The paper must be at least 5 pages when compiled. Follow every requirement
below exactly; do not skip or simplify any section or figure.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRUCTURE  (\\input each file into main.tex)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  sections/abstract.tex
    One paragraph (~100 words) summarising the paper.

  sections/intro.tex
    Two to three paragraphs: history of neural networks (McCulloch & Pitts 1943,
    Rosenblatt 1958 perceptron, Rumelhart 1986 backprop, LeCun 1989 CNNs);
    motivation; cite at least 3 references.

  sections/theory.tex
    Mathematical definition of a single neuron:
      z = w^T x + b,  y = σ(z)
    where σ is the activation function. State the cross-entropy loss for binary
    classification as a displayed equation. Introduce the chain rule as the
    foundation for backpropagation, with the partial-derivative notation
    \\partial L / \\partial w_i.

  sections/architectures.tex
    Describe the multi-layer perceptron (MLP): layers, depth, width, forward
    pass. Include the figure mlp.tex here. Briefly describe convolutional
    networks (CNN) and recurrent networks (RNN) in one paragraph each.
    Include a small comparison table (tabular / booktabs) with columns:
    Architecture | Input type | Key operation | Typical task.

  sections/training.tex
    Explain gradient descent, learning rate, mini-batches, and epochs.
    Describe the vanishing gradient problem. Include the figure backprop.tex to
    illustrate a computation graph. Include the figure training.tex to show
    typical training dynamics and the overfitting phenomenon.

  sections/conclusion.tex
    One concluding paragraph (50–80 words).

  refs.bib
    BibTeX entries for at least 4 real-looking references:
      McCulloch & Pitts 1943 (logical calculus of ideas),
      Rosenblatt 1958 (perceptron),
      Rumelhart, Hinton & Williams 1986 (backprop),
      LeCun et al. 1989 (CNN handwriting recognition).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIGURES  — use list_skills then read_skill for each one.
          Read the guide index first, pick the closest template,
          then read that template. Adapt it — do not copy it verbatim.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

figures/neuron.tex  (\\input in sections/theory.tex)
  A single artificial neuron diagram drawn with TikZ.
  — Three input nodes on the left: x_1, x_2, x_3 (draw as small filled circles).
  — Three labelled weighted edges: w_1, w_2, w_3 (arrows pointing right).
  — A central summation node labelled Σ (larger circle, slightly shaded).
  — One edge from Σ to an activation node labelled σ (circle).
  — One output edge from σ labelled ŷ.
  — Node spacing: inputs in a vertical column, Σ and σ positioned to the right.
  This is a weighted graph, not a flowchart. Use TikZ directly; pick the most
  relevant skill template as a reference for node/arrow styles.
  Caption: "Single artificial neuron." Label: fig:neuron.

figures/mlp.tex  (\\input in sections/architectures.tex, before the table)
  A multi-layer perceptron drawn with TikZ.
  — Three layers: input (3 nodes), hidden (4 nodes), output (2 nodes).
  — Draw every inter-layer connection as a thin gray line.
  — Draw all nodes as filled circles (input: white, hidden: blue!20, output: red!20).
  — Label each layer below: "Input", "Hidden", "Output".
  — Layer columns should be horizontally spaced ~2.5 cm apart; nodes within a
    column vertically spaced ~1 cm apart and vertically centred.
  This is a dense bipartite graph — very different from a flowchart or FSM.
  Caption: "Three-layer MLP architecture." Label: fig:mlp.

figures/activations.tex  (\\input in sections/theory.tex, after the equations)
  A PGFPlots line chart comparing three activation functions on x ∈ [−3, 3]:
    sigmoid: y = 1 / (1 + e^{-x})
    ReLU:    y = max(0, x)       (use {max(0, x)} in pgfplots)
    tanh:    y = tanh(x)
  — 150 samples, y-axis from −1.2 to 1.2.
  — Solid blue for sigmoid, dashed red for ReLU, dotted green for tanh.
  — Legend top-left. x-axis label: $x$, y-axis label: Activation.
  — Add a vertical dashed gray line at x = 0.
  — Annotate the sigmoid curve at (2, 0.88) with a small node: "σ saturates".
  This uses pgfplots but with mathematical activation functions, annotation
  nodes, and a reference line — adapt the line_plot template accordingly.
  Caption: "Comparison of activation functions." Label: fig:activations.

figures/backprop.tex  (\\input in sections/training.tex)
  A computation graph (DAG) for backpropagation, drawn with TikZ.
  Six nodes arranged left-to-right:
    a (input)  →  [×]  →  z  →  [σ]  →  ŷ  →  L (loss)
    b (input)  ↗
  — Solid black arrows for the forward pass (left to right), each labelled
    with the operation or value being passed.
  — Dashed red arrows for the backward pass (right to left), each labelled
    with the gradient: ∂L/∂ŷ, ∂L/∂z, ∂L/∂a, ∂L/∂b.
  — Operation nodes [×] and [σ] drawn as rectangles; variable nodes as circles.
  This is a DAG, not a state machine. Use the tcp_state_machine or flowchart
  template only as a stylistic reference for node/arrow styling.
  Caption: "Computation graph showing forward (black) and backward (red dashed) passes." Label: fig:backprop.

figures/training.tex  (\\input in sections/training.tex, after backprop)
  A PGFPlots line chart showing training dynamics over 100 epochs:
    Training loss:   L_train(t) = 0.9 * exp(-0.035*t) + 0.08
    Validation loss: L_val(t)   = 0.9 * exp(-0.030*t) + 0.08 + 0.003*max(0, t-70)
  (approximate these with addplot expressions)
  — Solid blue line for training loss, dashed red for validation loss.
  — Add a filled, semi-transparent gray region (using \\addplot[fill=gray!20])
    between x=70 and x=100 to highlight the overfitting zone.
  — Annotate the shaded region with a node: "overfitting".
  — x-axis label: Epoch, y-axis label: Loss. Grid on. Legend bottom-left.
  This is structurally different from the line_plot or surface templates —
  it requires a filled region and an annotation. Adapt accordingly.
  Caption: "Training and validation loss curves." Label: fig:training.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREAMBLE & COMPILATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Update main.tex with all \\usepackage commands required:
  amsmath, amssymb, tikz (with relevant usetikzlibrary calls),
  pgfplots with \\pgfplotsset{compat=1.18},
  pgfplotsset fillbetween library (\\usetikzlibrary{pgfplots.fillbetween}),
  booktabs, geometry (a4paper, margin=2.5cm).
Include all \\input{sections/...} and \\input{figures/...} in the correct order.
Add \\bibliography{refs} and \\bibliographystyle{plain}.

After writing all files:
1. Run check_syntax on the whole project.
2. Run compile_and_check. Fix every error. Keep recompiling until it succeeds.
3. Check get_pdf_page on pages 1–3 to verify the layout looks correct.
4. Final response: list all created files, which skill + template was used for
   each figure, and the final compile result (page count, errors).`

// ── Infrastructure (shared with other e2e scripts) ────────────────────────────

function basicAuth() {
  return (
    'Basic ' +
    Buffer.from(`${settings.httpAuthUser}:${settings.httpAuthPass}`).toString(
      'base64'
    )
  )
}

async function findUser(email) {
  return await mongoClient.db().collection('users').findOne({ email })
}

async function createFreshProject(userId) {
  const name = `e2e-neural-net-${Date.now()}`
  const url = `${settings.apis.web.url}/internal/agent/create-project`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuth(),
    },
    body: JSON.stringify({ userId, projectName: name, docLines: MAIN_TEX.split('\n') }),
  })
  if (!res.ok) {
    throw new Error(`create-project failed: ${res.status} ${await res.text()}`)
  }
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


function shorten(value, n = 120) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return s.replace(/\s+/g, ' ').slice(0, n)
}

function bar(label) {
  console.log('\n══════════ ' + label + ' ══════════')
}

async function runAgent(
  agentName,
  userMessage,
  projectId,
  userId,
  files,
  projectName,
  compiler
) {
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
 * @param {any[]}  seedFiles
 * @param {any[]}  finalFiles
 */
function assertRun(doc, seedFiles, finalFiles) {
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

  // ── Skill tool usage ───────────────────────────────────────────────────────
  check(toolNames.includes('list_skills'), 'list_skills was called')

  const readSkillCalls = toolCallContents.filter(c => c?.name === 'read_skill')
  check(
    readSkillCalls.length >= 5,
    `read_skill called at least 5 times (got ${readSkillCalls.length})`
  )

  const skillsRead = new Set(
    readSkillCalls.map(c => c?.args?.name).filter(Boolean)
  )
  check(
    skillsRead.size >= 3,
    `at least 3 distinct skills read (got: ${[...skillsRead].join(', ')})`
  )

  const templateCalls = readSkillCalls.filter(c => c?.args?.template)
  check(
    templateCalls.length >= 3,
    `read_skill called with a specific template at least 3 times (got ${templateCalls.length})`
  )

  // ── File creation ──────────────────────────────────────────────────────────
  const seedPaths = new Set(seedFiles.map(f => f.path))
  const newFiles = finalFiles.filter(f => !seedPaths.has(f.path))
  console.log(
    `  (${newFiles.length} new files: ${newFiles.map(f => f.path).join(', ')})`
  )

  const finalPaths = new Set(finalFiles.map(f => f.path))

  check(finalPaths.has('refs.bib'), 'refs.bib created')

  const figureFiles = finalFiles.filter(f => f.path.startsWith('figures/'))
  check(
    figureFiles.length >= 5,
    `at least 5 figure files created (got ${figureFiles.length}: ${figureFiles.map(f => f.path).join(', ')})`
  )

  const sectionFiles = finalFiles.filter(f => f.path.startsWith('sections/'))
  check(
    sectionFiles.length >= 4,
    `at least 4 section files created (got ${sectionFiles.length}: ${sectionFiles.map(f => f.path).join(', ')})`
  )

  const expectedFigures = [
    'figures/neuron.tex',
    'figures/mlp.tex',
    'figures/activations.tex',
    'figures/backprop.tex',
    'figures/training.tex',
  ]
  for (const fig of expectedFigures) {
    check(finalPaths.has(fig), `${fig} was created`)
  }

  // ── Compile result ─────────────────────────────────────────────────────────
  // Ignore compile-in-progress (race between rapid calls); find last definitive result
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
    (lastCompile?.pageCount ?? 0) >= 5,
    `PDF has at least 5 pages (got ${lastCompile?.pageCount ?? 'n/a'})`
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
  console.log(
    `model: ${process.env.LLM_MODEL ?? settings.llm?.defaultModel ?? '(unset)'}`
  )

  bar('CREATING FRESH PROJECT')
  const { projectId, projectName } = await createFreshProject(userId)
  console.log(`project: ${projectName} (${projectId})`)
  const { files: seedFiles, compiler } = await loadProjectFiles(projectId)
  console.log(`seed: ${seedFiles.map(f => f.path).join(', ')}`)

  const doc = await runAgent(
    'default',
    TASK,
    projectId,
    userId,
    seedFiles,
    projectName,
    compiler
  )

  printRun(doc, 'DEFAULT AGENT — NEURAL NETWORK PAPER')

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
  console.error('e2e-neural-net failed:', err?.stack ?? err)
  process.exit(1)
})
