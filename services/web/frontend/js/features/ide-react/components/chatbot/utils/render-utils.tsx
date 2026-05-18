import React from 'react'

export const renderStatusText = (
  text: string,
  openEntityByPath: (fileName: string) => void,
  getFullFilePathForTooltip: (fileName: string) => string
): React.ReactNode => {
  const parts: Array<string | JSX.Element> = []
  // Match: word chars/dots/slashes + dot + word chars (file extensions)
  // Also match paths like: src/main.py, ./file.txt, error.txt
  const regex = /([\w./-]*[\w-]+\.[\w-]+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const matchText = match[0]
    const idx = match.index

    // Don't match if preceded by non-space (already part of longer word)
    if (idx > 0) {
      const prevChar = text[idx - 1]
      if (/\w/.test(prevChar)) {
        continue
      }
    }

    // Don't match if followed by non-space (part of longer word)
    const endIdx = idx + matchText.length
    if (endIdx < text.length) {
      const nextChar = text[endIdx]
      if (/\w/.test(nextChar)) {
        continue
      }
    }

    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx))
    }

    const key = `status-file-${idx}`
    const fullPath = getFullFilePathForTooltip(matchText)
    parts.push(
      <button
        key={key}
        type="button"
        className="ide-chatbot-status-file"
        onClick={() => openEntityByPath(matchText)}
        title={fullPath}
      >
        <code>{matchText}</code>
      </button>
    )
    lastIndex = endIdx
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts.map((p, i) => (typeof p === 'string' ? <span key={`s-${i}`}>{p}</span> : p))}</>
}
