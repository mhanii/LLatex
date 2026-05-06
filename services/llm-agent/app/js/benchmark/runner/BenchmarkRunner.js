// @ts-check

import { ResultWriter } from './ResultWriter.js'

/**
 * Orchestrates dataset × pipeline × evaluator. Writes a JSONL row per task
 * and a summary.json at the end.
 *
 * With batchSize > 1, runs a 2-stage pipeline: while batch K is being
 * evaluated (compile + judge), batch K+1 is being generated. Within a batch,
 * tasks run fully concurrently. JSONL rows are written in dataset order.
 */
export class BenchmarkRunner {
  /**
   * @param {Object} opts
   * @param {import('../datasets/Dataset.js').Dataset} opts.dataset
   * @param {import('../pipelines/Pipeline.js').Pipeline} opts.pipeline
   * @param {import('../evaluator/CompileEvaluator.js').CompileEvaluator} opts.evaluator
   * @param {import('../evaluator/JudgeEvaluator.js').JudgeEvaluator} [opts.judge]
   * @param {Object} opts.config            - snapshot recorded on every row
   * @param {(msg: string) => void} [opts.log]
   * @param {number} [opts.batchSize]       - default 1 (sequential)
   */
  constructor({ dataset, pipeline, evaluator, judge, config, log, batchSize }) {
    this.dataset = dataset
    this.pipeline = pipeline
    this.evaluator = evaluator
    this.judge = judge ?? null
    this.config = config
    this.log = log ?? (() => {})
    this.batchSize = batchSize && batchSize > 0 ? Math.floor(batchSize) : 1
  }

  /**
   * @param {Object} args
   * @param {import('../datasets/Dataset.js').TaskFilter} [args.filter]
   * @param {string} args.outputPath
   * @returns {Promise<{summary: Object, outputPath: string, summaryPath: string}>}
   */
  async run({ filter, outputPath }) {
    await this.dataset.load()
    const writer = new ResultWriter({ outputPath })
    const runId = makeRunId()

    const tasks = []
    for (const t of this.dataset.iter(filter)) tasks.push(t)

    /** @type {Promise<Array<Object>>|null} */
    let prevEvalPromise = null
    let firstIndexInBatch = 1

    for (let b = 0; b < tasks.length; b += this.batchSize) {
      const batch = tasks.slice(b, b + this.batchSize)
      const startIdx = firstIndexInBatch
      firstIndexInBatch += batch.length

      this.log(
        `batch ${b / this.batchSize + 1} [${startIdx}..${startIdx + batch.length - 1}]: ${batch.map(t => t.id).join(', ')}`
      )

      const genPromise = Promise.all(
        batch.map(task => this._generate(task))
      )

      const [genResults, prevRows] = await Promise.all([
        genPromise,
        prevEvalPromise ?? Promise.resolve(null),
      ])

      if (prevRows) {
        for (const row of prevRows) writer.write(row)
      }

      prevEvalPromise = this._evaluateBatch(batch, genResults, runId, startIdx)
    }

    if (prevEvalPromise) {
      const finalRows = await prevEvalPromise
      for (const row of finalRows) writer.write(row)
    }

    const { summary, summaryPath } = await writer.finalize({
      ...this.config,
      runId,
      datasetName: this.dataset.name,
      datasetVersion: this.dataset.version,
      pipelineName: this.pipeline.name,
      filter: filter ?? null,
      batchSize: this.batchSize,
    })
    return { summary, outputPath: writer.outputPath, summaryPath }
  }

  /**
   * @param {import('../datasets/Dataset.js').Task} task
   * @returns {Promise<{output: import('../pipelines/Pipeline.js').PipelineOutput|null, pipelineError: string|null, pipelineMs: number}>}
   */
  async _generate(task) {
    const startedAt = Date.now()
    let output = null
    let pipelineError = null
    try {
      output = await this.pipeline.run({
        prompt: task.prompt,
        metadata: { difficulty: task.difficulty },
      })
    } catch (err) {
      pipelineError = err.message || String(err)
    }
    return { output, pipelineError, pipelineMs: Date.now() - startedAt }
  }

  /**
   * @param {Array<import('../datasets/Dataset.js').Task>} batch
   * @param {Array<{output: import('../pipelines/Pipeline.js').PipelineOutput|null, pipelineError: string|null, pipelineMs: number}>} genResults
   * @param {string} runId
   * @param {number} startIdx
   * @returns {Promise<Array<Object>>}
   */
  async _evaluateBatch(batch, genResults, runId, startIdx) {
    return Promise.all(
      batch.map((task, i) =>
        this._evaluateOne({
          task,
          gen: genResults[i],
          runId,
          taskNumber: startIdx + i,
        })
      )
    )
  }

  /**
   * @param {{task: import('../datasets/Dataset.js').Task, gen: {output: import('../pipelines/Pipeline.js').PipelineOutput|null, pipelineError: string|null, pipelineMs: number}, runId: string, taskNumber: number}} args
   */
  async _evaluateOne({ task, gen, runId, taskNumber }) {
    const { output, pipelineError, pipelineMs } = gen

    let compile
    if (output && output.files.length > 0 && !output.error) {
      compile = await this.evaluator.evaluate({
        files: output.files,
        entrypoint: output.entrypoint,
        taskId: task.id,
        runId,
      })
    } else {
      compile = {
        compileSuccess: false,
        compileStatus: 'pipeline-error',
        errorCount: 0,
        errors: [],
        latexRuns: 0,
        pdfSizeBytes: null,
        compileMs: 0,
        outputLogUrl: null,
        outputPdfUrl: null,
      }
    }

    let judge = null
    if (this.judge) {
      judge = await this.judge.evaluate({
        task: { prompt: task.prompt, reference: task.reference },
        output: output ?? { files: [], entrypoint: null },
        compileResult: compile,
      })
    }

    this.log(
      `[${taskNumber}] ${task.id} done compile=${compile.compileSuccess}` +
        (judge ? ` judge=${judge.score}` : '')
    )

    return {
      taskId: task.id,
      difficulty: task.difficulty ?? null,
      config: {
        pipeline: this.pipeline.name,
        model: this.config.model,
        judgeModel: this.config.judgeModel ?? null,
        datasetVersion: this.dataset.version,
      },
      prompt: task.prompt,
      reference: task.reference,
      output: output
        ? { entrypoint: output.entrypoint, files: output.files }
        : { entrypoint: null, files: [] },
      compile,
      judge,
      tokens: {
        input: output?.totals.inputTokens ?? 0,
        output: output?.totals.outputTokens ?? 0,
      },
      latencyMs: pipelineMs,
      steps: output?.steps ?? [],
      error: pipelineError ?? output?.error ?? null,
    }
  }
}

function makeRunId() {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${ts}-${rand}`
}
