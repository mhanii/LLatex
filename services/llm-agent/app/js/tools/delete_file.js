// @ts-check
import { webUrl, basicAuth } from './utils.js'

/**
 * Delete a file from the project.
 *
 * @param {{ path: string }} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<string>}
 */
export async function deleteFile({ path }, ctx) {
  const res = await fetch(
    `${webUrl()}/internal/project/${ctx.projectId}/agent/delete-file`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(),
      },
      body: JSON.stringify({ path, userId: ctx.userId }),
    }
  )
  if (res.status === 404) {
    return `"${path}" not found in project.`
  }
  if (!res.ok) {
    return `Delete failed: HTTP ${res.status}`
  }
  return 'Deleted.'
}
