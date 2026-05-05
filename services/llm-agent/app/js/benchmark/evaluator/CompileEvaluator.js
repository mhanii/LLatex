// @ts-check

import { parseLatexLog } from './LatexLogParser.js'

/**
 * @typedef {Object} CompileMetrics
 * @property {boolean} compileSuccess     - status === 'success' && pdfSize > 0
 * @property {string} compileStatus       - raw CLSI status (or 'harness-error')
 * @property {number} errorCount
 * @property {Array<string>} errors
 * @property {number} latexRuns
 * @property {number|null} pdfSizeBytes
 * @property {number} compileMs
 * @property {string|null} outputLogUrl
 * @property {string|null} outputPdfUrl
 * @property {string} [harnessError]      - present when the harness itself failed
 */

/**
 * Drives a CLSI compile against raw LaTeX files. Stateless — every call uses
 * a unique project id under CLSI's namespace ("bench-<runId>-<taskId>") so
 * parallel evaluators don't collide on each other's build dirs.
 */
export class CompileEvaluator {
  /**
   * @param {Object} opts
   * @param {string} opts.clsiUrl       - e.g. http://clsi:3013
   * @param {string} [opts.compiler]    - default 'pdflatex'
   * @param {number} [opts.timeoutSec]  - per-compile budget, default 60
   * @param {(input: RequestInfo, init?: RequestInit) => Promise<Response>} [opts.fetch]
   */
  constructor({ clsiUrl, compiler = 'pdflatex', timeoutSec = 60, fetch: fetchImpl } = {}) {
    if (!clsiUrl) throw new Error('CompileEvaluator requires clsiUrl')
    this.clsiUrl = clsiUrl.replace(/\/$/, '')
    this.compiler = compiler
    this.timeoutSec = timeoutSec
    this.fetch = fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  /**
   * @param {Object} args
   * @param {Array<{path: string, content: string}>} args.files
   * @param {string} args.entrypoint
   * @param {string} args.taskId
   * @param {string} args.runId
   * @returns {Promise<CompileMetrics>}
   */
  async evaluate({ files, entrypoint, taskId, runId }) {
    const projectId = sanitiseProjectId(`bench-${runId}-${taskId}`)
    const url = `${this.clsiUrl}/project/${projectId}/compile`
    const body = {
      compile: {
        resources: files.map(f => ({ path: f.path, content: f.content })),
        rootResourcePath: entrypoint,
        options: {
          compileGroup: 'simple-latex-file',
          compiler: this.compiler,
          timeout: this.timeoutSec,
        },
      },
    }

    const startedAt = Date.now()
    let res
    try {
      res = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      return harnessError(err.message, Date.now() - startedAt)
    }
    const compileMs = Date.now() - startedAt

    if (!res.ok) {
      let detail
      try {
        detail = await res.text()
      } catch {
        detail = ''
      }
      return harnessError(
        `CLSI HTTP ${res.status}: ${detail.slice(0, 200)}`,
        compileMs
      )
    }

    /** @type {any} */
    let payload
    try {
      payload = await res.json()
    } catch (err) {
      return harnessError(`CLSI returned non-JSON: ${err.message}`, compileMs)
    }

    const compile = payload?.compile ?? {}
    const status = compile.status ?? 'unknown'
    const outputFiles = Array.isArray(compile.outputFiles) ? compile.outputFiles : []
    const pdfFile = outputFiles.find(
      f => f?.path === 'output.pdf' || f?.type === 'pdf'
    )
    const logFile = outputFiles.find(
      f => f?.path === 'output.log' || f?.type === 'log'
    )

    const pdfSizeBytes = typeof pdfFile?.size === 'number' ? pdfFile.size : null
    const latexRuns =
      typeof compile?.stats?.['latex-runs'] === 'number'
        ? compile.stats['latex-runs']
        : 0

    let errors = []
    if (logFile?.url) {
      errors = await this._fetchAndParseLog(logFile.url)
    }

    return {
      compileSuccess: status === 'success' && (pdfSizeBytes ?? 0) > 0,
      compileStatus: status,
      errorCount: errors.length,
      errors,
      latexRuns,
      pdfSizeBytes,
      compileMs,
      outputLogUrl: logFile?.url ?? null,
      outputPdfUrl: pdfFile?.url ?? null,
    }
  }

  /**
   * @param {string} url
   * @returns {Promise<string[]>}
   */
  async _fetchAndParseLog(url) {
    try {
      const res = await this.fetch(url)
      if (!res.ok) return []
      const text = await res.text()
      return parseLatexLog(text)
    } catch {
      return []
    }
  }
}

/**
 * @param {string} message
 * @param {number} compileMs
 * @returns {CompileMetrics}
 */
function harnessError(message, compileMs) {
  return {
    compileSuccess: false,
    compileStatus: 'harness-error',
    errorCount: 0,
    errors: [],
    latexRuns: 0,
    pdfSizeBytes: null,
    compileMs,
    outputLogUrl: null,
    outputPdfUrl: null,
    harnessError: message,
  }
}

/**
 * CLSI's project-id route accepts ^[a-zA-Z0-9_-]+$. TeXpert IDs are 8-char
 * hex but normalise defensively.
 * @param {string} raw
 */
function sanitiseProjectId(raw) {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64)
}
