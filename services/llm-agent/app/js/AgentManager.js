// @ts-check

import logger from '@overleaf/logger'
import settings from '@overleaf/settings'
import { generateText } from 'ai'

import {
  appendContextItem,
  appendStep,
  finalizeRun,
  markContextItemReplaced,
} from './AgentStore.js'
import { getAgent, defaultAgent } from './agents/registry.js'
import { buildTools } from './tools/index.js'
import { createModel } from './providers/vercelPortkey.js'
import { ContextManager } from './context/ContextManager.js'
import {
  seedSystemPrompt,
  seedChatHistory,
  seedCurrentFile,
  seedSelection,
  seedUserMessage,
} from './context/seeders.js'

function webUrl(path) {
  return new URL(path, settings.apis.web.url).toString()
}

function basicAuth() {
  return (
    'Basic ' +
    Buffer.from(
      `${settings.httpAuthUser}:${settings.httpAuthPass}`
    ).toString('base64')
  )
}

async function notifyWebAgentComplete(projectId, payload) {
  const response = await fetch(
    webUrl(`/internal/project/${projectId}/agent/complete`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(),
      },
      body: JSON.stringify(payload),
    }
  )
  if (!response.ok) {
    throw new Error(
      `agent completion callback failed with HTTP ${response.status}`
    )
  }
}

/**
 * Entry point for the agent loop. Called without await (fire-and-forget)
 * so the HTTP response can return immediately with the runId.
 *
 * @param {string} runId
 * @param {import('./types.js').AgentInput} input
 * @param {Date} startedAt
 * @param {{ agentName?: string }} [opts]
 */
export async function run(runId, input, startedAt, opts = {}) {
  try {
    const agent =
      (opts.agentName ? getAgent(opts.agentName) : null) ?? defaultAgent()

    const cm = new ContextManager({
      runId,
      projectId: input.projectId,
      store: { appendContextItem, markContextItemReplaced },
    })

    for (const item of seedSystemPrompt(agent)) await cm.add(item)
    for (const item of await seedChatHistory(input)) await cm.add(item)
    for (const item of seedCurrentFile(input)) await cm.add(item)
    for (const item of seedSelection(input)) await cm.add(item)
    for (const item of seedUserMessage(input)) await cm.add(item)

    /** @type {import('./types.js').RunContext} */
    const runCtx = {
      projectId: input.projectId,
      userId: input.userId,
      runId,
      context: input.context,
    }
    const tools = buildTools(runCtx, agent.allowedTools)
    const model = createModel(agent.model)

    const maxSteps = opts.maxSteps ?? agent.maxSteps ?? 20
    let finalText = ''

    for (let i = 0; i < maxSteps; i++) {
      const stepStart = new Date()
      const messages = await cm.render()

      const result = await generateText({
        model,
        tools,
        messages,
        ...(agent.temperature != null
          ? { temperature: agent.temperature }
          : {}),
      })

      const stepEnd = new Date()
      await appendStep(runId, {
        name: 'llm.complete',
        startedAt: stepStart,
        finishedAt: stepEnd,
        input: { messages },
        output: {
          text: result.text ?? '',
          toolCalls: result.toolCalls ?? [],
          toolResults: result.toolResults ?? [],
          finishReason: result.finishReason,
        },
        metadata: {
          model: agent.model ?? settings.llm?.defaultModel,
          inputTokens:
            result.usage?.inputTokens ?? result.usage?.promptTokens,
          outputTokens:
            result.usage?.outputTokens ?? result.usage?.completionTokens,
          latencyMs: stepEnd.getTime() - stepStart.getTime(),
        },
      })

      const toolCalls = result.toolCalls ?? []
      const toolResults = result.toolResults ?? []
      for (const tc of toolCalls) {
        await cm.add({
          kind: 'tool_call',
          role: 'assistant',
          source: { kind: 'tool', ref: tc.toolName },
          content: {
            toolCallId: tc.toolCallId,
            name: tc.toolName,
            args: tc.input ?? tc.args ?? {},
          },
          addedBy: 'llm:assistant',
          meta: { toolCallId: tc.toolCallId, stepIndex: i },
        })
      }
      const resultIds = new Set(toolResults.map(tr => tr.toolCallId))
      for (const tr of toolResults) {
        await cm.add({
          kind: 'tool_output',
          role: 'tool',
          source: { kind: 'tool', ref: tr.toolName },
          content: tr.output ?? tr.result ?? null,
          addedBy: `tool:${tr.toolName}`,
          meta: { toolCallId: tr.toolCallId, stepIndex: i },
        })
      }
      // Synthesize an error tool_output for any tool_call that did not get
      // paired with a result (e.g. parallel call timed out or threw). The
      // Vercel SDK rejects the next prompt if any tool_call lacks a matching
      // tool_result, so we emit a placeholder that's still informative to the
      // model.
      for (const tc of toolCalls) {
        if (resultIds.has(tc.toolCallId)) continue
        await cm.add({
          kind: 'tool_output',
          role: 'tool',
          source: { kind: 'tool', ref: tc.toolName },
          content: `Tool ${tc.toolName} did not return a result (timed out or failed). Try a smaller request, or call this tool alone instead of in parallel.`,
          addedBy: `tool:${tc.toolName}`,
          meta: { toolCallId: tc.toolCallId, stepIndex: i, synthesized: true },
        })
      }
      if (result.text) {
        await cm.add({
          kind: 'assistant_message',
          role: 'assistant',
          source: { kind: 'agent', ref: agent.name },
          content: result.text,
          addedBy: 'llm:assistant',
          meta: { stepIndex: i },
        })
        finalText = result.text
      }

      if (!(result.toolCalls?.length > 0)) break
    }

    const output = { type: 'text', content: finalText }
    await finalizeRun(runId, output, startedAt)
    try {
      await notifyWebAgentComplete(input.projectId, {
        conversationId: input.conversationId,
        userId: input.userId,
        content: output.content,
      })
    } catch (notifyErr) {
      logger.warn(
        { err: notifyErr, runId, projectId: input.projectId },
        'agent completion callback failed'
      )
    }
  } catch (err) {
    logger.error({ err, runId }, 'agent run failed')
    try {
      const output = { type: 'error', content: err.message }
      await finalizeRun(runId, output, startedAt)
      try {
        await notifyWebAgentComplete(input.projectId, {
          conversationId: input.conversationId,
          userId: input.userId,
          content: output.content,
        })
      } catch (notifyErr) {
        logger.warn(
          { err: notifyErr, runId, projectId: input.projectId },
          'agent error completion callback failed'
        )
      }
    } catch (finalizeErr) {
      logger.error(
        { err: finalizeErr, runId },
        'failed to finalize errored run'
      )
    }
  }
}
