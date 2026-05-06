// @ts-check

// With -file-line-error (fileLineErrors: true) most errors appear as
// `./file.tex:N: message`. Plain `! message` lines are the fallback for
// errors that have no file/line context (e.g. internal TeX errors).

const FILE_LINE_RE = /^([./][^:\n]*):(\d+): (.+)/
const BANG_RE = /^! (.+)/
// TeX appends this summary line at the end of a fatal run — it is not an
// actionable error message, so we exclude it (matches the frontend log parser).
const FATAL_SENTINEL = '!  ==> Fatal error occurred, no output PDF file produced!'

/**
 * Extract error strings from a LaTeX output.log.
 * Returns deduplicated error strings suitable for an LLM agent prompt.
 *
 * @param {string} text  Full content of output.log
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
