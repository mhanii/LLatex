// @ts-check

import { tool } from 'ai'
import { TOOL_REGISTRY } from './registry.js'

/**
 * Build a Vercel AI SDK tool map by selecting entries from the canonical
 * TOOL_REGISTRY and currying ctx into each execute function.
 *
 * @param {import('../types.js').RunContext} ctx
 * @param {string[]} [toolNames]  Optional allowlist; defaults to all tools.
 */
export function buildTools(ctx, toolNames) {
  const names = toolNames ?? Object.keys(TOOL_REGISTRY)
  /** @type {Record<string, ReturnType<typeof tool>>} */
  const out = {}
  for (const name of names) {
    const def = TOOL_REGISTRY[name]
    if (!def) {
      throw new Error(`Unknown tool: ${name}`)
    }
    out[name] = tool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: async input => {
        await ctx.onToolEvent?.({
          toolName: name,
          status: 'running',
          input,
        })
        try {
          const output = await def.execute(input, ctx)
          await ctx.onToolEvent?.({
            toolName: name,
            status: 'completed',
            input,
          })
          return output
        } catch (err) {
          await ctx.onToolEvent?.({
            toolName: name,
            status: 'error',
            input,
            error: err?.message ?? String(err),
          })
          throw err
        }
      },
    })
  }
  return out
}
