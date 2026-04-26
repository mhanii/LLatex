// @ts-check

import { ObjectId } from '../../../../app/js/mongodb.js'
import { expect } from 'chai'
import * as AgentClient from './helpers/AgentClient.js'
import * as AgentApp from './helpers/AgentApp.js'
import './helpers/MongoHelper.js'

describe('Health check', function () {
  before(async function () {
    await AgentApp.ensureRunning()
  })

  it('should return 200', async function () {
    const { status } = await AgentClient.health()
    expect(status).to.equal(200)
  })
})

describe('Starting a run', function () {
  before(async function () {
    await AgentApp.ensureRunning()
  })

  const projectId = new ObjectId().toString()
  const userId = new ObjectId().toString()
  const conversationId = new ObjectId().toString()

  describe('with a valid payload', function () {
    let runId

    before(async function () {
      const { status, body } = await AgentClient.startRun(projectId, {
        userId,
        conversationId,
        userMessage: 'Fix the grammar in the introduction',
      })
      expect(status).to.equal(200)
      expect(body).to.have.property('runId')
      runId = body.runId
    })

    it('should create a run document in MongoDB', async function () {
      // Give the stub AgentManager a moment to finalize
      await new Promise(resolve => setTimeout(resolve, 100))

      const doc = await AgentApp.db.agentRuns.findOne({
        _id: new ObjectId(runId),
      })
      expect(doc).to.exist
      expect(doc.projectId).to.equal(projectId)
      expect(doc.userId).to.equal(userId)
      expect(doc.conversationId).to.equal(conversationId)
      expect(doc.input.userMessage).to.equal(
        'Fix the grammar in the introduction'
      )
    })

    it('should finalize the run as done', async function () {
      await new Promise(resolve => setTimeout(resolve, 200))

      const doc = await AgentApp.db.agentRuns.findOne({
        _id: new ObjectId(runId),
      })
      expect(doc.status).to.equal('done')
      expect(doc.output).to.deep.include({ type: 'text' })
      expect(doc.durationMs).to.be.a('number')
    })
  })

  describe('with a selection', function () {
    it('should store the selection in the run document', async function () {
      const selection = {
        docId: new ObjectId().toString(),
        fromLine: 10,
        toLine: 14,
        content: 'the selected lines of text',
      }
      const { status, body } = await AgentClient.startRun(projectId, {
        userId,
        conversationId,
        userMessage: 'Improve this paragraph',
        selection,
      })
      expect(status).to.equal(200)

      await new Promise(resolve => setTimeout(resolve, 100))

      const doc = await AgentApp.db.agentRuns.findOne({
        _id: new ObjectId(body.runId),
      })
      expect(doc.input.selection).to.deep.equal(selection)
    })
  })

  describe('validation', function () {
    it('should return 400 when userMessage is missing', async function () {
      const { status, body } = await AgentClient.startRun(projectId, {
        userId,
        conversationId,
      })
      expect(status).to.equal(400)
      expect(body.error).to.be.a('string')
    })

    it('should return 400 when userId is missing', async function () {
      const { status } = await AgentClient.startRun(projectId, {
        conversationId,
        userMessage: 'hello',
      })
      expect(status).to.equal(400)
    })

    it('should return 400 when conversationId is missing', async function () {
      const { status } = await AgentClient.startRun(projectId, {
        userId,
        userMessage: 'hello',
      })
      expect(status).to.equal(400)
    })
  })
})
