// @ts-check

/**
 * @typedef {Object} JudgeFeedback
 * @property {Array<string>} strengths      - what the model got right
 * @property {Array<string>} weaknesses     - what the model got wrong or missed
 * @property {Array<string>} suggestions    - concrete improvements
 * @property {string} comment               - one-line overall justification
 */

/**
 * @typedef {Object} JudgeResult
 * @property {number} score              - integer in [-1, 10]; -1 if compile failed or judge failed
 * @property {string} reason             - free-text justification (or 'compile-failed' / 'judge-call-failed' / 'judge-empty-response' / 'judge-unparseable')
 * @property {JudgeFeedback} [feedback]  - structured rubric output, present when judge produced parseable JSON
 * @property {string} [rawText]          - full LLM response text, for debugging
 * @property {string} [reasoningText]    - hidden chain-of-thought from reasoning models, for debugging
 * @property {string} [model]            - resolved model name from the provider
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 * @property {number} [latencyMs]
 * @property {string} [harnessError]
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SYSTEM_PROMPT = readFileSync(join(__dirname, 'prompts', 'judge-system.txt'), 'utf8').trim()
const USER_TEMPLATE_RAW = readFileSync(join(__dirname, 'prompts', 'judge-user.txt'), 'utf8')

const USER_TEMPLATE = (task, reference, output) =>
  USER_TEMPLATE_RAW
    .replaceAll('${task}', task)
    .replaceAll('${reference}', reference)
    .replaceAll('${output}', output)

/**
 * LLM-as-judge evaluator. Returns -1 short-circuit when the prior compile
 * failed (no LLM call). Otherwise asks an LLM to score 0-10 with structured
 * feedback.
 */
export class JudgeEvaluator {
  /**
   * @param {Object} opts
   * @param {import('../../providers/LlmProvider.js').LlmProvider} opts.provider
   * @param {string} opts.model
   * @param {number} [opts.temperature]   - default 0
   * @param {number} [opts.maxTokens]     - default 16000
   */
  constructor({ provider, model, temperature = 0, maxTokens = 16000 }) {
    if (!provider) throw new Error('JudgeEvaluator requires provider')
    if (!model) throw new Error('JudgeEvaluator requires model')
    this.provider = provider
    this.model = model
    this.temperature = temperature
    this.maxTokens = maxTokens
  }

  /**
   * @param {Object} args
   * @param {{prompt: string, reference: string}} args.task
   * @param {{files: Array<{path: string, content: string}>, entrypoint: string}} args.output
   * @param {{compileSuccess: boolean}} args.compileResult
   * @returns {Promise<JudgeResult>}
   */
  async evaluate({ task, output, compileResult }) {
    if (!compileResult || !compileResult.compileSuccess) {
      return { score: -1, reason: 'compile-failed' }
    }

    const generated = pickEntrypointContent(output)
    const userPrompt = USER_TEMPLATE(task.prompt, task.reference ?? '', generated)

    let result
    try {
      result = await this.provider.complete({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        model: this.model,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      })
    } catch (err) {
      return {
        score: -1,
        reason: 'judge-call-failed',
        harnessError: err.message || String(err),
      }
    }

    const parsed = parseJudgeResponse(result.text)
    return {
      score: parsed.score,
      reason: parsed.reason,
      feedback: parsed.feedback,
      rawText: result.text,
      reasoningText: result.reasoningText,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
    }
  }
}

/**
 * Pull the model's primary file from the pipeline output. Works for single-
 * file pipelines (DirectLLM) and agentic pipelines that produce a tree.
 */
function pickEntrypointContent(output) {
  if (!output || !Array.isArray(output.files) || output.files.length === 0) return ''
  const root = output.entrypoint ?? 'main.tex'
  const file = output.files.find(f => f.path === root) ?? output.files[0]
  return file.content ?? ''
}

/**
 * Parse a structured JSON judge response. Falls back to scanning the first
 * integer if the model didn't honour the schema (some smaller models forget
 * the format under load), so we still extract a usable score.
 *
 * @param {string} text
 * @returns {{score: number, reason: string, feedback?: import('./JudgeEvaluator.js').JudgeFeedback}}
 */
export function parseJudgeResponse(text) {
  if (!text) return { score: -1, reason: 'judge-empty-response' }
  const trimmed = text.trim()

  const json = extractJson(trimmed)
  if (json && typeof json.score === 'number') {
    const score = clampScore(json.score)
    const feedback = {
      strengths: arrayOfStrings(json.strengths),
      weaknesses: arrayOfStrings(json.weaknesses),
      suggestions: arrayOfStrings(json.suggestions),
      comment: typeof json.comment === 'string' ? json.comment : '',
    }
    return { score, reason: feedback.comment || 'no-reason-given', feedback }
  }

  // Fallback: first integer in [0,10] becomes the score, prose follows.
  const match = /-?\d+/.exec(trimmed)
  if (!match) {
    return { score: -1, reason: `judge-unparseable: ${trimmed.slice(0, 80)}` }
  }
  const score = clampScore(parseInt(match[0], 10))
  const after = trimmed.slice(match.index + match[0].length).trim()
  return { score, reason: after || 'no-reason-given' }
}

function clampScore(n) {
  if (!Number.isFinite(n)) return -1
  return Math.max(0, Math.min(10, Math.round(n)))
}

function arrayOfStrings(v) {
  if (!Array.isArray(v)) return []
  return v.filter(x => typeof x === 'string' && x.trim().length > 0)
}

/**
 * Pull a JSON object out of a string. Tolerates leading prose / code fences
 * by finding the outermost {...}, and tolerates unescaped backslashes in
 * string values (the judge often writes LaTeX like \caption inside the
 * feedback fields, which JSON.parse rejects since \c isn't a valid escape).
 */
function extractJson(s) {
  // Strip ```json fences if present.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s)
  const candidate = fence ? fence[1] : s
  const direct = tolerantJsonParse(candidate)
  if (direct) return direct
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return tolerantJsonParse(candidate.slice(start, end + 1))
}

/**
 * JSON.parse, with a fallback that doubles stray backslashes if the first
 * attempt fails. The alternation matches valid `\\` pairs first (left
 * alone) so only standalone backslashes get doubled — without that, the
 * second `\` of a legitimate escape would itself look standalone and get
 * doubled, breaking valid input. Returns null on hard failure.
 */
function tolerantJsonParse(s) {
  try {
    return JSON.parse(s)
  } catch {}
  const escaped = s.replace(/\\\\|\\(?!["/bfnrtu])/g, m =>
    m === '\\\\' ? m : '\\\\'
  )
  try {
    return JSON.parse(escaped)
  } catch {
    return null
  }
}
