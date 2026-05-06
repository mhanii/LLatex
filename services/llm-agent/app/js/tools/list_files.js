// @ts-check

/**
 * List all files in the project.
 *
 * @param {Record<string, never>} _input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<Array<{path: string}>>}
 */
export async function listFiles(_input, ctx) {
  return (ctx.context?.files ?? []).map(f => ({ path: f.path }))
}
