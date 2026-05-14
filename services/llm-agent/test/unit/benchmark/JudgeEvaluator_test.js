// @ts-check
import { expect } from 'chai'
import {
  JudgeEvaluator,
  parseJudgeResponse,
} from '../../../app/js/benchmark/evaluator/JudgeEvaluator.js'

class FakeProvider {
  constructor(result) { this.result = result; this.lastRequest = null }
  async complete(req) {
    this.lastRequest = req
    if (this.result instanceof Error) throw this.result
    return this.result
  }
}

const TASK = { prompt: 'Make a hello world doc.', reference: '\\documentclass{article}\\begin{document}Hi\\end{document}' }
const OUTPUT = {
  files: [{ path: 'main.tex', content: '\\documentclass{article}\\begin{document}Hello\\end{document}' }],
  entrypoint: 'main.tex',
}

describe('JudgeEvaluator', function () {
  it('returns -1 without calling the LLM when compile failed', async function () {
    const provider = new FakeProvider(null)
    const judge = new JudgeEvaluator({ provider, model: 'gpt-4o' })
    const result = await judge.evaluate({
      task: TASK, output: OUTPUT, compileResult: { compileSuccess: false },
    })
    expect(result.score).to.equal(-1)
    expect(result.reason).to.equal('compile-failed')
    expect(provider.lastRequest).to.be.null
  })

  it('returns parsed score and metadata on a successful judge call', async function () {
    const provider = new FakeProvider({
      text: '8\nMostly correct, minor stylistic differences.',
      inputTokens: 100, outputTokens: 20, model: 'gpt-4o', latencyMs: 250,
    })
    const judge = new JudgeEvaluator({ provider, model: 'gpt-4o' })
    const result = await judge.evaluate({
      task: TASK, output: OUTPUT, compileResult: { compileSuccess: true },
    })
    expect(result.score).to.equal(8)
    expect(result.reason).to.match(/Mostly correct/)
    expect(result.inputTokens).to.equal(100)
    expect(result.outputTokens).to.equal(20)
    expect(result.model).to.equal('gpt-4o')
    expect(result.latencyMs).to.equal(250)
  })

  it('clamps scores above 10 and below 0', async function () {
    expect(parseJudgeResponse('11 too high').score).to.equal(10)
    expect(parseJudgeResponse('-5 negative').score).to.equal(0)
    expect(parseJudgeResponse('0').score).to.equal(0)
    expect(parseJudgeResponse('10').score).to.equal(10)
  })

  it('returns -1 when the response cannot be parsed', function () {
    expect(parseJudgeResponse('').score).to.equal(-1)
    expect(parseJudgeResponse('no numbers at all').score).to.equal(-1)
  })

  it('returns -1 with harnessError when the provider throws', async function () {
    const provider = new FakeProvider(new Error('rate limit'))
    const judge = new JudgeEvaluator({ provider, model: 'gpt-4o' })
    const result = await judge.evaluate({
      task: TASK, output: OUTPUT, compileResult: { compileSuccess: true },
    })
    expect(result.score).to.equal(-1)
    expect(result.reason).to.equal('judge-call-failed')
    expect(result.harnessError).to.include('rate limit')
  })

  it('passes the task, reference, and entrypoint content to the provider', async function () {
    const provider = new FakeProvider({
      text: '7', inputTokens: 0, outputTokens: 0, model: 'm', latencyMs: 0,
    })
    const judge = new JudgeEvaluator({ provider, model: 'm' })
    await judge.evaluate({
      task: TASK, output: OUTPUT, compileResult: { compileSuccess: true },
    })
    const req = provider.lastRequest
    expect(req.system).to.match(/LaTeX reviewer/i)
    expect(req.messages[0].content).to.include('Make a hello world doc.')
    expect(req.messages[0].content).to.include('\\begin{document}Hello')
    expect(req.messages[0].content).to.include('\\begin{document}Hi')
    expect(req.temperature).to.equal(0)
  })

  it('picks the entrypoint file when output has multiple files', async function () {
    const provider = new FakeProvider({
      text: '9', inputTokens: 0, outputTokens: 0, model: 'm', latencyMs: 0,
    })
    const judge = new JudgeEvaluator({ provider, model: 'm' })
    await judge.evaluate({
      task: TASK,
      output: {
        entrypoint: 'main.tex',
        files: [
          { path: 'helper.sty', content: 'STYLE' },
          { path: 'main.tex', content: 'ENTRYPOINT' },
        ],
      },
      compileResult: { compileSuccess: true },
    })
    expect(provider.lastRequest.messages[0].content).to.include('ENTRYPOINT')
    expect(provider.lastRequest.messages[0].content).not.to.include('STYLE')
  })
})
