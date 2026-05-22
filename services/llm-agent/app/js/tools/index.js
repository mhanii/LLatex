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
      // The Vercel AI SDK passes per-call metadata as the second arg, including
      // a unique toolCallId. Threading it through onToolEvent lets the frontend
      // tell two invocations of the same tool (e.g. compile → edit → compile)
      // apart — without it, both events collapse onto the same status message
      // because the fallback id is `${runId}-${toolName}`.
      execute: async (input, { toolCallId } = {}) => {
        await ctx.onToolEvent?.({
          toolCallId,
          toolName: name,
          status: 'running',
          input,
        })
        try {
          // Tools may define a preExecute hook that runs before `execute`.
          // A non-null return short-circuits dispatch and becomes the output.
          const preOutput = def.preExecute
            ? await def.preExecute(input, ctx)
            : null
          if (preOutput != null) {
            await ctx.onToolEvent?.({
              toolCallId,
              toolName: name,
              status: 'error',
              input,
              error: preOutput,
            })
            return preOutput
          }
          const output = await def.execute(input, ctx)
          await ctx.onToolEvent?.({
            toolCallId,
            toolName: name,
            status: 'completed',
            input,
          })
          return output
        } catch (err) {
          await ctx.onToolEvent?.({
            toolCallId,
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
