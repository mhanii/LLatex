// @ts-check
import settings from '@overleaf/settings'

/**
 * @param {string} path
 * @param {import('../types.js').RunContext} ctx
 * @returns {{path: string, docId: string}}
 */
export function resolveFile(path, ctx) {
  const file = ctx.context?.files?.find(f => f.path === path)
  if (!file) {
    throw new Error(
      `File "${path}" not found. Call list_files to see available files.`
    )
  }
  return file
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
