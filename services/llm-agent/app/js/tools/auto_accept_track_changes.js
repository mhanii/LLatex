// @ts-check
import { basicAuth, docUpdaterUrl, resolveFile, webUrl } from './utils.js'

const autoAcceptedDocIdsByContext = new WeakMap()

/**
 * @param {import('../types.js').RunContext} ctx
 * @returns {Set<string>}
 */
function autoAcceptedDocIds(ctx) {
  let docIds = autoAcceptedDocIdsByContext.get(ctx)
  if (!docIds) {
    docIds = new Set()
    autoAcceptedDocIdsByContext.set(ctx, docIds)
  }
  return docIds
}

/**
 * Accept pending agent changes for the target doc once per follow-up run before
 * the first edit executes. This belongs in orchestration, not edit_file itself:
 * edit_file stays a small replace primitive, while this policy is gated by the
 * run context and the actual tool call.
 *
 * @param {unknown} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<string | undefined>}
 */
export async function autoAcceptTrackChangesBeforeEdit(input, ctx) {
  if (!ctx.autoAcceptTrackChangesOnEdit) return
  if (typeof input !== 'object' || input == null || !('path' in input)) return
  if (typeof input.path !== 'string') return

  const file = resolveFile(input.path, ctx)
  if (!file) return

  const acceptedDocIds = autoAcceptedDocIds(ctx)
  if (acceptedDocIds.has(file.docId)) return

  const base = `${docUpdaterUrl()}/project/${ctx.projectId}/doc/${file.docId}`

  let doc
  try {
    const docRes = await fetch(base, { signal: AbortSignal.timeout(30_000) })
    if (docRes.status === 404) return
    if (!docRes.ok) {
      return `Edit failed: could not inspect pending changes (HTTP ${docRes.status}).`
    }
    doc = await docRes.json()
  } catch (err) {
    return `Edit failed: could not inspect pending changes (${err?.message ?? String(err)}).`
  }

  const changeIds = (doc?.ranges?.changes ?? [])
    .filter(
      change =>
        change?.metadata?.source === 'agent' &&
        change?.metadata?.user_id === ctx.userId
    )
    .map(change => change.id)
    .filter(Boolean)

  if (changeIds.length > 0) {
    try {
      const acceptRes = await fetch(
        new URL(
          `/internal/project/${ctx.projectId}/agent/accept-changes`,
          webUrl()
        ).toString(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: basicAuth(),
          },
          body: JSON.stringify({
            docId: file.docId,
            changeIds,
            userId: ctx.userId,
          }),
          signal: AbortSignal.timeout(30_000),
        }
      )
      if (!acceptRes.ok) {
        return `Edit failed: could not accept pending agent changes (HTTP ${acceptRes.status}).`
      }
    } catch (err) {
      return `Edit failed: could not accept pending agent changes (${err?.message ?? String(err)}).`
    }
  }

  acceptedDocIds.add(file.docId)
}
