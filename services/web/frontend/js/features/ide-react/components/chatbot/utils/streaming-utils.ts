export function isSafeToStream(text: string): boolean {
  const codeFenceCount = (text.match(/```/g) || []).length
  if (codeFenceCount % 2 !== 0) {
    return false
  }

  const inlineCodeCount = (text.match(/`/g) || []).length
  if (inlineCodeCount % 2 !== 0) {
    return false
  }

  const boldCount = (text.match(/\*\*/g) || []).length
  if (boldCount % 2 !== 0) {
    return false
  }

  // Guard single-asterisk italic markers. We need to ignore asterisks
  // that are part of bold (`**`) or inside code spans/fences. Strip out
  // code fences and inline-code segments, then count unescaped single
  // asterisks that are not adjacent to another asterisk.
  let filtered = ''
  let i = 0
  let inCodeFence = false
  let inInlineCode = false

  while (i < text.length) {
    // Check for code fence start/end
    if (!inInlineCode && text.slice(i, i + 3) === '```') {
      inCodeFence = !inCodeFence
      i += 3
      continue
    }

    if (!inCodeFence && text[i] === '`') {
      inInlineCode = !inInlineCode
      i += 1
      continue
    }

    if (!inCodeFence && !inInlineCode) {
      filtered += text[i]
    }

    i += 1
  }

  let singleStarCount = 0
  for (let j = 0; j < filtered.length; j++) {
    const ch = filtered[j]
    if (ch !== '*') continue
    const prev = filtered[j - 1]
    const next = filtered[j + 1]
    const escaped = prev === '\\'
    // Skip if escaped or part of a double-star (bold)
    if (escaped) continue
    if (next === '*') continue
    if (prev === '*') continue
    singleStarCount += 1
  }

  if (singleStarCount % 2 !== 0) {
    return false
  }

  return true
}

export function splitStreamingMarkdown(text: string): string[] {
  const chunks: string[] = []
  const lines = text.split('\n')

  lines.forEach((line, lineIndex) => {
    const hasTrailingNewline = lineIndex < lines.length - 1
    const lineSuffix = hasTrailingNewline ? '\n' : ''

    if (line.length === 0) {
      if (lineSuffix) chunks.push(lineSuffix)
      return
    }

    const keepLineWhole =
      line.includes('|') ||
      line.includes('```') ||
      line.trim().startsWith('>') ||
      /^\s{4,}/.test(line) ||
      /^\s*[-*+]\s+/.test(line) ||
      /^\s*\d+[.)]\s+/.test(line) ||
      /^#{1,6}\s+/.test(line) ||
      /^\s{2,}\S/.test(line)

    if (keepLineWhole) {
      chunks.push(`${line}${lineSuffix}`)
      return
    }

    const sentenceChunks = line.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g)
    if (!sentenceChunks || sentenceChunks.length === 0) {
      chunks.push(`${line}${lineSuffix}`)
      return
    }

    sentenceChunks.forEach(sentence => {
      const words = sentence.match(/\S+\s*/g)
      if (!words || words.length === 0) {
        chunks.push(sentence)
        return
      }

      if (words.length <= 3) {
        chunks.push(sentence)
        return
      }

      const segmentSize = sentence.length > 120 ? 4 : 3
      for (let index = 0; index < words.length; index += segmentSize) {
        chunks.push(words.slice(index, index + segmentSize).join(''))
      }
    })

    if (lineSuffix) {
      chunks.push(lineSuffix)
    }
  })

  return chunks.filter(chunk => chunk.length > 0)
}