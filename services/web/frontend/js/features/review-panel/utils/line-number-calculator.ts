import { Text } from '@codemirror/state'

/**
 * Calculates the line numbers for a range of text based on character positions.
 * @param doc - CodeMirror Text document
 * @param startPos - Starting character position
 * @param length - Length of the range in characters
 * @returns Object with startLine and endLine (1-indexed) or null if invalid
 */
export function getLineNumbersForRange(
  doc: Text,
  startPos: number,
  length: number
): { startLine: number; endLine: number } | null {
  if (startPos < 0 || startPos > doc.length || length < 0) {
    return null
  }

  try {
    const startLine = doc.lineAt(startPos).number
    const endPos = Math.min(startPos + length, doc.length)
    const endLine = doc.lineAt(endPos).number

    return { startLine, endLine }
  } catch (error) {
    return null
  }
}

/**
 * Formats line numbers for display
 * @param startLine - Starting line number
 * @param endLine - Ending line number
 * @returns Formatted string like "Lineas 20" or "Lineas 20-22"
 */
export function formatLineNumbers(startLine: number, endLine: number): string {
  if (startLine === endLine) {
    return `Linea ${startLine}`
  }
  return `Lineas ${startLine}-${endLine}`
}

/**
 * Gets formatted line number string for a comment range
 * @param doc - CodeMirror Text document
 * @param position - Character position of the range start
 * @param length - Length of the range
 * @returns Formatted string or empty string if calculation fails
 */
export function getFormattedLineNumbers(
  doc: Text,
  position: number,
  length: number
): string {
  const lineNumbers = getLineNumbersForRange(doc, position, length)
  if (!lineNumbers) {
    return ''
  }
  return formatLineNumbers(lineNumbers.startLine, lineNumbers.endLine)
}
