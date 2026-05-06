// @ts-check

import Settings from '@overleaf/settings'
import { LlmProvider } from './LlmProvider.js'
import { PortkeyProvider } from './PortkeyProvider.js'

export { LlmProvider, PortkeyProvider }

/**
 * Build the provider configured for the current environment.
 * Today only Portkey is wired up; future providers register here.
 *
 * @returns {LlmProvider}
 */
export function providerFromEnv() {
  const portkey = Settings.llm?.portkey
  if (!portkey?.apiKey) {
    throw new Error(
      'No LLM provider configured. Set PORTKEY_API_KEY (and PORTKEY_VIRTUAL_KEY or PORTKEY_CONFIG).'
    )
  }
  return new PortkeyProvider({
    apiKey: portkey.apiKey,
    virtualKey: portkey.virtualKey,
    config: portkey.config,
    baseURL: portkey.baseURL,
  })
}
