// @ts-check
//
// Per-model token prices in USD per 1M tokens.
//
// Keys must match the model slugs passed to createModel() in
// providers/vercelPortkey.js — typically Portkey virtual-key slugs
// (`@<provider>/<model>`) or bare OpenAI model names.
//
// Add a price entry for every model an agent might use. Unknown models
// contribute 0 USD to cost-cap accounting (with a logged warning) so a
// missing entry never breaks the run — only the cost-cap enforcement
// for that model becomes a no-op.

import logger from '@overleaf/logger'

const PRICES = {
  // DeepSeek (via Portkey virtual key)
  '@deepseek/deepseek-v4-flash': { input: 0.07, output: 1.1 },
  '@deepseek/deepseek-v4-pro': { input: 0.27, output: 1.1 },
  '@deepseek/deepseek-r1': { input: 0.55, output: 2.19 },

  // OpenAI (bare names or via Portkey virtual key)
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  '@openai/gpt-4o': { input: 2.5, output: 10.0 },
  '@openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
}

const warnedUnknownModels = new Set()

/**
 * @param {string|undefined} model
 * @param {number|undefined} inputTokens
 * @param {number|undefined} outputTokens
 * @returns {number} cost in USD
 */
export function calcCostUsd(model, inputTokens, outputTokens) {
  if (!model) return 0
  const p = PRICES[model]
  if (!p) {
    if (!warnedUnknownModels.has(model)) {
      warnedUnknownModels.add(model)
      logger.warn(
        { model },
        'no price entry for model — cost-cap accounting will report 0 for this model. Add it to services/llm-agent/app/js/cost/priceTable.js'
      )
    }
    return 0
  }
  const inTok = inputTokens ?? 0
  const outTok = outputTokens ?? 0
  return (inTok * p.input + outTok * p.output) / 1_000_000
}
