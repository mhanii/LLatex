// @ts-check
import { webUrl, basicAuth } from './utils.js'

/**
 * Rename or move a file within the project.
 *
 * @param {{ oldPath: string, newPath: string }} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<string>}
 */
export async function moveFile({ oldPath, newPath }, ctx) {
  const res = await fetch(
    `${webUrl()}/internal/project/${ctx.projectId}/agent/move-file`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(),
      },
      body: JSON.stringify({ oldPath, newPath, userId: ctx.userId }),
      signal: AbortSignal.timeout(30_000), // 30s timeout
    }
  )
  if (res.status === 404) {
    return `"${oldPath}" not found in project.`
  }
  if (!res.ok) {
    return `Move failed: HTTP ${res.status}`
  }
  return 'Moved.'
}
