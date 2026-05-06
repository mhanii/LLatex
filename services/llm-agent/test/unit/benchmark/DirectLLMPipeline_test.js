// @ts-check
import { expect } from 'chai'
import { DirectLLMPipeline } from '../../../app/js/benchmark/pipelines/DirectLLMPipeline.js'

class FakeProvider {
  constructor(result) {
    this.result = result
    /** @type {any} */
    this.lastRequest = null
  }
  async complete(req) {
    this.lastRequest = req
    if (this.result instanceof Error) throw this.result
    return this.result
  }
}

describe('DirectLLMPipeline', function () {
  it('produces a single-file output with main.tex and entrypoint', async function () {
    const provider = new FakeProvider({
      text: '\\documentclass{article}\\begin{document}Hi\\end{document}',
      inputTokens: 10,
      outputTokens: 20,
      model: 'gpt-4o',
      latencyMs: 5,
    })
    const pipeline = new DirectLLMPipeline({ provider, model: 'gpt-4o' })
    const out = await pipeline.run({ prompt: 'Hello world' })

    expect(out.entrypoint).to.equal('main.tex')
    expect(out.files).to.have.length(1)
    expect(out.files[0].path).to.equal('main.tex')
    expect(out.files[0].content).to.include('\\documentclass{article}')
    expect(out.totals.inputTokens).to.equal(10)
    expect(out.totals.outputTokens).to.equal(20)
    expect(out.steps).to.have.length(1)
    expect(out.steps[0].name).to.equal('llm-call')
    expect(out.steps[0].metadata.model).to.equal('gpt-4o')
    expect(out.error).to.be.undefined
  })

  it('strips ```latex code fences', async function () {
    const provider = new FakeProvider({
      text: '```latex\n\\documentclass{article}\n\\begin{document}A\\end{document}\n```',
      inputTokens: 1,
      outputTokens: 2,
      model: 'gpt-4o',
      latencyMs: 1,
    })
    const pipeline = new DirectLLMPipeline({ provider, model: 'gpt-4o' })
    const out = await pipeline.run({ prompt: 'x' })
    expect(out.files[0].content).to.equal(
      '\\documentclass{article}\n\\begin{document}A\\end{document}'
    )
  })

  it('records error and empty content when provider throws', async function () {
    const provider = new FakeProvider(new Error('boom'))
    const pipeline = new DirectLLMPipeline({ provider, model: 'gpt-4o' })
    const out = await pipeline.run({ prompt: 'x' })
    expect(out.error).to.equal('boom')
    expect(out.files[0].content).to.equal('')
    expect(out.steps[0].error).to.equal('boom')
  })

  it('passes the user prompt and a system prompt to the provider', async function () {
    const provider = new FakeProvider({
      text: 'x', inputTokens: 0, outputTokens: 0, model: 'm', latencyMs: 0,
    })
    const pipeline = new DirectLLMPipeline({ provider, model: 'm', temperature: 0.2, maxTokens: 500 })
    await pipeline.run({ prompt: 'Make a table' })

    expect(provider.lastRequest.system).to.match(/LaTeX/i)
    expect(provider.lastRequest.messages).to.deep.equal([
      { role: 'user', content: 'Make a table' },
    ])
    expect(provider.lastRequest.model).to.equal('m')
    expect(provider.lastRequest.temperature).to.equal(0.2)
    expect(provider.lastRequest.maxTokens).to.equal(500)
  })

  it('exposes name "direct-llm"', function () {
    const pipeline = new DirectLLMPipeline({
      provider: new FakeProvider(null),
      model: 'm',
    })
    expect(pipeline.name).to.equal('direct-llm')
  })
})
