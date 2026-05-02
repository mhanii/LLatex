const sinon = require('sinon')
const modulePath = '../../../../app/js/HttpController.js'
const SandboxedModule = require('sandboxed-module')
const Errors = require('../../../../app/js/Errors.js')

describe('HttpController.agentReplace', function () {
  beforeEach(function () {
    this.projectId = 'project-1'
    this.docId = 'doc-1'
    this.req = {
      params: { project_id: this.projectId, doc_id: this.docId },
      body: {
        old_text: 'target',
        new_text: 'replacement',
        user_id: 'user-1',
      },
    }

    this.res = {
      statusCode: 200,
      status: sinon.stub().callsFake(code => {
        this.res.statusCode = code
        return this.res
      }),
      json: sinon.stub(),
      sendStatus: sinon.stub(),
    }

    this.DocumentManager = {
      promises: {
        getDocWithLock: sinon.stub(),
      },
    }
    this.UpdateManager = {
      promises: {
        applyUpdate: sinon.stub().resolves(),
      },
    }

    this.HttpController = SandboxedModule.require(modulePath, {
      requires: {
        './DocumentManager': this.DocumentManager,
        './HistoryManager': { flushProjectChangesAsync: sinon.stub(), promises: { resyncProjectHistory: sinon.stub().resolves() } },
        './ProjectHistoryRedisManager': { promises: { queueOps: sinon.stub().resolves() } },
        './ProjectManager': {
          promises: {
            flushProjectWithLocks: sinon.stub().resolves(),
            flushAndDeleteProjectWithLocks: sinon.stub().resolves(),
            queueFlushAndDeleteProject: sinon.stub().resolves(),
            getProjectDocsAndFlushIfOld: sinon.stub(),
            updateProjectWithLocks: sinon.stub().resolves(),
          },
        },
        './DeleteQueueManager': {},
        './RedisManager': { DOC_OPS_TTL: 42 },
        './Metrics': { Timer: class Timer {} },
        './Errors': Errors,
        './Utils': { addTrackedDeletesToContent: sinon.stub().returnsArg(0) },
        './HistoryConversions': { toHistoryRanges: sinon.stub().returnsArg(0) },
        './UpdateManager': this.UpdateManager,
        '@overleaf/ranges-tracker': { generateIdSeed: sinon.stub().returns('seed') },
        '@overleaf/settings': { max_doc_length: 2 * 1024 * 1024 },
      },
    })
  })

  it('returns 409 when old_text matches multiple locations', async function () {
    this.DocumentManager.promises.getDocWithLock.resolves({
      lines: ['target line', 'other', 'target line'],
      version: 5,
    })

    await this.HttpController.agentReplace(this.req, this.res, sinon.stub())

    sinon.assert.calledWith(this.res.status, 409)
    sinon.assert.calledWithMatch(this.res.json, {
      error: 'old_text matched multiple locations',
      code: 'AMBIGUOUS_OLD_TEXT',
    })
    sinon.assert.notCalled(this.UpdateManager.promises.applyUpdate)
  })

  it('returns 404 with a stable code when old_text is not found', async function () {
    this.DocumentManager.promises.getDocWithLock.resolves({
      lines: ['no match here'],
      version: 5,
    })

    await this.HttpController.agentReplace(this.req, this.res, sinon.stub())

    sinon.assert.calledWith(this.res.status, 404)
    sinon.assert.calledWithMatch(this.res.json, {
      error: 'old_text not found',
      code: 'OLD_TEXT_NOT_FOUND',
    })
    sinon.assert.notCalled(this.UpdateManager.promises.applyUpdate)
  })
})
