// @ts-check

import fs from 'node:fs'
import path from 'node:path'

/**
 * Streams benchmark rows to a JSONL file as they complete and writes a
 * sibling summary.json with aggregates when finalize() is called.
 */
export class ResultWriter {
  /**
   * @param {Object} opts
   * @param {string} opts.outputPath
   */
  constructor({ outputPath }) {
    this.outputPath = path.resolve(outputPath)
    this.summaryPath = this.outputPath.replace(/\.jsonl$/, '') + '.summary.json'
    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true })
    this.stream = fs.createWriteStream(this.outputPath, { flags: 'w' })
    /** @type {Array<Object>} */
    this.rows = []
  }

  /**
   * @param {Object} row
   */
  write(row) {
    this.rows.push(row)
    this.stream.write(JSON.stringify(row) + '\n')
  }

  /**
   * @param {Object} config  - run-level config snapshot
   * @returns {Promise<{summary: Object, summaryPath: string}>}
   */
  async finalize(config) {
    await new Promise((resolve, reject) => {
      this.stream.end(err => (err ? reject(err) : resolve(undefined)))
    })
    const summary = summarise(this.rows, config)
    await fs.promises.writeFile(this.summaryPath, JSON.stringify(summary, null, 2))
    return { summary, summaryPath: this.summaryPath }
  }
}

/**
 * @param {Array<Object>} rows
 * @param {Object} config
 */
export function summarise(rows, config) {
  /** @type {Record<string, ReturnType<typeof newBucket>>} */
  const buckets = {}
  let totalCompilePass = 0
  let totalDurationMs = 0
  let judgeScoreSumAll = 0
  let judgeScoreSumOnPass = 0
  let judgeScoreCountOnPass = 0
  let judgeAnyPresent = false
  for (const r of rows) {
    const bucket = r.difficulty || 'unknown'
    if (!buckets[bucket]) buckets[bucket] = newBucket()
    const b = buckets[bucket]
    b.n++
    if (r.compile?.compileSuccess) {
      b.compilePass++
      totalCompilePass++
    }
    b.errorsTotal += r.compile?.errorCount ?? 0
    b.latencyTotal += r.latencyMs ?? 0
    b.inputTokensTotal += r.tokens?.input ?? 0
    b.outputTokensTotal += r.tokens?.output ?? 0
    totalDurationMs += r.latencyMs ?? 0
    if (r.judge && typeof r.judge.score === 'number') {
      judgeAnyPresent = true
      b.judgeAll.sum += r.judge.score
      b.judgeAll.n++
      judgeScoreSumAll += r.judge.score
      if (r.judge.score >= 0) {
        b.judgeOnPass.sum += r.judge.score
        b.judgeOnPass.n++
        judgeScoreSumOnPass += r.judge.score
        judgeScoreCountOnPass++
      }
    }
  }
  const byDifficulty = {}
  for (const [name, b] of Object.entries(buckets)) {
    const entry = {
      n: b.n,
      compilePassRate: b.n ? b.compilePass / b.n : 0,
      meanErrors: b.n ? b.errorsTotal / b.n : 0,
      meanLatencyMs: b.n ? b.latencyTotal / b.n : 0,
      meanInputTokens: b.n ? b.inputTokensTotal / b.n : 0,
      meanOutputTokens: b.n ? b.outputTokensTotal / b.n : 0,
    }
    if (judgeAnyPresent) {
      entry.judgeMeanScore = b.judgeAll.n ? b.judgeAll.sum / b.judgeAll.n : null
      entry.judgeMeanScoreOnPass = b.judgeOnPass.n ? b.judgeOnPass.sum / b.judgeOnPass.n : null
    }
    byDifficulty[name] = entry
  }
  const totals = {
    compilePassRate: rows.length ? totalCompilePass / rows.length : 0,
    totalDurationMs,
  }
  if (judgeAnyPresent) {
    totals.judgeMeanScore = rows.length ? judgeScoreSumAll / rows.length : null
    totals.judgeMeanScoreOnPass = judgeScoreCountOnPass
      ? judgeScoreSumOnPass / judgeScoreCountOnPass
      : null
  }
  return {
    config,
    totalTasks: rows.length,
    byDifficulty,
    totals,
  }
}

function newBucket() {
  return {
    n: 0,
    compilePass: 0,
    errorsTotal: 0,
    latencyTotal: 0,
    inputTokensTotal: 0,
    outputTokensTotal: 0,
    judgeAll: { sum: 0, n: 0 },
    judgeOnPass: { sum: 0, n: 0 },
  }
}
