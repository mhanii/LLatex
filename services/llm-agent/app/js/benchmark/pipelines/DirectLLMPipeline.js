// @ts-check

import { Pipeline } from './Pipeline.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SYSTEM_PROMPT = readFileSync(join(__dirname, 'prompts', 'generation.txt'), 'utf8').trim()

/**
 * One-shot LLM call: prompt → single .tex file.
 * No tools, no compile-check loop, no reflection. The OP1c baseline.
 */
export class DirectLLMPipeline extends Pipeline {
  /**
   * @param {Object} opts
   * @param {import('../../providers/LlmProvider.js').LlmProvider} opts.provider
   * @param {string} opts.model
   * @param {number} [opts.temperature]
   * @param {number} [opts.maxTokens]
   * @param {string} [opts.systemPrompt]
   */
  constructor({ provider, model, temperature, maxTokens, systemPrompt }) {
    super()
    this.provider = provider
    this.model = model
    this.temperature = temperature
    this.maxTokens = maxTokens
    this.systemPrompt = systemPrompt ?? SYSTEM_PROMPT
  }

  get name() {
    return 'direct-llm'
  }

  /**
   * @param {import('./Pipeline.js').PipelineInput} input
   * @returns {Promise<import('./Pipeline.js').PipelineOutput>}
   */
  async run(input) {
    const startedAt = new Date()
    let result
    let error
    try {
      result = await this.provider.complete({
        system: this.systemPrompt,
        messages: [{ role: 'user', content: input.prompt }],
        model: this.model,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      })
    } catch (err) {
      error = err.message || String(err)
    }
    const finishedAt = new Date()

    /** @type {import('./Pipeline.js').PipelineStep} */
    const step = {
      name: 'llm-call',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      metadata: result
        ? {
            model: result.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
            reasoningText: result.reasoningText,
          }
        : { latencyMs: finishedAt.getTime() - startedAt.getTime() },
    }
    if (error) step.error = error

    const latex = result ? stripCodeFences(result.text) : ''

    return {
      files: [{ path: 'main.tex', content: latex }],
      entrypoint: 'main.tex',
      steps: [step],
      totals: {
        inputTokens: result?.inputTokens ?? 0,
        outputTokens: result?.outputTokens ?? 0,
        latencyMs: finishedAt.getTime() - startedAt.getTime(),
      },
      error,
    }
  }
}

/**
 * Models occasionally wrap output in ```latex ... ``` even when told not to.
 * Strip the fence if present; otherwise pass through unchanged.
 * @param {string} text
 */
function stripCodeFences(text) {
  const trimmed = text.trim()
  const fence = /^```(?:latex|tex)?\n([\s\S]*?)\n```$/i.exec(trimmed)
  return fence ? fence[1] : trimmed
}
