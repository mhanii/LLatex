// @ts-check
import settings from '@overleaf/settings'

/**
 * @param {string} path
 * @param {import('../types.js').RunContext} ctx
 * @returns {{path: string, docId: string} | null}
 */
export function resolveFile(path, ctx) {
  return ctx.context?.files?.find(f => f.path === path) ?? null
}

/**
 * Standard error string for an unknown path, used by read/edit/outline tools.
 * @param {string} path
 * @returns {string}
 */
export function unknownPathError(path) {
  return `File "${path}" not found. Call list_files to see available files.`
}

export function docUpdaterUrl() {
  return settings.apis.documentUpdater.url
}

export function webUrl() {
  return settings.apis.web.url
}

export function basicAuth() {
  return (
    'Basic ' +
    Buffer.from(
      `${settings.httpAuthUser}:${settings.httpAuthPass}`
    ).toString('base64')
  )
}
