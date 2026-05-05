// @ts-check

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} prompt
 * @property {string} reference        - gold/reference output (single .tex string for TeXpert)
 * @property {string} [difficulty]     - dataset-defined bucket, e.g. "Simple"|"Average"|"Hard"
 * @property {Object} [raw]            - the dataset's original record, for full fidelity
 *
 * @typedef {Object} TaskFilter
 * @property {string} [difficulty]
 * @property {number} [limit]
 * @property {Array<string>} [ids]
 */

export class Dataset {
  /** @returns {string} */
  get name() {
    throw new Error('Dataset.name must be implemented')
  }

  /** @returns {string} */
  get version() {
    return 'unknown'
  }

  /**
   * Load (or lazily prepare) the dataset. Idempotent.
   * @returns {Promise<void>}
   */
  async load() {
    throw new Error('Dataset.load() must be implemented')
  }

  /**
   * Yield tasks, optionally filtered.
   * @param {TaskFilter} [_filter]
   * @returns {Iterable<Task>}
   */
  *iter(_filter) {
    throw new Error('Dataset.iter() must be implemented')
  }
}
