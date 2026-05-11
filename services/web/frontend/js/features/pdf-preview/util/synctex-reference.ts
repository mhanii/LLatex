export type SynctexReferenceLocation = {
  line?: number
  file?: string
}

export type SynctexPdfResponse = {
  pdfPositions?: SynctexReferenceLocation[]
  code?: SynctexReferenceLocation[]
}

export function extractSynctexReferenceLine(
  response: SynctexPdfResponse | null | undefined
): number | null {
  const locations = response?.pdfPositions ?? response?.code ?? []

  const line = locations.find(
    location => typeof location?.line === 'number'
  )?.line

  if (typeof line !== 'number') {
    return null
  }

  return line
}

export function buildSynctexReferenceLines(
  startLine: number | null,
  endLine: number | null
): { start: number; end: number } | null {
  const lines = [startLine, endLine].filter(
    (line): line is number => typeof line === 'number'
  )

  if (lines.length === 0) {
    return null
  }

  return {
    start: Math.min(...lines),
    end: Math.max(...lines),
  }
}