// @ts-check
import { webUrl, basicAuth } from './utils.js'

/**
 * @typedef {{ imageBase64: string, mimeType: 'image/png' }} PdfPageResult
 */

/**
 * Return a page of the most recently compiled PDF as a base64-encoded PNG.
 * Call compile_and_check first to ensure an up-to-date PDF exists and to
 * find out the total page count.
 *
 * @param {{ page: number }} input  1-indexed page number.
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<PdfPageResult | string>}  Image data, or an error string.
 */
export async function getPdfPage({ page }, ctx) {
  if (!page || page < 1) {
    return 'page must be a positive integer (1-indexed)'
  }
  const url =
    `${webUrl()}/internal/project/${ctx.projectId}/agent/pdf-page` +
    `?page=${page}&userId=${encodeURIComponent(ctx.userId)}`
  const res = await fetch(url, {
    headers: { Authorization: basicAuth() },
    signal: AbortSignal.timeout(30_000), // 30s timeout
  })
  if (!res.ok) {
    if (res.status === 404) {
      return 'No compiled PDF found — run compile_and_check first.'
    }
    const body = await res.json().catch(() => ({}))
    if (res.status === 416 && body?.code === 'PAGE_OUT_OF_RANGE') {
      return `Page ${page} is out of range — use compile_and_check to get the total page count.`
    }
    return `Failed to get PDF page: HTTP ${res.status}`
  }
  return /** @type {PdfPageResult} */ (await res.json())
}
