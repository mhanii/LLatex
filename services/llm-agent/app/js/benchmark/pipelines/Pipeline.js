// @ts-check

/**
 * @typedef {Object} ProjectFile
 * @property {string} path                - relative path, e.g. 'main.tex' or 'sections/intro.tex'
 * @property {string} content
 *
 * @typedef {Object} PipelineInput
 * @property {string} prompt
 * @property {Object} [metadata]          - task difficulty, category, etc.
 *
 * @typedef {Object} PipelineStep
 * @property {string} name                - 'llm-call' | tool name
 * @property {string} startedAt           - ISO timestamp
 * @property {string} finishedAt          - ISO timestamp
 * @property {Object} [metadata]          - { model, inputTokens, outputTokens, latencyMs }
 * @property {string} [error]
 *
 * @typedef {Object} PipelineTotals
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} latencyMs
 *
 * @typedef {Object} PipelineOutput
 * @property {Array<ProjectFile>} files   - one element for DirectLLM; many for agentic pipelines
 * @property {string} entrypoint          - path of the file CLSI compiles
 * @property {Array<PipelineStep>} steps
 * @property {PipelineTotals} totals
 * @property {string} [error]             - set when the pipeline fails before producing output
 */

export class Pipeline {
  /** @returns {string} */
  get name() {
    throw new Error('Pipeline.name must be implemented')
  }

  /**
   * @param {PipelineInput} _input
   * @returns {Promise<PipelineOutput>}
   */
  async run(_input) {
    throw new Error('Pipeline.run() must be implemented')
  }
}
