import { beforeEach, describe, it, expect, vi } from 'vitest'

let ProjectEntityHandler
let DocumentUpdaterHandler
let SyntaxChecker

// Helper: build a minimal allDocs return value for a single file.
function singleDoc(path, docId, lines) {
  return { [path]: { _id: { toString: () => docId }, lines } }
}

// Helper: build allDocs for multiple files.
function multiDocs(entries) {
  const result = {}
  for (const { path, docId, lines } of entries) {
    result[path] = { _id: { toString: () => docId }, lines }
  }
  return result
}

describe('SyntaxChecker', function () {
  beforeEach(async function () {
    vi.resetModules()

    ProjectEntityHandler = { promises: { getAllDocs: vi.fn() } }
    vi.doMock(
      '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs',
      () => ({ default: ProjectEntityHandler })
    )

    DocumentUpdaterHandler = { promises: { getDocument: vi.fn() } }
    vi.doMock(
      '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs',
      () => ({ default: DocumentUpdaterHandler })
    )

    ;({ default: SyntaxChecker } = await import(
      '../../../app/src/SyntaxChecker.mjs'
    ))
  })

  function setupDoc(path, docId, lines) {
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue(
      singleDoc(path, docId, lines)
    )
    DocumentUpdaterHandler.promises.getDocument.mockResolvedValue({ lines })
  }

  function setupDocs(entries) {
    const allDocs = multiDocs(entries)
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue(allDocs)
    DocumentUpdaterHandler.promises.getDocument.mockImplementation(
      (_pid, docId) => {
        const entry = entries.find(e => e.docId === docId)
        return Promise.resolve({ lines: entry?.lines ?? [] })
      }
    )
  }

  describe('duplicate label detection', function () {
    it('reports duplicate labels in the same file', async function () {
      setupDoc('/main.tex', 'doc1', [
        '\\label{fig:one}',
        'some text',
        '\\label{fig:one}',
      ])
      const { issues } = await SyntaxChecker.check('proj1', null)
      expect(issues).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('fig:one'),
        })
      )
    })

    it('reports duplicate labels across files', async function () {
      setupDocs([
        { path: '/a.tex', docId: 'doc-a', lines: ['\\label{sec:intro}'] },
        { path: '/b.tex', docId: 'doc-b', lines: ['\\label{sec:intro}'] },
      ])
      const { issues } = await SyntaxChecker.check('proj1', null)
      const dup = issues.find(i => i.message.includes('sec:intro'))
      expect(dup).toBeDefined()
      expect(dup.type).toBe('warning')
      expect(dup.message).toMatch(/a\.tex/)
      expect(dup.message).toMatch(/b\.tex/)
    })

    it('does not report unique labels', async function () {
      setupDoc('/main.tex', 'doc1', [
        '\\label{fig:one}',
        '\\label{fig:two}',
      ])
      const { issues } = await SyntaxChecker.check('proj1', null)
      expect(issues.filter(i => i.message.includes('Duplicate'))).toHaveLength(0)
    })
  })

  describe('undefined reference detection', function () {
    it('reports a ref to an undefined label', async function () {
      setupDoc('/main.tex', 'doc1', [
        '\\ref{fig:missing}',
      ])
      const { issues } = await SyntaxChecker.check('proj1', null)
      expect(issues).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('fig:missing'),
        })
      )
    })

    it('does not report a ref that has a matching label', async function () {
      setupDoc('/main.tex', 'doc1', [
        '\\label{fig:one}',
        '\\ref{fig:one}',
      ])
      const { issues } = await SyntaxChecker.check('proj1', null)
      expect(issues.filter(i => i.message.includes('fig:one'))).toHaveLength(0)
    })
  })

  describe('unbalanced environment detection', function () {
    it('reports an \\end without matching \\begin', async function () {
      setupDoc('/main.tex', 'doc1', ['\\end{figure}'])
      const { issues } = await SyntaxChecker.check('proj1', null)
      expect(issues).toContainEqual(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('\\end{figure}'),
        })
      )
    })

    it('reports an unclosed \\begin', async function () {
      setupDoc('/main.tex', 'doc1', ['\\begin{figure}'])
      const { issues } = await SyntaxChecker.check('proj1', null)
      expect(issues).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('\\begin{figure}'),
        })
      )
    })

    it('reports mismatched \\begin / \\end environments', async function () {
      setupDoc('/main.tex', 'doc1', [
        '\\begin{figure}',
        '\\end{table}',
      ])
      const { issues } = await SyntaxChecker.check('proj1', null)
      expect(issues).toContainEqual(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('\\end{table}'),
        })
      )
    })

    it('does not report balanced environments', async function () {
      setupDoc('/main.tex', 'doc1', [
        '\\begin{figure}',
        '\\end{figure}',
      ])
      const { issues } = await SyntaxChecker.check('proj1', null)
      expect(issues).toHaveLength(0)
    })
  })

  describe('missing \\input file detection', function () {
    it('reports an \\input that references a missing file', async function () {
      setupDoc('/main.tex', 'doc1', ['\\input{missing}'])
      const { issues } = await SyntaxChecker.check('proj1', null)
      expect(issues).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('missing'),
        })
      )
    })

    it('does not report an \\input that matches a project file', async function () {
      setupDocs([
        { path: '/main.tex', docId: 'doc-main', lines: ['\\input{chapter}'] },
        { path: '/chapter.tex', docId: 'doc-ch', lines: [] },
      ])
      const { issues } = await SyntaxChecker.check('proj1', null)
      expect(issues.filter(i => i.message.includes('chapter'))).toHaveLength(0)
    })
  })

  describe('scopePath filtering', function () {
    it('only checks the scoped file', async function () {
      setupDocs([
        {
          path: '/main.tex',
          docId: 'doc-main',
          lines: ['\\begin{figure}'],
        },
        {
          path: '/other.tex',
          docId: 'doc-other',
          lines: ['\\begin{table}'],
        },
      ])
      const { issues } = await SyntaxChecker.check('proj1', 'main.tex')
      // Only the main.tex unclosed begin should appear
      expect(issues.some(i => i.file === 'main.tex')).toBe(true)
      expect(issues.some(i => i.file === 'other.tex')).toBe(false)
    })
  })
})
