// @ts-check
import { expect } from 'chai'
import { askQuestion } from '../../../app/js/tools/ask_question.js'
import { makeCtx } from './helpers.js'
import { TOOL_REGISTRY } from '../../../app/js/tools/registry.js'

describe('askQuestion', function () {
  it('sets pendingQuestion on the run context', async function () {
    const ctx = makeCtx()
    await askQuestion(
      {
        questions: [
          {
            question: 'Which citation style?',
            options: [{ label: 'BibTeX' }, { label: 'BibLaTeX' }],
          },
        ],
      },
      ctx
    )
    expect(ctx.pendingQuestion).to.be.an('object')
    expect(ctx.pendingQuestion.questions).to.have.lengthOf(1)
    expect(ctx.pendingQuestion.questions[0].question).to.equal('Which citation style?')
  })

  it('renders question text as the fallback chat representation', async function () {
    const ctx = makeCtx()
    await askQuestion(
      {
        questions: [
          {
            question: 'Which citation style?',
            options: [
              { label: 'BibTeX', description: 'classic' },
              { label: 'BibLaTeX' },
            ],
          },
        ],
      },
      ctx
    )
    const text = ctx.pendingQuestion.text
    expect(text).to.include('Which citation style?')
    expect(text).to.include('a) BibTeX — classic')
    expect(text).to.include('b) BibLaTeX')
  })

  it('numbers questions when more than one is asked', async function () {
    const ctx = makeCtx()
    await askQuestion(
      {
        questions: [
          {
            question: 'Citation style?',
            options: [{ label: 'BibTeX' }, { label: 'BibLaTeX' }],
          },
          {
            question: 'Doc class?',
            options: [{ label: 'article' }, { label: 'report' }],
          },
        ],
      },
      ctx
    )
    expect(ctx.pendingQuestion.text).to.include('1. Citation style?')
    expect(ctx.pendingQuestion.text).to.include('2. Doc class?')
  })

  it('marks multi-select questions in the text rendering', async function () {
    const ctx = makeCtx()
    await askQuestion(
      {
        questions: [
          {
            question: 'Pick all that apply',
            multiSelect: true,
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
      ctx
    )
    expect(ctx.pendingQuestion.text.toLowerCase()).to.include('choose one or more')
  })

  it('returns an acknowledgement string for the model', async function () {
    const ctx = makeCtx()
    const result = await askQuestion(
      {
        questions: [
          {
            question: 'Pick',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
      ctx
    )
    expect(result).to.be.a('string')
    expect(result.toLowerCase()).to.include('user')
  })

  describe('schema validation', function () {
    it('rejects empty questions array', function () {
      const ok = TOOL_REGISTRY.ask_question.inputSchema.safeParse({ questions: [] })
      expect(ok.success).to.be.false
    })

    it('rejects more than 4 questions', function () {
      const qs = Array.from({ length: 5 }, () => ({
        question: 'q?',
        options: [{ label: 'a' }, { label: 'b' }],
      }))
      const ok = TOOL_REGISTRY.ask_question.inputSchema.safeParse({ questions: qs })
      expect(ok.success).to.be.false
    })

    it('rejects fewer than 2 options', function () {
      const ok = TOOL_REGISTRY.ask_question.inputSchema.safeParse({
        questions: [{ question: 'q?', options: [{ label: 'only' }] }],
      })
      expect(ok.success).to.be.false
    })

    it('rejects more than 4 options', function () {
      const ok = TOOL_REGISTRY.ask_question.inputSchema.safeParse({
        questions: [
          {
            question: 'q?',
            options: Array.from({ length: 5 }, (_, i) => ({ label: `opt${i}` })),
          },
        ],
      })
      expect(ok.success).to.be.false
    })

    it('accepts a well-formed multi-question input', function () {
      const ok = TOOL_REGISTRY.ask_question.inputSchema.safeParse({
        questions: [
          {
            question: 'q1?',
            header: 'short',
            multiSelect: true,
            options: [
              { label: 'a', description: 'aa' },
              { label: 'b' },
            ],
          },
          {
            question: 'q2?',
            options: [{ label: 'c' }, { label: 'd' }],
          },
        ],
      })
      expect(ok.success).to.be.true
    })
  })
})
