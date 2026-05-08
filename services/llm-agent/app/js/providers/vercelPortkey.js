// @ts-check
import { createOpenAI } from '@ai-sdk/openai'
import Settings from '@overleaf/settings'

/**
 * Returns a Vercel AI SDK model instance routed through Portkey.
 * Model selection is entirely a Portkey concern — pass a virtual-key slug like
 * '@deepseek/deepseek-v4-flash' or a plain model name like 'gpt-4o'.
 * Routing config (provider, fallbacks, etc.) lives in the Portkey dashboard.
 *
 * @param {string} [modelSlug] - defaults to Settings.llm.defaultModel
 */
export function createModel(modelSlug) {
  const portkey = Settings.llm?.portkey
  if (!portkey?.apiKey) {
    throw new Error('PORTKEY_API_KEY is not configured')
  }
  const openai = createOpenAI({
    baseURL: portkey.baseURL || 'https://api.portkey.ai/v1',
    apiKey: portkey.apiKey,
  })
  return openai.chat(modelSlug ?? Settings.llm.defaultModel)
}
