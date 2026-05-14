// @ts-check

import { Pipeline } from './Pipeline.js'
import { DirectLLMPipeline } from './DirectLLMPipeline.js'

export { Pipeline, DirectLLMPipeline }

const REGISTRY = {
  'direct-llm': opts => new DirectLLMPipeline(opts),
}

/**
 * @param {string} name
 * @param {Object} opts
 * @returns {Pipeline}
 */
export function pipelineFromName(name, opts) {
  const factory = REGISTRY[name]
  if (!factory) {
    throw new Error(
      `Unknown pipeline "${name}". Registered: ${Object.keys(REGISTRY).join(', ')}`
    )
  }
  return factory(opts)
}

export function listPipelines() {
  return Object.keys(REGISTRY)
}
