// @ts-check

import { Dataset } from './Dataset.js'
import { TexpertDataset } from './TexpertDataset.js'

export { Dataset, TexpertDataset }

const REGISTRY = {
  texpert: opts => new TexpertDataset(opts),
}

/**
 * @param {string} name
 * @param {Object} [opts]
 * @returns {Dataset}
 */
export function datasetFromName(name, opts) {
  const factory = REGISTRY[name]
  if (!factory) {
    throw new Error(
      `Unknown dataset "${name}". Registered: ${Object.keys(REGISTRY).join(', ')}`
    )
  }
  return factory(opts)
}

export function listDatasets() {
  return Object.keys(REGISTRY)
}
