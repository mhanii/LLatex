#!/usr/bin/env node
// @ts-check

/**
 * End-to-end agent driver against the live dev stack.
 *
 * Self-contained:
 *   1. Looks up the admin user by email (E2E_USER_EMAIL, default
 *      mohamedhani590@gmail.com).
 *   2. Finds the user's "Test" project, or any project they own.
 *   3. Replaces main.tex with a deliberately-buggy LaTeX paper and creates
 *      chapters/* + refs.bib via the existing internal endpoints (no UI).
 *   4. Runs the readonly agent (audit-only), then resets content and runs the
 *      default agent (audit-and-fix).
 *   5. Prints contextItems[] + steps[] for each run.
 *
 * Run from the llm-agent container so web/docUpdater/chat/CLSI hostnames resolve:
 *   docker compose exec llm-agent node app/js/scripts/e2e-agents.mjs
 */

import { ObjectId } from 'mongodb'
import settings from '@overleaf/settings'
import { db, mongoClient } from '../mongodb.js'
import { run as agentRun } from '../AgentManager.js'
import { createRun } from '../AgentStore.js'

const ADMIN_EMAIL = process.env.E2E_USER_EMAIL ?? 'mohamedhani590@gmail.com'

// ── Buggy LaTeX project ─────────────────────────────────────────────────────
// Eight deliberate bugs across four files — the agents must find them all.

const MAIN_TEX = `\\documentclass{article}
\\usepackage{amsmath,graphicx}
\\title{Reinforcement Learning for Robotic Manipulation}
\\author{Hani M.}
\\date{April 2026}
\\begin{document}
\\maketitle

\\input{chapters/intro}
\\input{chapters/methods}
\\input{chapters/results}

\\bibliographystyle{plain}
\\bibliography{refs}
\\end{document}
`

const INTRO_TEX = `\\section{Introduction}\\label{sec:intro}
Reinforcement learning has shown promise in robotic manipulation~\\cite{schulman2017}.
We extend the SAC algorithm~\\cite{haarnoja2018} and build on prior work~\\cite{andrychowicz2020}.
For motivation see Figure~\\ref{fig:teaser-old} which shows our task suite.
The remainder of this paper is structured as outlined in Section~\\ref{sec:ablation}.
`

const METHODS_TEX = `\\section{Method}\\label{sec:method}
We optimise the policy gradient with the entropy-regularised objective:
\\begin{equation}\\label{eq:loss}
\\mathcal{L}(\\theta) = \\mathbb{E}_{(s,a)\\sim\\pi_\\theta}\\left[Q(s,a) - \\alpha \\log \\pi_\\theta(a|s)\\right]
\\end{equation}
The temperature $\\alpha$ is auto-tuned per~\\cite{nokey2024}.

\\subsection{Network architecture}
The actor and critic share a CNN backbone described below.
\\begin{equation}
y = W_2 \\, \\mathrm{ReLU}(W_1 x + b_1) + b_2

We train with batch size 256 for 1M steps.
`

const RESULTS_TEX = `\\section{Results}\\label{sec:results}
We compare against the baseline in Table~\\ref{tab:results}. The headline numbers
are summarised in Equation~\\ref{eq:loss} (defined above).

\\begin{equation}\\label{eq:loss}
J(\\pi) = \\mathbb{E}\\left[\\sum_t \\gamma^t r_t\\right]
\\end{equation}
`

// Intentionally only one of four cited keys is present.
const REFS_BIB = `@article{schulman2017,
  title  = {Proximal Policy Optimization Algorithms},
  author = {Schulman, John and Wolski, Filip and others},
  year   = {2017}
}
`

const FILES = {
  'main.tex': MAIN_TEX,
  'chapters/intro.tex': INTRO_TEX,
  'chapters/methods.tex': METHODS_TEX,
  'chapters/results.tex': RESULTS_TEX,
  'refs.bib': REFS_BIB,
}

// Bug inventory (for reference; the agents have to discover these themselves):
//   1. \cite{haarnoja2018}        — undefined (only schulman2017 is in refs.bib)
//   2. \cite{andrychowicz2020}    — undefined
//   3. \cite{nokey2024}           — undefined
//   4. \ref{fig:teaser-old}       — undefined (no figure with that label exists)
//   5. \ref{tab:results}          — undefined (no table with that label exists)
//   6. \ref{sec:ablation}         — undefined (no \label{sec:ablation})
//   7. \label{eq:loss}            — duplicated in methods.tex and results.tex
//   8. \begin{equation}…          — unbalanced, missing \end{equation} in methods.tex

const TASKS = {
  default: `Audit this LaTeX project end-to-end and FIX every issue you find.

Procedure (do not skip steps):
1. list_files. Then for every .tex and .bib file, read_file the entire file.
2. Run check_syntax on the whole project (no path argument).
3. For every \\cite{key}, verify the key exists in refs.bib. For every \\ref{label}, verify a matching \\label is defined somewhere. Note duplicate labels.
4. Look for unbalanced \\begin/\\end environments and broken \\input/\\include targets.
5. Fix EVERY issue using edit_file. Use small, exact replacements. After each batch of fixes, re-run check_syntax to confirm.
6. When check_syntax is clean, run compile_and_check. If it still errors, fix the errors and recompile until it succeeds.
7. Final answer: a structured summary listing each issue you found, the file and line, and exactly what you changed. End with the final compile status.

Be exhaustive. Do not stop at the first issue.`,

  readonly: `Audit this LaTeX project for correctness and produce a thorough report. You CANNOT modify files — read-only.

Procedure (do not skip steps):
1. list_files. Then for every .tex and .bib file, read_file the entire file.
2. Run check_syntax on the whole project (no path argument).
3. Cross-reference manually: for every \\cite{key}, confirm the key is defined in refs.bib. For every \\ref{label}, confirm a matching \\label exists. Note duplicate labels and unbalanced \\begin/\\end environments.
4. Run compile_and_check to capture any runtime LaTeX errors that static analysis missed.
5. Final answer: a structured report grouped by file. For each file list undefined citations, undefined references, duplicate labels, unbalanced environments, broken \\input/\\include targets, and compile errors — with line numbers wherever possible. End with a confidence note flagging anything you were unsure about.

Be exhaustive. Quote line numbers, not guesses.`,
}

// ── Helpers ────────────────────────────────────────────────────────────────

function basicAuth() {
  return (
    'Basic ' +
    Buffer.from(
      `${settings.httpAuthUser}:${settings.httpAuthPass}`
    ).toString('base64')
  )
}

async function findUser(email) {
  return await mongoClient
    .db()
    .collection('users')
    .findOne({ email })
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
  /**
   * @param {any} folder
   * @param {string} prefix
   */
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
      source: 'e2e-script',
      user_id: userId,
      undoing: false,
    }),
  })
  if (!res.ok) {
    throw new Error(
      `setDoc ${docId} failed: ${res.status} ${await res.text()}`
    )
  }
}

async function seedBuggyContent(projectId, userId) {
  const { files: existing } = await loadProjectFiles(projectId)
  const byPath = Object.fromEntries(existing.map(f => [f.path, f.docId]))

  for (const [path, content] of Object.entries(FILES)) {
    if (byPath[path]) {
      await setDocViaDocUpdater(projectId, byPath[path], content, userId)
    } else {
      await createFileViaWeb(projectId, path, content, userId)
    }
  }
  // After create, re-resolve to get newly assigned docIds, then ensure content
  // matches (create-file accepts content but is upsert-based, so this is a
  // redundant safety pass — and ensures the file is in docUpdater redis).
  const { files } = await loadProjectFiles(projectId)
  const finalByPath = Object.fromEntries(files.map(f => [f.path, f.docId]))
  for (const [path, content] of Object.entries(FILES)) {
    await setDocViaDocUpdater(
      projectId,
      finalByPath[path],
      content,
      userId
    )
  }
  return files
}

function shorten(value, n = 100) {
  const s =
    typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return s.replace(/\s+/g, ' ').slice(0, n)
}

function bar(label) {
  console.log('\n══════════ ' + label + ' ══════════')
}

async function runOne(agentName, projectId, userId, files, projectName, compiler) {
  const conversationId = new ObjectId().toHexString()
  const main = files.find(f => f.path === 'main.tex') ?? files[0]
  /** @type {import('../types.js').AgentInput} */
  const input = {
    projectId,
    userId,
    conversationId,
    userMessage: TASKS[agentName],
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
      `  ${String(c.kind).padEnd(22)} ${String(c.role).padEnd(9)}${r}  ${shorten(c.content ?? c.ref, 80)}`
    )
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

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

  bar('SEEDING BUGGY PROJECT')
  let files = await seedBuggyContent(projectId, userId)
  console.log('files: ' + files.map(f => f.path).join(', '))

  // readonly first (no mutations), then default (will edit)
  const roDoc = await runOne(
    'readonly',
    projectId,
    userId,
    files,
    project.name,
    project.compiler ?? 'pdflatex'
  )
  printRun(roDoc, 'READONLY AGENT')

  // re-seed before default since the readonly path is non-mutating but content
  // could have drifted from any other writes; cheap to be safe
  files = await seedBuggyContent(projectId, userId)
  const defDoc = await runOne(
    'default',
    projectId,
    userId,
    files,
    project.name,
    project.compiler ?? 'pdflatex'
  )
  printRun(defDoc, 'DEFAULT AGENT')

  await mongoClient.close()
}

main().catch(err => {
  console.error('e2e failed:', err?.stack ?? err)
  process.exit(1)
})
