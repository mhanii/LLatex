// @ts-check
//
// Backend mirror of services/web/frontend/js/features/pdf-preview/util/output-files.ts
// (the `handleLogFiles` orchestrator). Upstream sha: 1b5887d97f9b4360cd338ff603cedcb624040749.
//
// Refresh procedure:
//   git diff <old-sha>..<new-sha> -- services/web/frontend/js/features/pdf-preview/util/output-files.ts
// Re-apply changes here if the orchestration logic moves.
//
// We feed the same output.log + *.blg byte stream the editor consumes through
// the same parser pipeline, so the agent's compileAndCheck surfaces the exact
// errors / warnings / typesetting entries the user sees.

import HumanReadableLogs from './HumanReadableLogs.mjs'
import BibLogParser from './bib-log-parser.mjs'

const MAX_LOG_SIZE = 1024 * 1024 // 1MB — matches frontend output-files.ts
const MAX_BIB_LOG_SIZE_PER_FILE = MAX_LOG_SIZE
const TRANSIENT_WARNING_REGEX = /^(Reference|Citation).+undefined on input line/

function isTransientWarning(warning) {
  return TRANSIENT_WARNING_REGEX.test(warning.message || '')
}

function normalizeFilePath(path) {
  if (!path) return path
  path = path.replace(/\/\//g, '/')
  path = path.replace(
    /^.*\/compiles\/[0-9a-f]{24}(-[0-9a-f]{24})?\/(\.\/)?/,
    ''
  )
  path = path.replace(/^\/compile\//, '')
  return path
}

async function fetchFileWithSizeLimit(url, maxSize) {
  const controller = new AbortController()
  let result = ''
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      return ''
    }
    if (!response.body) {
      const text = await response.text()
      return text.length > maxSize ? text.slice(0, maxSize) : text
    }
    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      result += decoder.decode(value, { stream: true })
      if (result.length > maxSize) {
        controller.abort()
        break
      }
    }
  } catch {
    // Mirrors frontend: ignore fetch / decode failures, return what we have.
  }
  return result
}

/**
 * Fetch and parse output.log + every *.blg from a compile's outputFiles.
 *
 * @param {Array<{ path: string, url: string }>} outputFiles
 * @param {string} clsiBaseUrl  e.g. Settings.apis.clsi.url
 * @param {{ stoppedOnFirstError?: boolean }} [opts]
 * @returns {Promise<{
 *   errors: any[], warnings: any[], typesetting: any[], all: any[]
 * }>}
 */
export async function parseCompileLogs(outputFiles, clsiBaseUrl, opts = {}) {
  const result = {
    errors: [],
    warnings: [],
    typesetting: [],
    all: [],
  }

  const buildUrl = file => `${clsiBaseUrl}${file.url}`

  const accumulate = newEntries => {
    for (const key of ['errors', 'warnings', 'typesetting']) {
      if (!newEntries[key]) continue
      for (const entry of newEntries[key]) {
        if (entry.file) entry.file = normalizeFilePath(entry.file)
        result[key].push(entry)
      }
    }
  }

  const logFile = outputFiles.find(f => f.path === 'output.log')
  if (logFile) {
    const log = await fetchFileWithSizeLimit(buildUrl(logFile), MAX_LOG_SIZE)
    if (log) {
      try {
        let { errors, warnings, typesetting } = HumanReadableLogs.parse(log, {
          ignoreDuplicates: true,
        })
        if (opts.stoppedOnFirstError) {
          warnings = warnings.filter(w => !isTransientWarning(w))
        }
        accumulate({ errors, warnings, typesetting })
      } catch {
        // ignore
      }
    }
  }

  const blgFiles = outputFiles.filter(f => f.path.endsWith('.blg'))
  for (const blgFile of blgFiles) {
    const log = await fetchFileWithSizeLimit(
      buildUrl(blgFile),
      MAX_BIB_LOG_SIZE_PER_FILE
    )
    if (!log) continue
    try {
      const { errors, warnings } = new BibLogParser(log, {
        maxErrors: 100,
      }).parse()
      for (const e of errors) e.message = `BibTeX: ${e.message}`
      for (const w of warnings) w.message = `BibTeX: ${w.message}`
      accumulate({ errors, warnings })
    } catch {
      // ignore
    }
  }

  result.all = [...result.errors, ...result.warnings, ...result.typesetting]
  return result
}
