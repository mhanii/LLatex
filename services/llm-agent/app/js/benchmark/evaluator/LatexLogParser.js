// @ts-check

// Mirrors services/web/modules/llm-agent/app/src/LatexLogParser.mjs.
// Duplicated rather than imported because the benchmark must remain
// independent of the web module's load path.

const FILE_LINE_RE = /^([./][^:\n]*):(\d+): (.+)/
const BANG_RE = /^! (.+)/
const FATAL_SENTINEL = '!  ==> Fatal error occurred, no output PDF file produced!'

/**
 * Extract deduplicated error strings from a LaTeX output.log.
 * @param {string} text
 * @returns {string[]}
 */
export function parseLatexLog(text) {
  const errors = []
  const seen = new Set()
  for (const line of text.split('\n')) {
    if (line === FATAL_SENTINEL) continue
    const fle = FILE_LINE_RE.exec(line)
    if (fle) {
      const msg = `${fle[1]}:${fle[2]}: ${fle[3].trim()}`
      if (!seen.has(msg)) {
        seen.add(msg)
        errors.push(msg)
      }
      continue
    }
    const bang = BANG_RE.exec(line)
    if (bang) {
      const msg = bang[1].trim()
      if (!seen.has(msg)) {
        seen.add(msg)
        errors.push(msg)
      }
    }
  }
  return errors
}
