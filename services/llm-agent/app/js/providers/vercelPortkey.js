// @ts-check
import { createOpenAI } from '@ai-sdk/openai'
import { createDeepSeek } from '@ai-sdk/deepseek'
import Settings from '@overleaf/settings'

/**
 * Returns a Vercel AI SDK model instance routed through Portkey.
 *
 * For DeepSeek slugs (`@deepseek/...`) we use `@ai-sdk/deepseek` instead of
 * `@ai-sdk/openai`: only the dedicated provider knows how to round-trip the
 * `reasoning_content` field that DeepSeek V4 (flash/pro) requires on every
 * follow-up turn. The OpenAI chat adapter silently drops it on both legs and
 * the API 400s on the second call.
 *
 * Model selection is still entirely a Portkey concern — pass a virtual-key
 * slug like '@deepseek/deepseek-v4-flash' or a plain model name like
 * 'gpt-4o'. Routing config (provider, fallbacks, etc.) lives in Portkey.
 *
 * @param {string} [modelSlug]
 */
export function createModel(modelSlug) {
  const portkey = Settings.llm?.portkey
  if (!portkey?.apiKey) {
    throw new Error('PORTKEY_API_KEY is not configured')
  }
  const baseURL = portkey.baseURL || 'https://api.portkey.ai/v1'
  const slug = modelSlug ?? Settings.llm.defaultModel

  if (typeof slug === 'string' && slug.toLowerCase().includes('deepseek')) {
    const deepseek = createDeepSeek({
      baseURL,
      apiKey: portkey.apiKey,
    })
    return deepseek.chat(slug)
  }

  const openai = createOpenAI({
    baseURL,
    apiKey: portkey.apiKey,
  })
  return openai.chat(slug)
}
