// @ts-check

/**
 * Render the question payload as a plain-text block — used as the assistant's
 * visible chat message when the frontend has no question chooser yet, and as
 * the `content` field of the run's final output. The frontend can render its
 * own UI from the structured `questions` payload once support is added.
 *
 * @param {Array<{question: string, options: Array<{label: string, description?: string}>, multiSelect?: boolean}>} questions
 * @returns {string}
 */
function renderQuestionsAsText(questions) {
  const blocks = questions.map((q, i) => {
    const header = questions.length > 1 ? `${i + 1}. ${q.question}` : q.question
    const hint = q.multiSelect ? ' _(choose one or more)_' : ''
    const options = q.options
      .map((o, j) => {
        const letter = String.fromCharCode('a'.charCodeAt(0) + j)
        const desc = o.description ? ` — ${o.description}` : ''
        return `   ${letter}) ${o.label}${desc}`
      })
      .join('\n')
    return `${header}${hint}\n${options}`
  })
  return blocks.join('\n\n')
}

/**
 * Pause the run and hand control back to the user. Stores the structured
 * questions on the RunContext; AgentManager checks this after each step and
 * finalises the run with `{type:'question', questions, content}` instead of
 * looping further or producing a text reply.
 *
 * The execute return value is what the model sees as the tool result for the
 * remainder of this step. We keep it short — the run is about to end anyway.
 *
 * @param {{
 *   questions: Array<{
 *     question: string,
 *     header?: string,
 *     multiSelect?: boolean,
 *     options: Array<{label: string, description?: string}>,
 *   }>
 * }} input
 * @param {import('../types.js').RunContext} ctx
 * @returns {Promise<string>}
 */
export async function askQuestion({ questions }, ctx) {
  ctx.pendingQuestion = {
    questions,
    text: renderQuestionsAsText(questions),
  }
  return 'Question presented to the user. The run will end after this step; the user replies on the next turn.'
}
