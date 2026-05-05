// @ts-check
import { expect } from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TexpertDataset } from '../../../app/js/benchmark/datasets/TexpertDataset.js'

const FIXTURE = [
  {
    ID: 'AAA00001',
    'Task Instructions': 'Make a hello world.',
    'Verified LaTeX Code': '\\documentclass{article}\\begin{document}Hi\\end{document}',
    'Verified LaTeX Source LLM': 'GPT-4o',
    Class: 'Simple',
  },
  {
    ID: 'AAA00002',
    'Task Instructions': 'Include an integral.',
    'Verified LaTeX Code': '\\[ \\int_0^1 x \\, dx \\]',
    'Verified LaTeX Source LLM': 'GPT-4o',
    Class: 'Average',
  },
  {
    ID: 'AAA00003',
    'Task Instructions': 'Write a thesis chapter.',
    'Verified LaTeX Code': '\\chapter{Foo}',
    'Verified LaTeX Source LLM': 'Claude',
    Class: 'Hard',
  },
]

describe('TexpertDataset', function () {
  let tmpFile
  beforeEach(async function () {
    tmpFile = path.join(os.tmpdir(), `texpert-${Date.now()}-${Math.random()}.json`)
    await fs.promises.writeFile(tmpFile, JSON.stringify(FIXTURE))
  })
  afterEach(async function () {
    try { await fs.promises.unlink(tmpFile) } catch {}
  })

  it('loads a JSON file and normalises records', async function () {
    const ds = new TexpertDataset({ filePath: tmpFile })
    await ds.load()
    const tasks = [...ds.iter()]
    expect(tasks).to.have.length(3)
    expect(tasks[0]).to.deep.include({
      id: 'AAA00001',
      prompt: 'Make a hello world.',
      reference: '\\documentclass{article}\\begin{document}Hi\\end{document}',
      difficulty: 'Simple',
    })
    expect(tasks[0].raw).to.deep.equal(FIXTURE[0])
  })

  it('filters by difficulty', async function () {
    const ds = new TexpertDataset({ filePath: tmpFile })
    await ds.load()
    const tasks = [...ds.iter({ difficulty: 'Hard' })]
    expect(tasks).to.have.length(1)
    expect(tasks[0].id).to.equal('AAA00003')
  })

  it('respects limit', async function () {
    const ds = new TexpertDataset({ filePath: tmpFile })
    await ds.load()
    expect([...ds.iter({ limit: 2 })]).to.have.length(2)
  })

  it('filters by ids', async function () {
    const ds = new TexpertDataset({ filePath: tmpFile })
    await ds.load()
    const tasks = [...ds.iter({ ids: ['AAA00001', 'AAA00003'] })]
    expect(tasks.map(t => t.id)).to.deep.equal(['AAA00001', 'AAA00003'])
  })

  it('throws if file is missing', async function () {
    const ds = new TexpertDataset({ filePath: '/nonexistent/texpert.json' })
    await expect(ds.load()).to.be.rejectedWith(/not found/)
  })

  it('throws if record is missing required fields', async function () {
    const bad = path.join(os.tmpdir(), `texpert-bad-${Date.now()}.json`)
    await fs.promises.writeFile(bad, JSON.stringify([{ ID: 'X', Class: 'Simple' }]))
    try {
      const ds = new TexpertDataset({ filePath: bad })
      await expect(ds.load()).to.be.rejectedWith(/missing/)
    } finally {
      await fs.promises.unlink(bad)
    }
  })

  it('throws if iter() called before load()', function () {
    const ds = new TexpertDataset({ filePath: tmpFile })
    expect(() => [...ds.iter()]).to.throw(/before load/)
  })
})
