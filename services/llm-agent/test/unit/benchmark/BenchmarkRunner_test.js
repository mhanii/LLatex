// @ts-check
import { expect } from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BenchmarkRunner } from '../../../app/js/benchmark/runner/BenchmarkRunner.js'

class FakeDataset {
  constructor(tasks) {
    this.tasks = tasks
    this.loaded = false
  }
  get name() { return 'fake' }
  get version() { return 'fake@1' }
  async load() { this.loaded = true }
  *iter(filter = {}) {
    let n = 0
    for (const t of this.tasks) {
      if (filter.difficulty && t.difficulty !== filter.difficulty) continue
      yield t
      n++
      if (filter.limit != null && n >= filter.limit) return
    }
  }
}

class FakePipeline {
  constructor({ outputs }) {
    this.outputs = outputs
    this.calls = 0
  }
  get name() { return 'fake-pipeline' }
  async run(input) {
    const o = this.outputs[this.calls % this.outputs.length]
    this.calls++
    if (o instanceof Error) throw o
    return o
  }
}

class FakeEvaluator {
  constructor({ results }) {
    this.results = results
    this.calls = 0
    this.lastArgs = null
  }
  async evaluate(args) {
    this.lastArgs = args
    const r = this.results[this.calls % this.results.length]
    this.calls++
    return r
  }
}

const TASKS = [
  { id: 'T1', prompt: 'p1', reference: 'r1', difficulty: 'Simple', raw: {} },
  { id: 'T2', prompt: 'p2', reference: 'r2', difficulty: 'Average', raw: {} },
  { id: 'T3', prompt: 'p3', reference: 'r3', difficulty: 'Hard', raw: {} },
]

function pipelineOutput(text = '\\documentclass{article}A') {
  return {
    files: [{ path: 'main.tex', content: text }],
    entrypoint: 'main.tex',
    steps: [{ name: 'llm-call', startedAt: 'a', finishedAt: 'b', metadata: { latencyMs: 10 } }],
    totals: { inputTokens: 5, outputTokens: 7, latencyMs: 10 },
  }
}

function compileOk(extra = {}) {
  return {
    compileSuccess: true, compileStatus: 'success', errorCount: 0, errors: [],
    latexRuns: 1, pdfSizeBytes: 100, compileMs: 50, outputLogUrl: null, outputPdfUrl: null,
    ...extra,
  }
}
function compileFail() {
  return {
    compileSuccess: false, compileStatus: 'failure', errorCount: 2, errors: ['e1', 'e2'],
    latexRuns: 1, pdfSizeBytes: null, compileMs: 50, outputLogUrl: null, outputPdfUrl: null,
  }
}

class FakeJudge {
  constructor({ scores }) {
    this.scores = scores
    this.calls = 0
    this.lastArgs = null
  }
  async evaluate(args) {
    this.lastArgs = args
    const v = this.scores[this.calls % this.scores.length]
    this.calls++
    if (v === 'noop') return { score: -1, reason: 'compile-failed' }
    return { score: v, reason: `score ${v}`, model: 'judge-m', inputTokens: 50, outputTokens: 10, latencyMs: 100 }
  }
}

describe('BenchmarkRunner', function () {
  let outDir
  beforeEach(function () {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-runner-'))
  })
  afterEach(function () {
    fs.rmSync(outDir, { recursive: true, force: true })
  })

  it('writes one JSONL row per task and a summary.json', async function () {
    const runner = new BenchmarkRunner({
      dataset: new FakeDataset(TASKS),
      pipeline: new FakePipeline({ outputs: [pipelineOutput(), pipelineOutput(), pipelineOutput()] }),
      evaluator: new FakeEvaluator({ results: [compileOk(), compileFail(), compileOk()] }),
      config: { model: 'fake-model' },
    })
    const outputPath = path.join(outDir, 'r.jsonl')
    const { summary } = await runner.run({ outputPath })

    const lines = fs.readFileSync(outputPath, 'utf8').trim().split('\n')
    expect(lines).to.have.length(3)
    const rows = lines.map(l => JSON.parse(l))
    expect(rows.map(r => r.taskId)).to.deep.equal(['T1', 'T2', 'T3'])
    expect(rows[0].compile.compileSuccess).to.be.true
    expect(rows[1].compile.compileSuccess).to.be.false
    expect(rows[0].output.entrypoint).to.equal('main.tex')
    expect(rows[0].output.files).to.have.length(1)

    expect(summary.totalTasks).to.equal(3)
    expect(summary.totals.compilePassRate).to.be.closeTo(2 / 3, 1e-9)
    expect(summary.byDifficulty.Simple.n).to.equal(1)
    expect(summary.byDifficulty.Simple.compilePassRate).to.equal(1)
    expect(summary.byDifficulty.Average.compilePassRate).to.equal(0)
    expect(summary.config.model).to.equal('fake-model')
    expect(summary.config.pipelineName).to.equal('fake-pipeline')
    expect(summary.config.datasetName).to.equal('fake')
  })

  it('honours filter.difficulty and filter.limit', async function () {
    const runner = new BenchmarkRunner({
      dataset: new FakeDataset(TASKS),
      pipeline: new FakePipeline({ outputs: [pipelineOutput()] }),
      evaluator: new FakeEvaluator({ results: [compileOk()] }),
      config: { model: 'm' },
    })
    await runner.run({
      outputPath: path.join(outDir, 'r.jsonl'),
      filter: { difficulty: 'Simple', limit: 5 },
    })
    const rows = fs.readFileSync(path.join(outDir, 'r.jsonl'), 'utf8').trim().split('\n')
    expect(rows).to.have.length(1)
    expect(JSON.parse(rows[0]).taskId).to.equal('T1')
  })

  it('records pipeline errors and skips evaluator', async function () {
    const evaluator = new FakeEvaluator({ results: [compileOk()] })
    const runner = new BenchmarkRunner({
      dataset: new FakeDataset([TASKS[0]]),
      pipeline: new FakePipeline({ outputs: [new Error('llm down')] }),
      evaluator,
      config: { model: 'm' },
    })
    await runner.run({ outputPath: path.join(outDir, 'r.jsonl') })
    expect(evaluator.calls).to.equal(0)
    const row = JSON.parse(fs.readFileSync(path.join(outDir, 'r.jsonl'), 'utf8').trim())
    expect(row.error).to.equal('llm down')
    expect(row.compile.compileStatus).to.equal('pipeline-error')
  })

  it('attaches judge result and aggregates judge means in summary', async function () {
    const evaluator = new FakeEvaluator({
      results: [compileOk(), compileFail(), compileOk()],
    })
    const judge = new FakeJudge({ scores: [9, 'noop', 6] })
    const runner = new BenchmarkRunner({
      dataset: new FakeDataset(TASKS),
      pipeline: new FakePipeline({ outputs: [pipelineOutput(), pipelineOutput(), pipelineOutput()] }),
      evaluator,
      judge,
      config: { model: 'gen-m', judgeModel: 'judge-m' },
    })
    const outputPath = path.join(outDir, 'r.jsonl')
    const { summary } = await runner.run({ outputPath })
    const rows = fs.readFileSync(outputPath, 'utf8').trim().split('\n').map(l => JSON.parse(l))

    expect(rows[0].judge.score).to.equal(9)
    expect(rows[1].judge.score).to.equal(-1)        // compile failed → -1
    expect(rows[2].judge.score).to.equal(6)
    expect(rows[0].config.judgeModel).to.equal('judge-m')

    // Mean over all rows: (9 + -1 + 6) / 3 ≈ 4.667
    expect(summary.totals.judgeMeanScore).to.be.closeTo((9 + -1 + 6) / 3, 1e-9)
    // Mean only over compile-pass rows: (9 + 6) / 2 = 7.5
    expect(summary.totals.judgeMeanScoreOnPass).to.equal(7.5)
    expect(summary.byDifficulty.Simple.judgeMeanScoreOnPass).to.equal(9)
    expect(summary.byDifficulty.Average.judgeMeanScoreOnPass).to.be.null
    expect(summary.byDifficulty.Hard.judgeMeanScoreOnPass).to.equal(6)
  })

  it('omits judge fields entirely when no judge is provided', async function () {
    const runner = new BenchmarkRunner({
      dataset: new FakeDataset([TASKS[0]]),
      pipeline: new FakePipeline({ outputs: [pipelineOutput()] }),
      evaluator: new FakeEvaluator({ results: [compileOk()] }),
      config: { model: 'm' },
    })
    const outputPath = path.join(outDir, 'r.jsonl')
    const { summary } = await runner.run({ outputPath })
    const row = JSON.parse(fs.readFileSync(outputPath, 'utf8').trim())
    expect(row.judge).to.be.null
    expect(summary.totals.judgeMeanScore).to.be.undefined
    expect(summary.byDifficulty.Simple.judgeMeanScore).to.be.undefined
  })

  it('forwards files + entrypoint + stable runId to the evaluator', async function () {
    const evaluator = new FakeEvaluator({ results: [compileOk(), compileOk()] })
    const runner = new BenchmarkRunner({
      dataset: new FakeDataset(TASKS.slice(0, 2)),
      pipeline: new FakePipeline({ outputs: [pipelineOutput('A'), pipelineOutput('B')] }),
      evaluator,
      config: { model: 'm' },
    })
    await runner.run({ outputPath: path.join(outDir, 'r.jsonl') })
    expect(evaluator.lastArgs.entrypoint).to.equal('main.tex')
    expect(evaluator.lastArgs.taskId).to.equal('T2')
    expect(typeof evaluator.lastArgs.runId).to.equal('string')
  })
})
