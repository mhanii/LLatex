import { expect } from 'chai'
import {
  buildSynctexReferenceLines,
  extractSynctexReferenceLine,
} from '@/features/pdf-preview/util/synctex-reference'

describe('extractSynctexReferenceLine', function () {
  it('extracts a line from pdfPositions', function () {
    expect(
      extractSynctexReferenceLine({
        pdfPositions: [{ line: 20 }, { line: 21 }],
      })
    ).to.equal(20)
  })

  it('falls back to the legacy code field', function () {
    expect(extractSynctexReferenceLine({ code: [{ line: 33 }] })).to.equal(33)
  })

  it('returns null when no line data is present', function () {
    expect(extractSynctexReferenceLine({ pdfPositions: [{ file: 'main.tex' }] })).to
      .be.null
  })

  it('keeps a single successful line lookup instead of falling back', function () {
    expect(buildSynctexReferenceLines(20, null)).to.deep.equal({
      start: 20,
      end: 20,
    })
  })
})