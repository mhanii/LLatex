// @ts-check
import { expect } from 'chai'
import { grep } from '../../../app/js/tools/grep.js'
import { fakeResponse, makeCtx, stubFetch, restoreFetch } from './helpers.js'

/**
 * Build a fetch stub that returns canned line arrays per docId from
 * `/peek` requests, and 404s the loading endpoint. Mirrors the real
 * doc-updater behaviour for hot docs.
 */
function stubFetchWithDocs(byDocId) {
  stubFetch(async url => {
    const match = url.match(/\/doc\/([^/]+)(?:\/peek)?$/)
    const docId = match?.[1]
    if (docId && byDocId[docId] != null) {
      return fakeResponse(200, { lines: byDocId[docId], version: 1 })
    }
    return fakeResponse(404)
  })
}

/**
 * Parse the newline-separated `path:lineNumber:line` output back into
 * objects so existing assertions can stay largely unchanged.
 */
function parseHits(result) {
  if (typeof result !== 'string' || result === 'No matches found') return []
  return result.split('\n').map(line => {
    const firstColon = line.indexOf(':')
    const secondColon = line.indexOf(':', firstColon + 1)
    return {
      path: line.slice(0, firstColon),
      lineNumber: parseInt(line.slice(firstColon + 1, secondColon), 10),
      line: line.slice(secondColon + 1),
    }
  })
}

describe('grep', function () {
  afterEach(restoreFetch)

  it('returns matching lines with path and 1-indexed line number', async function () {
    stubFetchWithDocs({
      doc111: ['\\documentclass{article}', 'hello world', '\\end{document}'],
      doc222: ['intro hello', 'unrelated'],
    })
    const result = await grep({ pattern: 'hello' }, makeCtx())
    expect(parseHits(result)).to.deep.equal([
      { path: 'main.tex', lineNumber: 2, line: 'hello world' },
      { path: 'chapters/intro.tex', lineNumber: 1, line: 'intro hello' },
    ])
  })

  it('skips binary files (never fetches them)', async function () {
    const fetched = []
    stubFetch(async url => {
      fetched.push(url)
      const docId = url.match(/\/doc\/([^/]+)(?:\/peek)?$/)?.[1]
      if (docId === 'doc111') return fakeResponse(200, { lines: ['target'] })
      return fakeResponse(404)
    })
    const ctx = makeCtx()
    ctx.context.files.push({ path: 'figures/diagram.png', binary: true })
    const result = await grep({ pattern: 'target' }, ctx)
    expect(result).to.not.include('diagram.png')
    expect(fetched.some(u => u.includes('undefined'))).to.be.false
  })

  it('is case-insensitive by default', async function () {
    stubFetchWithDocs({ doc111: ['Hello World'], doc222: [] })
    const result = await grep({ pattern: 'hello' }, makeCtx())
    expect(parseHits(result)).to.have.lengthOf(1)
  })

  it('respects caseSensitive when true', async function () {
    stubFetchWithDocs({ doc111: ['Hello World'], doc222: [] })
    const result = await grep(
      { pattern: 'hello', caseSensitive: true },
      makeCtx()
    )
    expect(parseHits(result)).to.deep.equal([])
  })

  it('filters by pathGlob (simple)', async function () {
    stubFetchWithDocs({
      doc111: ['target'],
      doc222: ['target'],
    })
    const result = await grep(
      { pattern: 'target', pathGlob: 'chapters/*.tex' },
      makeCtx()
    )
    expect(parseHits(result)).to.deep.equal([
      { path: 'chapters/intro.tex', lineNumber: 1, line: 'target' },
    ])
  })

  it('supports ** in pathGlob to cross directory separators', async function () {
    stubFetchWithDocs({
      doc111: ['target'],
      doc222: ['target'],
    })
    const result = await grep(
      { pattern: 'target', pathGlob: '**/*.tex' },
      makeCtx()
    )
    expect(parseHits(result)).to.have.lengthOf(2)
  })

  it('caps results at maxResults', async function () {
    const manyLines = Array.from({ length: 50 }, (_, i) => `hit ${i}`)
    stubFetchWithDocs({ doc111: manyLines, doc222: manyLines })
    const result = await grep({ pattern: 'hit', maxResults: 5 }, makeCtx())
    expect(parseHits(result)).to.have.lengthOf(5)
  })

  it("returns 'No matches found' when no files match the glob", async function () {
    stubFetchWithDocs({ doc111: ['x'], doc222: ['x'] })
    const result = await grep(
      { pattern: 'x', pathGlob: 'figures/*.tex' },
      makeCtx()
    )
    expect(result).to.equal('No matches found')
  })

  it('returns an error string for invalid regex', async function () {
    stubFetchWithDocs({ doc111: [], doc222: [] })
    const result = await grep({ pattern: '[unclosed' }, makeCtx())
    expect(result).to.be.a('string')
    expect(result).to.include('Invalid regex')
  })

  it('returns an error string for empty pattern', async function () {
    const result = await grep({ pattern: '' }, makeCtx())
    expect(result).to.be.a('string')
    expect(result).to.include('non-empty')
  })

  it('skips files whose doc-updater calls fail without poisoning the run', async function () {
    stubFetch(async url => {
      if (url.includes('doc222')) return fakeResponse(500)
      return fakeResponse(200, { lines: ['hit'], version: 1 })
    })
    const result = await grep({ pattern: 'hit' }, makeCtx())
    expect(parseHits(result)).to.deep.equal([
      { path: 'main.tex', lineNumber: 1, line: 'hit' },
    ])
  })

  it('falls back from /peek to the loading endpoint on 404', async function () {
    const calls = []
    stubFetch(async url => {
      calls.push(url)
      if (url.endsWith('/peek')) return fakeResponse(404)
      return fakeResponse(200, { lines: ['cold'], version: 0 })
    })
    const result = await grep({ pattern: 'cold' }, makeCtx())
    expect(parseHits(result)).to.have.lengthOf(2)
    expect(calls.some(u => u.endsWith('/peek'))).to.be.true
    expect(calls.some(u => !u.endsWith('/peek'))).to.be.true
  })

  it('escapes regex metacharacters in pathGlob (treats them literally)', async function () {
    const ctx = makeCtx()
    ctx.context.files.push({ path: 'a.b.tex', docId: 'doc333' })
    stubFetchWithDocs({ doc111: [], doc222: [], doc333: ['hit'] })
    const result = await grep(
      { pattern: 'hit', pathGlob: 'a.b.tex' },
      ctx
    )
    expect(parseHits(result)).to.deep.equal([
      { path: 'a.b.tex', lineNumber: 1, line: 'hit' },
    ])
  })

  describe('regex semantics', function () {
    // One shared corpus, chosen to give every regex feature something to bite.
    const CORPUS = {
      doc111: [
        '\\documentclass{article}',         // 1
        '\\usepackage{amsmath}',            // 2
        '\\title{Foo Bar}',                 // 3
        '\\begin{document}',                // 4
        'See \\cite{ref1} and \\cite{ref2}.', // 5
        'Numbers: 42, 100, 7',              // 6
        'MixedCase AND lowercase',          // 7
        '  whitespace  before',             // 8
        'end-of-line',                      // 9
        'baz qux',                          // 10
      ],
      doc222: [
        'foo bar baz',          // 1
        'foofoo barbar',        // 2
        'FOO BAR',              // 3
        '\\section{Intro}',     // 4
        '\\label{sec:intro}',   // 5
        'See \\ref{sec:intro}.', // 6
        'aabb cc',              // 7  — for backreferences
        '   ',                  // 8  — whitespace-only
        '',                     // 9  — empty line
      ],
    }

    beforeEach(function () {
      stubFetchWithDocs(CORPUS)
    })

    it('anchors: ^ matches start of line', async function () {
      const r = await grep({ pattern: '^foo', caseSensitive: true }, makeCtx())
      const hits = parseHits(r)
      const paths = hits.map(h => `${h.path}:${h.lineNumber}`)
      expect(paths).to.include('chapters/intro.tex:1')
      expect(paths).to.include('chapters/intro.tex:2')
      expect(paths).to.not.include('chapters/intro.tex:3') // 'FOO BAR' — case-sensitive
    })

    it('anchors: $ matches end of line', async function () {
      const r = await grep({ pattern: 'baz$', caseSensitive: true }, makeCtx())
      const hits = parseHits(r)
      expect(hits).to.have.lengthOf(1)
      expect(hits[0]).to.deep.equal({
        path: 'chapters/intro.tex',
        lineNumber: 1,
        line: 'foo bar baz',
      })
    })

    it('anchors: ^...$ matches a full line exactly', async function () {
      const r = await grep(
        { pattern: '^baz qux$', caseSensitive: true },
        makeCtx()
      )
      const hits = parseHits(r)
      expect(hits).to.have.lengthOf(1)
      expect(hits[0].path).to.equal('main.tex')
      expect(hits[0].lineNumber).to.equal(10)
    })

    it('character class: \\d+ matches digit runs', async function () {
      const r = await grep({ pattern: '\\d+' }, makeCtx())
      const lines = parseHits(r).map(h => h.line)
      expect(lines).to.include('Numbers: 42, 100, 7')
      expect(lines).to.include('See \\cite{ref1} and \\cite{ref2}.')
      // 'sec:intro' has no digits — should not be in the results
      expect(lines).to.not.include('\\label{sec:intro}')
    })

    it('character class: [A-Z]{2,} with caseSensitive=true', async function () {
      const r = await grep(
        { pattern: '[A-Z]{2,}', caseSensitive: true },
        makeCtx()
      )
      const lines = parseHits(r).map(h => h.line)
      expect(lines).to.include('MixedCase AND lowercase')
      expect(lines).to.include('FOO BAR')
      expect(lines).to.not.include('foo bar baz')
    })

    it('quantifier: o{2,} (two or more)', async function () {
      const r = await grep(
        { pattern: 'o{2,}', caseSensitive: true },
        makeCtx()
      )
      const lines = parseHits(r).map(h => h.line)
      expect(lines).to.include('foo bar baz')
      expect(lines).to.include('foofoo barbar')
      expect(lines).to.not.include('FOO BAR') // case-sensitive
    })

    it('alternation: a|b matches either', async function () {
      const r = await grep(
        { pattern: 'cite|ref', caseSensitive: true },
        makeCtx()
      )
      const lines = parseHits(r).map(h => h.line)
      expect(lines).to.include('See \\cite{ref1} and \\cite{ref2}.')
      expect(lines).to.include('See \\ref{sec:intro}.')
      // \label{sec:intro} has neither "cite" nor "ref"
      expect(lines).to.not.include('\\label{sec:intro}')
    })

    it('word boundary: \\b matches whole words only', async function () {
      const r = await grep(
        { pattern: '\\bfoo\\b', caseSensitive: true },
        makeCtx()
      )
      const lines = parseHits(r).map(h => h.line)
      expect(lines).to.include('foo bar baz')
      // 'foofoo' has no \b inside the doubled occurrence
      expect(lines).to.not.include('foofoo barbar')
    })

    it('lazy quantifier: .*? does not span beyond closing brace', async function () {
      const r = await grep(
        { pattern: '\\{.*?\\}', caseSensitive: true },
        makeCtx()
      )
      const lines = parseHits(r).map(h => h.line)
      expect(lines).to.include('\\documentclass{article}')
      expect(lines).to.include('\\title{Foo Bar}')
      expect(lines).to.include('See \\cite{ref1} and \\cite{ref2}.')
    })

    it('escaped backslash: \\\\cite\\{ matches the literal \\cite{', async function () {
      const r = await grep(
        { pattern: '\\\\cite\\{', caseSensitive: true },
        makeCtx()
      )
      const hits = parseHits(r)
      expect(hits).to.have.lengthOf(1)
      expect(hits[0].line).to.equal('See \\cite{ref1} and \\cite{ref2}.')
    })

    it('grouped capture: matches the whole match (captures are not exposed)', async function () {
      // Match {article} or {book} — only the first appears in the corpus.
      const r = await grep(
        { pattern: '\\{(article|book)\\}', caseSensitive: true },
        makeCtx()
      )
      const hits = parseHits(r)
      expect(hits).to.have.lengthOf(1)
      expect(hits[0].line).to.equal('\\documentclass{article}')
    })

    it('positive lookahead: foo(?= bar) matches "foo" before " bar"', async function () {
      // Both 'foo bar baz' and 'foofoo barbar' contain a "foo" immediately
      // before " bar" (the second "foo" in "foofoo" sits right before " bar").
      const r = await grep(
        { pattern: 'foo(?= bar)', caseSensitive: true },
        makeCtx()
      )
      const lines = parseHits(r).map(h => h.line)
      expect(lines).to.deep.equal(['foo bar baz', 'foofoo barbar'])
    })

    it('negative lookahead: foo(?!foo) excludes foofoo prefix', async function () {
      const r = await grep(
        { pattern: 'foo(?!foo)', caseSensitive: true },
        makeCtx()
      )
      const lines = parseHits(r).map(h => h.line)
      expect(lines).to.include('foo bar baz')
      // 'foofoo barbar': first 'foo' IS followed by 'foo', second 'foo' is at
      // position 3 and is followed by ' ' (not foo) — so it still matches once.
      expect(lines).to.include('foofoo barbar')
      // But the match index of the second is 3, not 0 — we can't easily assert
      // that here without exposing capture/index info. Existence is enough.
    })

    it('backreference: (\\w)\\1 finds repeated character pairs', async function () {
      const r = await grep(
        { pattern: '(\\w)\\1', caseSensitive: true },
        makeCtx()
      )
      const lines = parseHits(r).map(h => h.line)
      expect(lines).to.include('foo bar baz')
      expect(lines).to.include('foofoo barbar')
      expect(lines).to.include('aabb cc')
      // 'baz qux' has no repeated pairs
      expect(lines).to.not.include('baz qux')
    })

    it('i flag (default) makes character classes match across case', async function () {
      const r = await grep({ pattern: '[A-Z]{2,}' }, makeCtx())
      // i flag means [A-Z] also matches lowercase runs of 2+
      const lines = parseHits(r).map(h => h.line)
      expect(lines).to.include('foo bar baz') // 'oo' matches [A-Z]{2,} under i
      expect(lines).to.include('FOO BAR')
    })

    it('match every non-empty line via .', async function () {
      const r = await grep({ pattern: '.', maxResults: 500 }, makeCtx())
      const nonEmpty =
        CORPUS.doc111.length + CORPUS.doc222.filter(l => l !== '').length
      expect(parseHits(r)).to.have.lengthOf(nonEmpty)
    })

    it('special-character literal search: searching for "$" requires escaping', async function () {
      const ctx = makeCtx()
      ctx.context.files.push({ path: 'prices.tex', docId: 'doc333' })
      stubFetchWithDocs({
        ...CORPUS,
        doc333: ['Price: $5', 'No dollar here'],
      })
      const r = await grep(
        { pattern: '\\$', caseSensitive: true },
        ctx
      )
      expect(parseHits(r).map(h => h.line)).to.deep.equal(['Price: $5'])
    })

    it('returns each matching line at most once, even with multiple matches in it', async function () {
      const ctx = makeCtx()
      stubFetchWithDocs({
        ...CORPUS,
        doc111: ['banana banana banana'],
        doc222: [],
      })
      const r = await grep(
        { pattern: 'banana', caseSensitive: true },
        ctx
      )
      const hits = parseHits(r)
      expect(hits).to.have.lengthOf(1)
      expect(hits[0].lineNumber).to.equal(1)
    })

    it('does not span across line boundaries (no m/s flag concerns)', async function () {
      const ctx = makeCtx()
      stubFetchWithDocs({
        ...CORPUS,
        doc111: ['line one', 'line two'],
        doc222: [],
      })
      // Even with .* greedy, each line is tested independently.
      const r = await grep(
        { pattern: 'one.*two', caseSensitive: true },
        ctx
      )
      expect(parseHits(r)).to.deep.equal([])
    })
  })
})
