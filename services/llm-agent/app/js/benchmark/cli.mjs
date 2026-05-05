#!/usr/bin/env node
// @ts-check

// Benchmark CLI — runs a pipeline over a dataset and writes JSONL + summary.
//
// Examples:
//   node app/js/benchmark/cli.mjs run \
//     --pipeline direct-llm --dataset texpert --model gpt-4o \
//     --difficulty Simple --limit 5
//     (writes to runs/YYYY-MM-DDTHH-mm-ss.jsonl)
//
//   node app/js/benchmark/cli.mjs run --output runs/smoke.jsonl \
//     --pipeline direct-llm --dataset texpert --model gpt-4o
//
//   node app/js/benchmark/cli.mjs summarise --input runs/smoke.jsonl

import fs from 'node:fs'
import path from 'node:path'
import minimist from 'minimist'
import Settings from '@overleaf/settings'

import { providerFromEnv } from '../providers/index.js'
import { datasetFromName, listDatasets } from './datasets/index.js'
import { pipelineFromName, listPipelines } from './pipelines/index.js'
import { CompileEvaluator } from './evaluator/CompileEvaluator.js'
import { JudgeEvaluator } from './evaluator/JudgeEvaluator.js'
import { BenchmarkRunner } from './runner/BenchmarkRunner.js'
import { summarise } from './runner/ResultWriter.js'

const argv = minimist(process.argv.slice(2), {
  string: ['pipeline', 'dataset', 'model', 'judge-model', 'difficulty', 'output', 'input', 'ids'],
  boolean: ['no-judge'],
  default: { pipeline: 'direct-llm', dataset: 'texpert' },
  alias: { 'batch-size': 'batchSize' },
})

const subcommand = argv._[0]

async function main() {
  if (subcommand === 'run') return await cmdRun()
  if (subcommand === 'summarise' || subcommand === 'summarize') {
    return await cmdSummarise()
  }
  if (subcommand === 'list') return cmdList()
  printUsage()
  process.exit(subcommand ? 1 : 0)
}

async function cmdRun() {
  const model = argv.model || Settings.llm?.defaultModel
  if (!model) throw new Error('--model is required (or set LLM_MODEL)')

  const output = argv.output || defaultOutputPath()

  const provider = providerFromEnv()
  const dataset = datasetFromName(argv.dataset)
  const pipeline = pipelineFromName(argv.pipeline, {
    provider,
    model,
    temperature: argv.temperature != null ? Number(argv.temperature) : undefined,
    maxTokens: argv.maxTokens != null ? Number(argv.maxTokens) : undefined,
  })
  const evaluator = new CompileEvaluator({
    clsiUrl: Settings.apis?.clsi?.url,
    timeoutSec: argv.timeout != null ? Number(argv.timeout) : 60,
  })

  const judgeModel =
    argv['judge-model'] || process.env.LLM_JUDGE_MODEL || model
  const judgeMaxTokens =
    argv['judge-max-tokens'] != null ? Number(argv['judge-max-tokens']) : undefined
  if (judgeMaxTokens != null && (!Number.isFinite(judgeMaxTokens) || judgeMaxTokens < 1)) {
    throw new Error('--judge-max-tokens must be a positive integer')
  }
  const judge = argv['no-judge']
    ? null
    : new JudgeEvaluator({ provider, model: judgeModel, maxTokens: judgeMaxTokens })

  const filter = {}
  if (argv.difficulty) filter.difficulty = argv.difficulty
  if (argv.limit != null) filter.limit = Number(argv.limit)
  if (argv.ids) filter.ids = String(argv.ids).split(',').map(s => s.trim()).filter(Boolean)

  const batchSize =
    argv['batch-size'] != null ? Number(argv['batch-size']) : 1
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error('--batch-size must be a positive integer')
  }

  const runner = new BenchmarkRunner({
    dataset,
    pipeline,
    evaluator,
    judge,
    config: { model, judgeModel: judge ? judgeModel : null },
    log: msg => process.stderr.write(msg + '\n'),
    batchSize,
  })

  const startedAt = Date.now()
  const { summary, outputPath, summaryPath } = await runner.run({
    filter,
    outputPath: output,
  })
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)

  process.stderr.write(`\nDone in ${elapsed}s\n`)
  process.stderr.write(`  rows:    ${outputPath}\n`)
  process.stderr.write(`  summary: ${summaryPath}\n`)
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
}

async function cmdSummarise() {
  if (!argv.input) throw new Error('--input is required')
  const text = await fs.promises.readFile(argv.input, 'utf8')
  const rows = text
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  const summary = summarise(rows, { source: path.resolve(argv.input) })
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
}

function cmdList() {
  process.stdout.write('Datasets:  ' + listDatasets().join(', ') + '\n')
  process.stdout.write('Pipelines: ' + listPipelines().join(', ') + '\n')
}

function defaultOutputPath() {
  const now = new Date()
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `runs/${ts}.jsonl`
}

function printUsage() {
  process.stderr.write(`Usage:
  cli.mjs run --pipeline <name> --dataset <name> --model <id> [--output <path.jsonl>]
              [--judge-model <id>] [--judge-max-tokens N] [--no-judge] [--batch-size N]
              [--difficulty <Simple|Average|Hard>] [--limit N] [--ids id1,id2]
              [--temperature N] [--maxTokens N] [--timeout sec]

  cli.mjs summarise --input <path.jsonl>

  cli.mjs list

Env:
  PORTKEY_API_KEY      Portkey gateway API key (required)
  PORTKEY_VIRTUAL_KEY  optional virtual-key route
  PORTKEY_CONFIG       optional Portkey config id
  LLM_MODEL            default model if --model is omitted
  LLM_JUDGE_MODEL      default judge model if --judge-model is omitted (falls back to LLM_MODEL)
  CLSI_HOST/CLSI_PORT  CLSI host (default clsi:3013)
`)
}

main().catch(err => {
  process.stderr.write(`benchmark cli failed: ${err.stack || err.message || err}\n`)
  process.exit(1)
})
