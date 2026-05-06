import { describe, it, expect } from 'vitest'
import { parseLatexLog } from '../../../app/src/LatexLogParser.mjs'

describe('parseLatexLog', function () {
  it('extracts file-line-error format errors', function () {
    const log = `
This is pdfTeX
./main.tex:5: Undefined control sequence.
l.5 \\badcommand
./main.tex:10: Missing $ inserted.
l.10 x^2
`
    const errors = parseLatexLog(log)
    expect(errors).toEqual([
      './main.tex:5: Undefined control sequence.',
      './main.tex:10: Missing $ inserted.',
    ])
  })

  it('extracts bang-style errors', function () {
    const log = `
This is pdfTeX
! Undefined control sequence.
l.5 \\badcmd
! Emergency stop.
`
    const errors = parseLatexLog(log)
    expect(errors).toEqual([
      'Undefined control sequence.',
      'Emergency stop.',
    ])
  })

  it('deduplicates identical errors', function () {
    const log = `
./main.tex:5: Undefined control sequence.
./main.tex:5: Undefined control sequence.
! Emergency stop.
! Emergency stop.
`
    const errors = parseLatexLog(log)
    expect(errors).toEqual([
      './main.tex:5: Undefined control sequence.',
      'Emergency stop.',
    ])
  })

  it('returns empty array for a clean log', function () {
    const log = `
This is pdfTeX, Version 3.141592653
Output written on output.pdf (2 pages, 12345 bytes).
Transcript written on output.log.
`
    expect(parseLatexLog(log)).toEqual([])
  })

  it('ignores the fatal-error sentinel line that ends with ==> Fatal error', function () {
    const log = `! Undefined control sequence.
l.3 \\bad
!  ==> Fatal error occurred, no output PDF file produced!
`
    const errors = parseLatexLog(log)
    expect(errors).toEqual(['Undefined control sequence.'])
    expect(errors).not.toContain(
      ' ==> Fatal error occurred, no output PDF file produced!'
    )
  })

  it('trims trailing whitespace from error messages', function () {
    const log = `./main.tex:3: Some error with trailing spaces   \n`
    const [first] = parseLatexLog(log)
    expect(first).toBe('./main.tex:3: Some error with trailing spaces')
  })

  it('handles empty string', function () {
    expect(parseLatexLog('')).toEqual([])
  })
})
