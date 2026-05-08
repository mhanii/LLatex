// @ts-check
import { expect } from 'chai'
import { ContextManager } from '../../../app/js/context/ContextManager.js'

function makeStore() {
  /** @type {{appended: any[], replaced: any[]}} */
  const log = { appended: [], replaced: [] }
  return {
    log,
    appendContextItem: async (runId, item) => {
      log.appended.push({ runId, item })
    },
    markContextItemReplaced: async (runId, oldId, newId, when) => {
      log.replaced.push({ runId, oldId, newId, when })
    },
  }
}

describe('context/ContextManager', function () {
  describe('add', function () {
    it('assigns id + addedAt and persists each item', async function () {
      const store = makeStore()
      const cm = new ContextManager({
        runId: 'r1',
        projectId: 'p1',
        store,
      })
      const id = await cm.add({
        kind: 'user_message',
        role: 'user',
        source: { kind: 'user', ref: 'u1' },
        content: 'hi',
        addedBy: 'seed:user_message',
      })
      expect(id).to.be.a('string').and.have.lengthOf.at.least(8)
      expect(store.log.appended).to.have.lengthOf(1)
      const persisted = store.log.appended[0].item
      expect(persisted.id).to.equal(id)
      expect(persisted.addedAt).to.be.instanceOf(Date)
      expect(persisted.content).to.equal('hi')
    })

    it('chains a singleton kind by setting replacedBy/replacedAt on the prior active item', async function () {
      const store = makeStore()
      const cm = new ContextManager({
        runId: 'r1',
        projectId: 'p1',
        store,
      })
      const oldId = await cm.add({
        kind: 'current_file',
        role: 'user',
        source: { kind: 'file', ref: 'main.tex' },
        content: null,
        ref: { path: 'main.tex', docId: 'doc1' },
        addedBy: 'seed:current_file',
      })
      const newId = await cm.add({
        kind: 'current_file',
        role: 'user',
        source: { kind: 'file', ref: 'intro.tex' },
        content: null,
        ref: { path: 'intro.tex', docId: 'doc2' },
        addedBy: 'seed:current_file',
      })
      expect(store.log.replaced).to.have.lengthOf(1)
      expect(store.log.replaced[0]).to.include({
        runId: 'r1',
        oldId,
        newId,
      })
      const snap = cm.snapshot()
      expect(snap[0].replacedBy).to.equal(newId)
      expect(snap[0].replacedAt).to.be.instanceOf(Date)
      expect(snap[1].replacedBy).to.be.undefined
    })

    it('does not chain non-singleton kinds', async function () {
      const store = makeStore()
      const cm = new ContextManager({
        runId: 'r1',
        projectId: 'p1',
        store,
      })
      await cm.add({
        kind: 'user_message',
        role: 'user',
        source: { kind: 'user', ref: 'u1' },
        content: 'one',
        addedBy: 'seed:user_message',
      })
      await cm.add({
        kind: 'user_message',
        role: 'user',
        source: { kind: 'user', ref: 'u1' },
        content: 'two',
        addedBy: 'seed:user_message',
      })
      expect(store.log.replaced).to.have.lengthOf(0)
      expect(cm.list({ kind: 'user_message' })).to.have.lengthOf(2)
    })
  })

  describe('list', function () {
    it('excludes replaced items by default', async function () {
      const store = makeStore()
      const cm = new ContextManager({
        runId: 'r1',
        projectId: 'p1',
        store,
      })
      await cm.add({
        kind: 'system_prompt',
        role: 'system',
        source: { kind: 'agent', ref: 'default' },
        content: 'old prompt',
        addedBy: 'seed:system_prompt',
      })
      await cm.add({
        kind: 'system_prompt',
        role: 'system',
        source: { kind: 'agent', ref: 'default' },
        content: 'new prompt',
        addedBy: 'seed:system_prompt',
      })
      const active = cm.list()
      expect(active).to.have.lengthOf(1)
      expect(active[0].content).to.equal('new prompt')
    })

    it('filters by kind', async function () {
      const store = makeStore()
      const cm = new ContextManager({
        runId: 'r1',
        projectId: 'p1',
        store,
      })
      await cm.add({
        kind: 'system_prompt',
        role: 'system',
        source: { kind: 'agent', ref: 'default' },
        content: 'sys',
        addedBy: 'seed:system_prompt',
      })
      await cm.add({
        kind: 'user_message',
        role: 'user',
        source: { kind: 'user', ref: 'u1' },
        content: 'hi',
        addedBy: 'seed:user_message',
      })
      expect(cm.list({ kind: 'system_prompt' })).to.have.lengthOf(1)
      expect(cm.list({ kind: 'user_message' })).to.have.lengthOf(1)
    })
  })

  describe('snapshot', function () {
    it('includes replaced items', async function () {
      const store = makeStore()
      const cm = new ContextManager({
        runId: 'r1',
        projectId: 'p1',
        store,
      })
      await cm.add({
        kind: 'selection',
        role: 'user',
        source: { kind: 'selection', ref: 'doc1' },
        content: { text: 'a' },
        addedBy: 'seed:selection',
      })
      await cm.add({
        kind: 'selection',
        role: 'user',
        source: { kind: 'selection', ref: 'doc1' },
        content: { text: 'b' },
        addedBy: 'seed:selection',
      })
      const snap = cm.snapshot()
      expect(snap).to.have.lengthOf(2)
      expect(snap.filter(i => i.replacedBy).length).to.equal(1)
    })
  })
})
