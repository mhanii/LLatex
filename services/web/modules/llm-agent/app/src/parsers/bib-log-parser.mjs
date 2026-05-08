// @ts-check
//
// Ported from services/web/frontend/js/ide/log-parser/bib-log-parser.ts
// Upstream sha: 1b5887d97f9b4360cd338ff603cedcb624040749
//
// Refresh procedure:
//   git diff <old-sha>..<new-sha> -- services/web/frontend/js/ide/log-parser/bib-log-parser.ts
// Re-apply non-type-annotation changes here, bump the sha above.
//
// Backend port: types stripped, runtime identical to upstream. Used by the
// agent to parse BibTeX/Biber .blg files alongside the LaTeX log so the LLM
// sees the same bibliography errors and warnings the editor renders.

const LINE_SPLITTER_REGEX = /^\[(\d+)].*>\s(INFO|WARN|ERROR)\s-\s(.*)$/

const MULTILINE_WARNING_REGEX = /^Warning--(.+)\n--line (\d+) of file (.+)$/m
const SINGLELINE_WARNING_REGEX = /^Warning--(.+)$/m
const MULTILINE_ERROR_REGEX =
  /^(.*)---line (\d+) of file (.*)\n([^]+?)\nI'm skipping whatever remains of this entry$/m
const BAD_CROSS_REFERENCE_REGEX =
  /^(A bad cross reference---entry ".+?"\nrefers to entry.+?, which doesn't exist)$/m
const MULTILINE_COMMAND_ERROR_REGEX =
  /^(.*)\n?---line (\d+) of file (.*)\n([^]+?)\nI'm skipping whatever remains of this command$/m
const BST_ERROR_REGEX = /^(.*?)\nwhile executing---line (\d+) of file (.*)/m

const MESSAGE_LEVELS = {
  INFO: 'info',
  WARN: 'warning',
  ERROR: 'error',
}

const parserReducer = function (maxErrors) {
  return function (accumulator, parser) {
    const consume = function (logText, regex, process) {
      let match
      let text = logText
      const result = []
      let iterationCount = 0

      while ((match = regex.exec(text))) {
        iterationCount++
        const newEntry = process(match)

        if (maxErrors != null && iterationCount >= maxErrors) {
          return [result, '']
        }

        result.push(newEntry)
        text =
          match.input.slice(0, match.index) +
          match.input.slice(
            match.index + match[0].length + 1,
            match.input.length
          )
      }

      return [result, text]
    }

    const [currentErrors, text] = accumulator
    const [regex, process] = parser
    const [errors, _remainingText] = consume(text, regex, process)
    return [currentErrors.concat(errors), _remainingText]
  }
}

export default class BibLogParser {
  constructor(text, options = {}) {
    if (typeof text !== 'string') {
      throw new Error('BibLogParser Error: text parameter must be a string')
    }
    this.text = text.replace(/(\r\n)|\r/g, '\n')
    this.options = options
    this.lines = text.split('\n')

    this.warningParsers = [
      [
        MULTILINE_WARNING_REGEX,
        function (match) {
          const [fullMatch, message, lineNumber, fileName] = match
          return {
            file: fileName,
            level: 'warning',
            message,
            line: lineNumber,
            raw: fullMatch,
          }
        },
      ],
      [
        SINGLELINE_WARNING_REGEX,
        function (match) {
          const [fullMatch, message] = match
          return {
            file: '',
            level: 'warning',
            message,
            line: '',
            raw: fullMatch,
          }
        },
      ],
    ]
    this.errorParsers = [
      [
        MULTILINE_ERROR_REGEX,
        function (match) {
          const [fullMatch, firstMessage, lineNumber, fileName, secondMessage] =
            match
          return {
            file: fileName,
            level: 'error',
            message: firstMessage + '\n' + secondMessage,
            line: lineNumber,
            raw: fullMatch,
          }
        },
      ],
      [
        BAD_CROSS_REFERENCE_REGEX,
        function (match) {
          const [fullMatch, message] = match
          return {
            file: '',
            level: 'error',
            message,
            line: '',
            raw: fullMatch,
          }
        },
      ],
      [
        MULTILINE_COMMAND_ERROR_REGEX,
        function (match) {
          const [fullMatch, firstMessage, lineNumber, fileName, secondMessage] =
            match
          return {
            file: fileName,
            level: 'error',
            message: firstMessage + '\n' + secondMessage,
            line: lineNumber,
            raw: fullMatch,
          }
        },
      ],
      [
        BST_ERROR_REGEX,
        function (match) {
          const [fullMatch, firstMessage, lineNumber, fileName] = match
          return {
            file: fileName,
            level: 'error',
            message: firstMessage,
            line: lineNumber,
            raw: fullMatch,
          }
        },
      ],
    ]
  }

  parseBibtex() {
    const [allWarnings, remainingText] = this.warningParsers.reduce(
      parserReducer(this.options.maxErrors),
      [[], this.text]
    )
    const [allErrors] = this.errorParsers.reduce(
      parserReducer(this.options.maxErrors),
      [[], remainingText]
    )

    return {
      all: allWarnings.concat(allErrors),
      errors: allErrors,
      warnings: allWarnings,
      files: [],
      typesetting: [],
    }
  }

  parseBiber() {
    const result = {
      all: [],
      errors: [],
      warnings: [],
      files: [],
      typesetting: [],
    }
    this.lines.forEach(function (line) {
      const match = line.match(LINE_SPLITTER_REGEX)
      if (match) {
        const [fullLine, , messageType, message] = match
        const newEntry = {
          file: '',
          level: MESSAGE_LEVELS[messageType] || 'INFO',
          message,
          line: '',
          raw: fullLine,
        }
        const lineMatch = newEntry.message.match(
          /^BibTeX subsystem: \/.+\/(\w+\.\w+)_.+, line (\d+), (.+)$/
        )
        if (lineMatch) {
          const [, fileName, lineNumber, realMessage] = lineMatch
          newEntry.file = fileName
          newEntry.line = lineNumber
          newEntry.message = realMessage
        }
        result.all.push(newEntry)
        switch (newEntry.level) {
          case 'error':
            return result.errors.push(newEntry)
          case 'warning':
            return result.warnings.push(newEntry)
        }
      }
    })
    return result
  }

  parse() {
    const firstLine = this.lines[0]
    if (firstLine.match(/^.*INFO - This is Biber.*$/)) {
      return this.parseBiber()
    } else if (firstLine.match(/^This is BibTeX, Version.+$/)) {
      return this.parseBibtex()
    } else {
      throw new Error(
        'BibLogParser Error: cannot determine whether text is biber or bibtex output'
      )
    }
  }
}
