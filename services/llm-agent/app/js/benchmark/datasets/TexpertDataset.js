// @ts-check

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Dataset } from './Dataset.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PATH = path.resolve(__dirname, '../data/texpert.json')

/**
 * TeXpert (Kale & Nadadur 2025) — knowledge-verse-ai/TeXpert.
 * 440 examples, single train split, fields:
 *   ID, Task Instructions, Verified LaTeX Code,
 *   Verified LaTeX Source LLM, Class.
 * Downloaded as a single JSON file via scripts/download-texpert.mjs.
 */
export class TexpertDataset extends Dataset {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.filePath]   - override the on-disk JSON location
   */
  constructor({ filePath } = {}) {
    super()
    this.filePath = filePath || DEFAULT_PATH
    /** @type {Array<import('./Dataset.js').Task>|null} */
    this.tasks = null
  }

  get name() {
    return 'texpert'
  }

  get version() {
    return 'TeXpert@main'
  }

  async load() {
    if (this.tasks) return
    if (!fs.existsSync(this.filePath)) {
      throw new Error(
        `TeXpert dataset not found at ${this.filePath}. ` +
          'Run scripts/download-texpert.mjs first.'
      )
    }
    const raw = JSON.parse(await fs.promises.readFile(this.filePath, 'utf8'))
    if (!Array.isArray(raw)) {
      throw new Error(
        `TeXpert dataset must be a JSON array, got ${typeof raw}`
      )
    }
    this.tasks = raw.map(record => normalise(record))
  }

  /**
   * @param {import('./Dataset.js').TaskFilter} [filter]
   */
  *iter(filter = {}) {
    if (!this.tasks) {
      throw new Error('TexpertDataset.iter() called before load()')
    }
    let count = 0
    const ids = filter.ids ? new Set(filter.ids) : null
    for (const task of this.tasks) {
      if (filter.difficulty && task.difficulty !== filter.difficulty) continue
      if (ids && !ids.has(task.id)) continue
      yield task
      count++
      if (filter.limit != null && count >= filter.limit) return
    }
  }
}

/**
 * @param {Record<string, unknown>} record
 * @returns {import('./Dataset.js').Task}
 */
function normalise(record) {
  const id = String(record.ID ?? record.id ?? '')
  const prompt = String(record['Task Instructions'] ?? record.prompt ?? '')
  const reference = String(
    record['Verified LaTeX Code'] ?? record.reference ?? ''
  )
  const difficulty =
    typeof record.Class === 'string' ? record.Class : undefined
  if (!id || !prompt) {
    throw new Error(`TeXpert record missing ID or Task Instructions: ${JSON.stringify(record).slice(0, 120)}`)
  }
  return { id, prompt, reference, difficulty, raw: record }
}
