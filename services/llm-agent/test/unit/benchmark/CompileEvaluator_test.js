// @ts-check
import { expect } from 'chai'
import { CompileEvaluator } from '../../../app/js/benchmark/evaluator/CompileEvaluator.js'

function fakeResponse(status, body, { isText } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (isText ? JSON.parse(text) : body),
    text: async () => text,
  }
}

describe('CompileEvaluator', function () {
  it('returns compileSuccess=true and zero errors on a good compile', async function () {
    const fetchImpl = async (url, opts) => {
      if (opts && opts.method === 'POST') {
        return fakeResponse(200, {
          compile: {
            status: 'success',
            outputFiles: [
              { path: 'output.pdf', size: 12345, url: 'http://clsi/x/output.pdf', type: 'pdf' },
              { path: 'output.log', size: 200, url: 'http://clsi/x/output.log', type: 'log' },
            ],
            stats: { 'latex-runs': 1 },
          },
        })
      }
      // log fetch
      return fakeResponse(200, 'Transcript written on output.log.')
    }
    const evalr = new CompileEvaluator({ clsiUrl: 'http://clsi:3013', fetch: fetchImpl })
    const result = await evalr.evaluate({
      files: [{ path: 'main.tex', content: '\\documentclass{article}\\begin{document}A\\end{document}' }],
      entrypoint: 'main.tex',
      taskId: 'task1',
      runId: 'run1',
    })
    expect(result.compileSuccess).to.be.true
    expect(result.compileStatus).to.equal('success')
    expect(result.errorCount).to.equal(0)
    expect(result.pdfSizeBytes).to.equal(12345)
    expect(result.latexRuns).to.equal(1)
    expect(result.outputPdfUrl).to.equal('http://clsi/x/output.pdf')
  })

  it('parses errors from output.log on a failed compile', async function () {
    const log = [
      './main.tex:5: Undefined control sequence.',
      '! Emergency stop.',
      'Transcript written on output.log.',
    ].join('\n')
    const fetchImpl = async (url, opts) => {
      if (opts && opts.method === 'POST') {
        return fakeResponse(200, {
          compile: {
            status: 'failure',
            outputFiles: [
              { path: 'output.log', size: log.length, url: 'http://clsi/log', type: 'log' },
            ],
            stats: { 'latex-runs': 1 },
          },
        })
      }
      return fakeResponse(200, log)
    }
    const evalr = new CompileEvaluator({ clsiUrl: 'http://clsi:3013', fetch: fetchImpl })
    const result = await evalr.evaluate({
      files: [{ path: 'main.tex', content: 'broken' }],
      entrypoint: 'main.tex',
      taskId: 't', runId: 'r',
    })
    expect(result.compileSuccess).to.be.false
    expect(result.compileStatus).to.equal('failure')
    expect(result.errorCount).to.be.greaterThan(0)
    expect(result.errors[0]).to.include('Undefined control sequence')
  })

  it('returns harness-error on network failure', async function () {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED') }
    const evalr = new CompileEvaluator({ clsiUrl: 'http://clsi:3013', fetch: fetchImpl })
    const result = await evalr.evaluate({
      files: [{ path: 'main.tex', content: 'x' }],
      entrypoint: 'main.tex',
      taskId: 't', runId: 'r',
    })
    expect(result.compileSuccess).to.be.false
    expect(result.compileStatus).to.equal('harness-error')
    expect(result.harnessError).to.include('ECONNREFUSED')
  })

  it('returns harness-error on CLSI 5xx', async function () {
    const fetchImpl = async () => fakeResponse(500, 'CLSI exploded')
    const evalr = new CompileEvaluator({ clsiUrl: 'http://clsi:3013', fetch: fetchImpl })
    const result = await evalr.evaluate({
      files: [{ path: 'main.tex', content: 'x' }],
      entrypoint: 'main.tex',
      taskId: 't', runId: 'r',
    })
    expect(result.compileStatus).to.equal('harness-error')
    expect(result.harnessError).to.include('500')
  })

  it('forwards the file array as resources with rootResourcePath', async function () {
    let captured
    const fetchImpl = async (url, opts) => {
      if (opts && opts.method === 'POST') {
        captured = { url, body: JSON.parse(opts.body) }
        return fakeResponse(200, {
          compile: { status: 'success', outputFiles: [{ path: 'output.pdf', size: 1, url: 'u' }] },
        })
      }
      return fakeResponse(200, '')
    }
    const evalr = new CompileEvaluator({ clsiUrl: 'http://clsi:3013', fetch: fetchImpl })
    await evalr.evaluate({
      files: [
        { path: 'main.tex', content: 'A' },
        { path: 'sections/intro.tex', content: 'B' },
      ],
      entrypoint: 'main.tex',
      taskId: '02BE9B93',
      runId: 'r1',
    })
    expect(captured.url).to.match(/\/project\/bench-r1-02BE9B93\/compile$/)
    expect(captured.body.compile.resources).to.have.length(2)
    expect(captured.body.compile.rootResourcePath).to.equal('main.tex')
    expect(captured.body.compile.options.compiler).to.equal('pdflatex')
  })
})
