// @ts-check

import { randomUUID } from 'node:crypto'
import { SINGLETON_KINDS } from './types.js'
import { renderContextItems } from './render.js'

/**
 * Tracks every input the model is shown during a run.
 *
 * - add() assigns an id and persists each item via $push to agentRuns.contextItems.
 * - For singleton kinds (system_prompt, current_file, selection), the prior
 *   active item is marked with replacedBy/replacedAt; the chain stays on disk
 *   for trace.
 * - render() resolves reference-mode items (current_file → docUpdater /peek)
 *   and produces the message array consumed by Vercel AI SDK generateText.
 */
export class ContextManager {
  /**
   * @param {Object} opts
   * @param {string} opts.runId
   * @param {string} opts.projectId
   * @param {{
   *   appendContextItem: (runId: string, item: import('./types.js').ContextItem) => Promise<void>,
   *   markContextItemReplaced: (runId: string, oldId: string, newId: string, when: Date) => Promise<void>,
   * }} opts.store
   */
  constructor({ runId, projectId, store }) {
    this.runId = runId
    this.projectId = projectId
    this.store = store
    /** @type {import('./types.js').ContextItem[]} */
    this.items = []
  }

  /**
   * Append (or replace, for singletons) a context item.
   *
   * @param {Omit<import('./types.js').ContextItem, 'id'|'addedAt'>} partial
   * @returns {Promise<string>}  the new item's id
   */
  async add(partial) {
    const id = randomUUID()
    const addedAt = new Date()
    /** @type {import('./types.js').ContextItem} */
    const item = { id, addedAt, ...partial }

    if (SINGLETON_KINDS.has(item.kind)) {
      const prior = this.items.find(
        i => i.kind === item.kind && !i.replacedBy
      )
      if (prior) {
        prior.replacedBy = id
        prior.replacedAt = addedAt
        await this.store.markContextItemReplaced(
          this.runId,
          prior.id,
          id,
          addedAt
        )
      }
    }

    this.items.push(item)
    await this.store.appendContextItem(this.runId, item)
    return id
  }

  /**
   * Active items (replacedBy unset), in insertion order.
   *
   * @param {{kind?: string, role?: string}} [filter]
   */
  list(filter = {}) {
    return this.items.filter(i => {
      if (i.replacedBy) return false
      if (filter.kind && i.kind !== filter.kind) return false
      if (filter.role && i.role !== filter.role) return false
      return true
    })
  }

  /** Resolve refs and return the messages array for generateText. */
  async render() {
    return renderContextItems(this.list(), { projectId: this.projectId })
  }

  /** Full state including replaced chain — for debugging and replay. */
  snapshot() {
    return [...this.items]
  }
}
