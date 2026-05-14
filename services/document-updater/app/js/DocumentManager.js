const { callbackifyAll } = require('@overleaf/promise-utils')
const RedisManager = require('./RedisManager')
const ProjectHistoryRedisManager = require('./ProjectHistoryRedisManager')
const PersistenceManager = require('./PersistenceManager')
const DiffCodec = require('./DiffCodec')
const DMP = require('diff-match-patch')
const logger = require('@overleaf/logger')
const Metrics = require('./Metrics')
const HistoryManager = require('./HistoryManager')
const Errors = require('./Errors')
const RangesManager = require('./RangesManager')
const { extractOriginOrSource } = require('./Utils')
const { getTotalSizeOfLines } = require('./Limits')
const Settings = require('@overleaf/settings')
const { StringFileData } = require('overleaf-editor-core')

const MAX_UNFLUSHED_AGE = Settings.maxUnflushedAgeMs // document should be flushed to mongo this time after a change

/**
 * Compute the minimal set of line-level change hunks between oldText and
 * newText. Each hunk covers a contiguous run of differing lines and carries
 * the exact old/new strings plus the byte offset of the hunk within oldText.
 *
 * Result is in document order (top → bottom). Apply bottom-up to preserve
 * positions when making sequential edits.
 *
 * @returns {{ hunkOld: string, hunkNew: string, oldOffset: number }[]}
 */
function computeLineHunks(oldText, newText) {
  const dmp = new DMP()
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(oldText, newText)
  const diffs = dmp.diff_main(chars1, chars2, false)
  dmp.diff_charsToLines_(diffs, lineArray)

  const hunks = []
  let oldOffset = 0

  for (let i = 0; i < diffs.length; ) {
    const [type, content] = diffs[i]
    if (type === 0) {
      oldOffset += content.length
      i++
      continue
    }

    let hunkOld = ''
    let hunkNew = ''
    const hunkStart = oldOffset

    while (i < diffs.length && diffs[i][0] !== 0) {
      const [t, c] = diffs[i]
      if (t === -1) {
        hunkOld += c
        oldOffset += c.length
      } else {
        hunkNew += c
      }
      i++
    }

    if (hunkOld === hunkNew) continue

    // Strip a shared trailing newline so the tracked change shows clean line
    // content rather than "line\n" → "line\n".
    if (hunkOld.endsWith('\n') && hunkNew.endsWith('\n')) {
      hunkOld = hunkOld.slice(0, -1)
      hunkNew = hunkNew.slice(0, -1)
    }

    hunks.push({ hunkOld, hunkNew, oldOffset: hunkStart })
  }

  return hunks
}

const DocumentManager = {
  /**
   * @param {string} projectId
   * @param {string} docId
   * @return {Promise<{lines: (string[] | StringFileRawData), version: number, ranges: Ranges, resolvedCommentIds: any[], pathname: string, projectHistoryId: string, unflushedTime: any, alreadyLoaded: boolean, historyRangesSupport: boolean, type: OTType}>}
   */
  async getDoc(projectId, docId) {
    const {
      lines,
      version,
      ranges,
      resolvedCommentIds,
      pathname,
      projectHistoryId,
      unflushedTime,
      historyRangesSupport,
    } = await RedisManager.promises.getDoc(projectId, docId)
    if (lines == null || version == null) {
      logger.debug(
        { projectId, docId },
        'doc not in redis so getting from persistence API'
      )
      const {
        lines,
        version,
        ranges,
        resolvedCommentIds,
        pathname,
        projectHistoryId,
        historyRangesSupport,
      } = await PersistenceManager.promises.getDoc(projectId, docId)
      logger.debug(
        {
          projectId,
          docId,
          lines,
          ranges,
          resolvedCommentIds,
          version,
          pathname,
          projectHistoryId,
          historyRangesSupport,
        },
        'got doc from persistence API'
      )
      await RedisManager.promises.putDocInMemory(
        projectId,
        docId,
        lines,
        version,
        ranges,
        resolvedCommentIds,
        pathname,
        projectHistoryId,
        historyRangesSupport
      )
      return {
        lines,
        version,
        ranges: ranges || {},
        resolvedCommentIds,
        pathname,
        projectHistoryId,
        unflushedTime: null,
        alreadyLoaded: false,
        historyRangesSupport,
        type: Array.isArray(lines) ? 'sharejs-text-ot' : 'history-ot',
      }
    } else {
      return {
        lines,
        version,
        ranges,
        pathname,
        projectHistoryId,
        resolvedCommentIds,
        unflushedTime,
        alreadyLoaded: true,
        historyRangesSupport,
        type: Array.isArray(lines) ? 'sharejs-text-ot' : 'history-ot',
      }
    }
  },

  async getDocAndRecentOps(projectId, docId, fromVersion) {
    const { lines, version, ranges, pathname, projectHistoryId, type } =
      await DocumentManager.getDoc(projectId, docId)

    if (fromVersion === -1) {
      return {
        lines,
        version,
        ops: [],
        ranges,
        pathname,
        projectHistoryId,
        type,
      }
    } else {
      const ops = await RedisManager.promises.getPreviousDocOps(
        docId,
        fromVersion,
        version
      )
      return {
        lines,
        version,
        ops,
        ranges,
        pathname,
        projectHistoryId,
        type,
      }
    }
  },

  async appendToDoc(projectId, docId, linesToAppend, originOrSource, userId) {
    let { lines: currentLines, type } = await DocumentManager.getDoc(
      projectId,
      docId
    )
    if (type === 'history-ot') {
      const file = StringFileData.fromRaw(currentLines)
      // TODO(24596): tc support for history-ot
      currentLines = file.getLines()
    }
    const currentLineSize = getTotalSizeOfLines(currentLines)
    const addedSize = getTotalSizeOfLines(linesToAppend)
    const newlineSize = '\n'.length

    if (currentLineSize + newlineSize + addedSize > Settings.max_doc_length) {
      throw new Errors.FileTooLargeError(
        'doc would become too large if appending this text'
      )
    }

    return await DocumentManager.setDoc(
      projectId,
      docId,
      currentLines.concat(linesToAppend),
      originOrSource,
      userId,
      false,
      false
    )
  },

  async setDoc(
    projectId,
    docId,
    newLines,
    originOrSource,
    userId,
    undoing,
    external
  ) {
    if (newLines == null) {
      throw new Error('No lines were provided to setDoc')
    }

    // Circular dependencies. Import at runtime.
    const HistoryOTUpdateManager = require('./HistoryOTUpdateManager')
    const UpdateManager = require('./UpdateManager')

    const {
      lines: oldLines,
      version,
      alreadyLoaded,
      type,
    } = await DocumentManager.getDoc(projectId, docId)

    logger.debug(
      { docId, projectId, oldLines, newLines },
      'setting a document via http'
    )

    let op
    if (type === 'history-ot') {
      const file = StringFileData.fromRaw(oldLines)
      const operation = DiffCodec.diffAsHistoryOTEditOperation(
        file,
        newLines.join('\n')
      )
      if (operation.isNoop()) {
        op = []
      } else {
        op = [operation.toJSON()]
      }
    } else {
      op = DiffCodec.diffAsShareJsOp(oldLines, newLines)
      if (undoing) {
        for (const o of op || []) {
          o.u = true
        } // Turn on undo flag for each op for track changes
      }
    }

    const { origin, source } = extractOriginOrSource(originOrSource)

    const update = {
      doc: docId,
      op,
      v: version,
      meta: {
        user_id: userId,
      },
    }
    if (external) {
      update.meta.type = 'external'
    }
    if (origin) {
      update.meta.origin = origin
    } else if (source) {
      update.meta.source = source
    }
    // Keep track of external updates, whether they are for live documents
    // (flush) or unloaded documents (evict), and whether the update is a no-op.
    Metrics.inc('external-update', 1, {
      status: op.length > 0 ? 'diff' : 'noop',
      method: alreadyLoaded ? 'flush' : 'evict',
      path: source,
    })

    // Do not notify the frontend about a noop update.
    // We still want to execute the code below
    // to evict the doc if we loaded it into redis for
    // this update, otherwise the doc would never be
    // removed from redis.
    if (op.length > 0) {
      if (type === 'history-ot') {
        await HistoryOTUpdateManager.applyUpdate(projectId, docId, update)
      } else {
        await UpdateManager.promises.applyUpdate(projectId, docId, update)
      }
    }

    // If the document was loaded already, then someone has it open
    // in a project, and the usual flushing mechanism will happen.
    // Otherwise we should remove it immediately since nothing else
    // is using it.
    if (alreadyLoaded) {
      return await DocumentManager.flushDocIfLoaded(projectId, docId)
    } else {
      try {
        return await DocumentManager.flushAndDeleteDoc(projectId, docId, {})
      } finally {
        // There is no harm in flushing project history if the previous
        // call failed and sometimes it is required
        HistoryManager.flushProjectChangesAsync(projectId)
      }
    }
  },

  async flushDocIfLoaded(projectId, docId) {
    let {
      lines,
      version,
      ranges,
      unflushedTime,
      lastUpdatedAt,
      lastUpdatedBy,
    } = await RedisManager.promises.getDoc(projectId, docId)
    if (lines == null || version == null) {
      Metrics.inc('flush-doc-if-loaded', 1, { status: 'not-loaded' })
      logger.debug({ projectId, docId }, 'doc is not loaded so not flushing')
      // TODO: return a flag to bail out, as we go on to remove doc from memory?
      return
    } else if (unflushedTime == null) {
      Metrics.inc('flush-doc-if-loaded', 1, { status: 'unmodified' })
      logger.debug({ projectId, docId }, 'doc is not modified so not flushing')
      return
    }

    logger.debug({ projectId, docId, version }, 'flushing doc')
    Metrics.inc('flush-doc-if-loaded', 1, { status: 'modified' })
    if (!Array.isArray(lines)) {
      const file = StringFileData.fromRaw(lines)
      // TODO(24596): tc support for history-ot
      lines = file.getLines()
    }
    const result = await PersistenceManager.promises.setDoc(
      projectId,
      docId,
      lines,
      version,
      ranges,
      lastUpdatedAt,
      lastUpdatedBy || null
    )
    await RedisManager.promises.clearUnflushedTime(docId)
    return result
  },

  async flushAndDeleteDoc(projectId, docId, options) {
    let result
    try {
      result = await DocumentManager.flushDocIfLoaded(projectId, docId)
    } catch (error) {
      if (options.ignoreFlushErrors) {
        logger.warn(
          { projectId, docId, err: error },
          'ignoring flush error while deleting document'
        )
      } else {
        throw error
      }
    }

    await RedisManager.promises.removeDocFromMemory(projectId, docId)
    return result
  },

  async acceptChanges(projectId, docId, changeIds) {
    if (changeIds == null) {
      changeIds = []
    }

    const {
      lines,
      version,
      ranges,
      pathname,
      projectHistoryId,
      historyRangesSupport,
    } = await DocumentManager.getDoc(projectId, docId)
    if (lines == null || version == null) {
      throw new Errors.NotFoundError(`document not found: ${docId}`)
    }

    // TODO(24596): tc support for history-ot
    const acceptedChangeIds = ranges.changes
      ? ranges.changes
          .filter(change => changeIds.includes(change.id))
          .map(change => change.id)
      : []

    const newRanges = RangesManager.acceptChanges(
      projectId,
      docId,
      acceptedChangeIds,
      ranges,
      lines
    )

    await RedisManager.promises.updateDocument(
      projectId,
      docId,
      lines,
      version,
      [],
      newRanges,
      {}
    )

    if (historyRangesSupport) {
      const historyUpdates = RangesManager.getHistoryUpdatesForAcceptedChanges({
        docId,
        acceptedChangeIds,
        changes: ranges.changes || [],
        lines,
        pathname,
        projectHistoryId,
      })

      if (historyUpdates.length === 0) {
        return { acceptedChangeIds }
      }

      await ProjectHistoryRedisManager.promises.queueOps(
        projectId,
        ...historyUpdates.map(op => JSON.stringify(op))
      )
    }

    return { acceptedChangeIds }
  },

  async rejectChanges(projectId, docId, changeIds, userId) {
    const UpdateManager = require('./UpdateManager')
    const HistoryOTUpdateManager = require('./HistoryOTUpdateManager')

    const { lines, version, ranges } = await DocumentManager.getDoc(
      projectId,
      docId
    )
    if (lines == null || version == null) {
      throw new Errors.NotFoundError(`document not found: ${docId}`)
    }

    const changesToReject = ranges.changes
      ? ranges.changes.filter(change => changeIds.includes(change.id))
      : []

    // Apply inverted operations for rejected changes (based on reject-changes.ts logic)
    // Sort changes in reverse order by position to avoid conflicts
    changesToReject.sort((a, b) => b.op.p - a.op.p)

    const ops = []
    for (const change of changesToReject) {
      if (change.op.i) {
        const deleteOp = {
          p: change.op.p,
          d: change.op.i,
          u: true,
        }
        ops.push(deleteOp)
      } else if (change.op.d) {
        const insertOp = {
          p: change.op.p,
          i: change.op.d,
          u: true,
        }
        ops.push(insertOp)
      }
    }

    const update = {
      doc: docId,
      op: ops,
      v: version,
      meta: {
        user_id: userId,
        ts: new Date().toISOString(),
      },
    }

    if (HistoryOTUpdateManager.isHistoryOTEditOperationUpdate(update)) {
      await HistoryOTUpdateManager.applyUpdate(projectId, docId, update)
    } else {
      await UpdateManager.promises.applyUpdate(projectId, docId, update)
    }

    return { rejectedChangeIds: changesToReject.map(c => c.id) }
  },

  async updateCommentState(projectId, docId, commentId, userId, resolved) {
    const { lines, version, pathname, historyRangesSupport } =
      await DocumentManager.getDoc(projectId, docId)

    if (lines == null || version == null) {
      throw new Errors.NotFoundError(`document not found: ${docId}`)
    }

    if (historyRangesSupport) {
      await RedisManager.promises.updateCommentState(docId, commentId, resolved)

      await ProjectHistoryRedisManager.promises.queueOps(
        projectId,
        JSON.stringify({
          pathname,
          commentId,
          resolved,
          meta: {
            ts: new Date(),
            user_id: userId,
          },
        })
      )
    }
  },

  async getComment(projectId, docId, commentId) {
    // TODO(24596): tc support for history-ot
    const { ranges } = await DocumentManager.getDoc(projectId, docId)

    const comment = ranges?.comments?.find(comment => comment.id === commentId)

    if (!comment) {
      throw new Errors.NotFoundError({
        message: 'comment not found',
        info: { commentId },
      })
    }

    return comment
  },

  async deleteComment(projectId, docId, commentId, userId) {
    const { lines, version, ranges, pathname, historyRangesSupport } =
      await DocumentManager.getDoc(projectId, docId)
    if (lines == null || version == null) {
      throw new Errors.NotFoundError(`document not found: ${docId}`)
    }

    // TODO(24596): tc support for history-ot
    const newRanges = RangesManager.deleteComment(commentId, ranges)

    await RedisManager.promises.updateDocument(
      projectId,
      docId,
      lines,
      version,
      [],
      newRanges,
      {}
    )

    if (historyRangesSupport) {
      await RedisManager.promises.updateCommentState(docId, commentId, false)
      await ProjectHistoryRedisManager.promises.queueOps(
        projectId,
        JSON.stringify({
          pathname,
          deleteComment: commentId,
          meta: {
            ts: new Date(),
            user_id: userId,
          },
        })
      )
    }
  },

  async renameDoc(projectId, docId, userId, update, projectHistoryId) {
    await RedisManager.promises.renameDoc(
      projectId,
      docId,
      userId,
      update,
      projectHistoryId
    )
  },

  async getDocAndFlushIfOld(projectId, docId) {
    let { lines, version, unflushedTime, alreadyLoaded } =
      await DocumentManager.getDoc(projectId, docId)

    // if doc was already loaded see if it needs to be flushed
    if (
      alreadyLoaded &&
      unflushedTime != null &&
      Date.now() - unflushedTime > MAX_UNFLUSHED_AGE
    ) {
      await DocumentManager.flushDocIfLoaded(projectId, docId)
    }

    if (!Array.isArray(lines)) {
      const file = StringFileData.fromRaw(lines)
      // TODO(24596): tc support for history-ot
      lines = file.getLines()
    }

    return { lines, version }
  },

  async resyncDocContents(projectId, docId, path, opts = {}) {
    logger.debug({ projectId, docId, path }, 'start resyncing doc contents')
    let {
      lines,
      ranges,
      resolvedCommentIds,
      version,
      projectHistoryId,
      historyRangesSupport,
    } = await RedisManager.promises.getDoc(projectId, docId)

    // To avoid issues where the same docId appears with different paths,
    // we use the path from the resyncProjectStructure update.  If we used
    // the path from the getDoc call to web then the two occurences of the
    // docId would map to the same path, and this would be rejected by
    // project-history as an unexpected resyncDocContent update.
    if (lines == null || version == null) {
      logger.debug(
        { projectId, docId },
        'resyncing doc contents - not found in redis - retrieving from web'
      )
      ;({
        lines,
        ranges,
        resolvedCommentIds,
        version,
        projectHistoryId,
        historyRangesSupport,
      } = await PersistenceManager.promises.getDoc(projectId, docId, {
        peek: true,
      }))
    } else {
      logger.debug(
        { projectId, docId },
        'resyncing doc contents - doc in redis - will queue in redis'
      )
    }

    if (opts.historyRangesMigration) {
      historyRangesSupport = opts.historyRangesMigration === 'forwards'
    }

    await ProjectHistoryRedisManager.promises.queueResyncDocContent(
      projectId,
      projectHistoryId,
      docId,
      lines,
      ranges ?? {},
      resolvedCommentIds,
      version,
      // use the path from the resyncProjectStructure update
      path,
      historyRangesSupport
    )

    if (opts.historyRangesMigration) {
      await RedisManager.promises.setHistoryRangesSupportFlag(
        docId,
        historyRangesSupport
      )
    }
  },

  async getDocWithLock(projectId, docId) {
    const UpdateManager = require('./UpdateManager')
    return await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.getDoc,
      projectId,
      docId
    )
  },

  async getCommentWithLock(projectId, docId, commentId) {
    const UpdateManager = require('./UpdateManager')
    return await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.getComment,
      projectId,
      docId,
      commentId
    )
  },

  async getDocAndRecentOpsWithLock(projectId, docId, fromVersion) {
    const UpdateManager = require('./UpdateManager')
    return await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.getDocAndRecentOps,
      projectId,
      docId,
      fromVersion
    )
  },

  async getDocAndFlushIfOldWithLock(projectId, docId) {
    const UpdateManager = require('./UpdateManager')
    return await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.getDocAndFlushIfOld,
      projectId,
      docId
    )
  },

  async setDocWithLock(
    projectId,
    docId,
    lines,
    source,
    userId,
    undoing,
    external
  ) {
    const UpdateManager = require('./UpdateManager')
    return await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.setDoc,
      projectId,
      docId,
      lines,
      source,
      userId,
      undoing,
      external
    )
  },

  async appendToDocWithLock(projectId, docId, lines, source, userId) {
    const UpdateManager = require('./UpdateManager')
    return await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.appendToDoc,
      projectId,
      docId,
      lines,
      source,
      userId
    )
  },

  async flushDocIfLoadedWithLock(projectId, docId) {
    const UpdateManager = require('./UpdateManager')
    return await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.flushDocIfLoaded,
      projectId,
      docId
    )
  },

  async flushAndDeleteDocWithLock(projectId, docId, options) {
    const UpdateManager = require('./UpdateManager')
    return await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.flushAndDeleteDoc,
      projectId,
      docId,
      options
    )
  },

  async acceptChangesWithLock(projectId, docId, changeIds) {
    const UpdateManager = require('./UpdateManager')
    return await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.acceptChanges,
      projectId,
      docId,
      changeIds
    )
  },

  // Apply an agent edit (replace `oldText` with `newText`), then collapse the
  // resulting tracked changes for the affected region into a single
  // (insert NEWEST, delete OLDEST) pair.
  //
  // Why this exists: the ranges-tracker silently absorbs overlap when a delete
  // crosses a previously tracked insert — it strips the overlapping content
  // from the new delete's `d` field but keeps the position. Stored ops end up
  // with content that doesn't match the document anywhere (the misalignment
  // we observed). By capturing BEFORE state's ranges (where the original text
  // is still recoverable), reconstructing the region's original text, and
  // overwriting any agent-sourced tracked changes in the affected region with
  // a single clean pair, the live ranges always show one (oldest → newest)
  // diff per touched region — like git diff.
  //
  // Mixed regions (containing user-sourced tracked changes) are left to the
  // standard OT path; we never rewrite a user's change.
  //
  // Returns { status, error?, code? }. 204 = applied; 404 = oldText not found.
  // posHint: absolute position of oldText in the document, supplied by
  // agentReplaceWithLock when it has already located the text.  When absent,
  // indexOf is used (safe for single-hunk / direct callers).
  async agentReplace(projectId, docId, oldText, newText, userId, posHint) {
    // No-op guard: identical old/new produces no diff. Lives here (not just at
    // the HTTP layer) so direct callers also skip the wasted version bump and
    // history op that delete-then-reinsert-same-content would generate.
    if (oldText === newText) {
      return { status: 204 }
    }

    const UpdateManager = require('./UpdateManager')
    const RangesTracker = require('@overleaf/ranges-tracker')

    // 1. Read BEFORE state. The original text in the affected region is only
    //    recoverable here — once the OT update absorbs an existing tracked
    //    insert into a new delete, that information is gone.
    const before = await DocumentManager.getDoc(projectId, docId)
    if (before.lines == null || before.version == null) {
      throw new Errors.NotFoundError(`document not found: ${docId}`)
    }
    const beforeContent = before.lines.join('\n')
    const pos =
      posHint !== undefined ? posHint : beforeContent.indexOf(oldText)
    if (pos < 0 || beforeContent.slice(pos, pos + oldText.length) !== oldText) {
      return { status: 404, error: 'old_text not found' }
    }
    const opEnd = pos + oldText.length

    // 2. Find AGENT tracked changes associated with the edit's region. Two
    //    passes:
    //      a) direct overlap with [pos, opEnd) — inserts that overlap the
    //         interval, deletes strictly inside (NOT at opEnd, which is the
    //         boundary AFTER the edit and belongs to the next region).
    //      b) paired pickup — a tracked delete sitting exactly at
    //         insert.p + insert.length (canAggregate convention) is the
    //         OLDEST half of an already-included insert. Include it so the
    //         original text reconstruction below sees the full pair, even
    //         when the paired delete lands at the right boundary (opEnd).
    //
    //    If a USER change overlaps, mark mixed and skip consolidation —
    //    we never overwrite user changes.
    const beforeChanges = before.ranges?.changes ?? []
    let regionStart = pos
    let regionEnd = opEnd
    const includedIds = new Set()
    const agentChangesInRegion = []
    let mixedWithUser = false

    for (const c of beforeChanges) {
      const cStart = c.op.p
      const isInsert = c.op.i != null
      const cEnd = isInsert ? cStart + c.op.i.length : cStart
      const overlaps = isInsert
        ? cStart < opEnd && cEnd > pos
        : cStart >= pos && cStart < opEnd
      if (!overlaps) continue
      if (c.metadata?.source === 'agent') {
        agentChangesInRegion.push(c)
        includedIds.add(c.id)
        if (cStart < regionStart) regionStart = cStart
        if (cEnd > regionEnd) regionEnd = cEnd
      } else {
        mixedWithUser = true
      }
    }

    // Paired pickup: agent tracked deletes paired with an already-included
    // insert (canAggregate: delete.p === insert.p + insert.length, same user).
    for (const c of beforeChanges) {
      if (includedIds.has(c.id)) continue
      if (c.op.d == null) continue
      if (c.metadata?.source !== 'agent') continue
      const paired = beforeChanges.find(
        o =>
          includedIds.has(o.id) &&
          o.op.i != null &&
          o.op.p + o.op.i.length === c.op.p &&
          o.metadata?.user_id === c.metadata?.user_id
      )
      if (paired) {
        agentChangesInRegion.push(c)
        includedIds.add(c.id)
        if (c.op.p > regionEnd) regionEnd = c.op.p
      }
    }

    // 3. Reconstruct OLDEST text for the region from BEFORE state. Walk the
    //    visible content, splice in tracked-delete content at its position,
    //    skip over tracked-insert content (it wasn't originally there).
    //    We do this BEFORE applying the OT op so absorbed inserts are still
    //    available.
    let oldVersionText = ''
    if (agentChangesInRegion.length > 0 && !mixedWithUser) {
      const sorted = agentChangesInRegion.slice().sort((a, b) => {
        if (a.op.p !== b.op.p) return a.op.p - b.op.p
        // Same position: emit delete first (it's the original-content slot)
        if (a.op.d != null && b.op.i != null) return -1
        if (a.op.i != null && b.op.d != null) return 1
        return 0
      })
      let visiblePos = regionStart
      for (const c of sorted) {
        if (c.op.p > visiblePos) {
          oldVersionText += beforeContent.slice(visiblePos, c.op.p)
          visiblePos = c.op.p
        }
        if (c.op.d != null) {
          oldVersionText += c.op.d
          // tracked delete has zero visible width
        } else if (c.op.i != null) {
          visiblePos += c.op.i.length
        }
      }
      if (visiblePos < regionEnd) {
        oldVersionText += beforeContent.slice(visiblePos, regionEnd)
      }
    }

    // 4. Apply the OT update normally. This produces correct visible content;
    //    its ranges may be messy if there was overlap.
    const tcSeed = RangesTracker.generateIdSeed()
    await UpdateManager.promises.applyUpdate(projectId, docId, {
      doc: docId,
      v: before.version,
      op: [
        { p: pos, d: oldText },
        { p: pos, i: newText },
      ],
      meta: { user_id: userId, tc: tcSeed, source: 'agent' },
    })

    // 5. No overlap with prior agent changes (or mixed with user) → standard
    //    OT path is already clean. Nothing to consolidate.
    if (agentChangesInRegion.length === 0 || mixedWithUser) {
      return { status: 204 }
    }

    // 6. Read AFTER state and extract the NEWEST text for the region. The
    //    region's right boundary shifts by (newText.length - oldText.length).
    const after = await DocumentManager.getDoc(projectId, docId)
    const afterContent = after.lines.join('\n')
    const newRegionEnd = regionEnd + (newText.length - oldText.length)
    const newVersionText = afterContent.slice(regionStart, newRegionEnd)
    // A delete sitting at exactly newRegionEnd is "inside" if it was part of
    // the agent region (includedIds: we want to replace it with the clean pair)
    // or is OT-generated (new ID, not in beforeChanges: messy artifact to drop).
    // It is "outside" only when it's a pre-existing change that was NOT part of
    // the region — i.e., an unrelated delete that happened to shift to the right
    // boundary.  Use strict < only for that case (Greptile P1 fix).
    const beforeChangeIds = new Set(beforeChanges.map(c => c.id))

    // 7. Drop every agent tracked change inside the (post-update) region —
    //    these are the messy ones plus whatever the standard OT path just
    //    created. Keep everything else verbatim. Append a clean consolidated
    //    pair iff oldest !== newest.
    const cleanChanges = []
    for (const c of after.ranges?.changes ?? []) {
      if (c.metadata?.source !== 'agent') {
        cleanChanges.push(c)
        continue
      }
      const cStart = c.op.p
      const isInsert = c.op.i != null
      const cEnd = isInsert ? cStart + c.op.i.length : cStart
      const isUnrelatedPreExisting =
        beforeChangeIds.has(c.id) && !includedIds.has(c.id)
      const inRegion = isInsert
        ? cStart < newRegionEnd && cEnd > regionStart
        : cStart >= regionStart &&
          (isUnrelatedPreExisting ? cStart < newRegionEnd : cStart <= newRegionEnd)
      if (!inRegion) cleanChanges.push(c)
    }

    if (oldVersionText !== newVersionText) {
      const ts = new Date()
      // Insert first, delete after — matches the canAggregate convention the
      // frontend uses to pair them as one block-level chip.
      if (newVersionText.length > 0) {
        cleanChanges.push({
          id: tcSeed + '-i',
          op: { p: regionStart, i: newVersionText },
          metadata: { user_id: userId, ts, source: 'agent' },
        })
      }
      if (oldVersionText.length > 0) {
        cleanChanges.push({
          id: tcSeed + '-d',
          op: { p: regionStart + newVersionText.length, d: oldVersionText },
          metadata: { user_id: userId, ts, source: 'agent' },
        })
      }
    }

    cleanChanges.sort((a, b) => {
      if (a.op.p !== b.op.p) return a.op.p - b.op.p
      if (a.op.i != null && b.op.d != null) return -1
      if (a.op.d != null && b.op.i != null) return 1
      return 0
    })

    // 8. Write back with empty ops (visible content already correct from step 4).
    await RedisManager.promises.updateDocument(
      projectId,
      docId,
      after.lines,
      after.version,
      [],
      { changes: cleanChanges, comments: after.ranges?.comments ?? [] },
      {}
    )

    return { status: 204 }
  },

  async agentReplaceWithLock(projectId, docId, oldText, newText, userId) {
    const UpdateManager = require('./UpdateManager')
    if (oldText === newText) return { status: 204 }

    // Split old→new into minimal line-level hunks (git-diff style). Each hunk
    // becomes its own tracked change so reviewers see exactly what changed.
    const hunks = computeLineHunks(oldText, newText)
    if (hunks.length === 0) return { status: 204 }

    return await UpdateManager.promises.lockUpdatesAndDo(
      async (projectId, docId) => {
        // Find oldText once so every hunk posHint is anchored to the same
        // document position — avoids indexOf finding the wrong occurrence when
        // a hunk's content is not unique in the file.
        const root = await DocumentManager.getDoc(projectId, docId)
        if (root.lines == null) {
          throw new Errors.NotFoundError(`document not found: ${docId}`)
        }
        const rootContent = root.lines.join('\n')
        const basePos = rootContent.indexOf(oldText)
        if (basePos === -1) {
          return { status: 404, error: 'old_text not found' }
        }

        // Apply bottom-up so each hunk's position is unaffected by hunks below.
        for (let i = hunks.length - 1; i >= 0; i--) {
          const { hunkOld, hunkNew, oldOffset } = hunks[i]
          const result = await DocumentManager.agentReplace(
            projectId,
            docId,
            hunkOld,
            hunkNew,
            userId,
            basePos + oldOffset
          )
          if (result.status === 404) return result
        }
        return { status: 204 }
      },
      projectId,
      docId
    )
  },

  async rejectChangesWithLock(projectId, docId, changeIds, userId) {
    const UpdateManager = require('./UpdateManager')
    return await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.rejectChanges,
      projectId,
      docId,
      changeIds,
      userId
    )
  },

  async updateCommentStateWithLock(
    projectId,
    docId,
    threadId,
    userId,
    resolved
  ) {
    const UpdateManager = require('./UpdateManager')
    await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.updateCommentState,
      projectId,
      docId,
      threadId,
      userId,
      resolved
    )
  },

  async deleteCommentWithLock(projectId, docId, threadId, userId) {
    const UpdateManager = require('./UpdateManager')
    await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.deleteComment,
      projectId,
      docId,
      threadId,
      userId
    )
  },

  async renameDocWithLock(projectId, docId, userId, update, projectHistoryId) {
    const UpdateManager = require('./UpdateManager')
    await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.renameDoc,
      projectId,
      docId,
      userId,
      update,
      projectHistoryId
    )
  },

  async resyncDocContentsWithLock(projectId, docId, path, opts) {
    const UpdateManager = require('./UpdateManager')
    await UpdateManager.promises.lockUpdatesAndDo(
      DocumentManager.resyncDocContents,
      projectId,
      docId,
      path,
      opts
    )
  },
}

module.exports = {
  ...callbackifyAll(DocumentManager, {
    multiResult: {
      getDoc: [
        'lines',
        'version',
        'ranges',
        'pathname',
        'projectHistoryId',
        'unflushedTime',
        'alreadyLoaded',
        'historyRangesSupport',
      ],
      getDocWithLock: [
        'lines',
        'version',
        'ranges',
        'pathname',
        'projectHistoryId',
        'unflushedTime',
        'alreadyLoaded',
        'historyRangesSupport',
      ],
      getDocAndFlushIfOld: ['lines', 'version'],
      getDocAndFlushIfOldWithLock: ['lines', 'version'],
      getDocAndRecentOps: [
        'lines',
        'version',
        'ops',
        'ranges',
        'pathname',
        'projectHistoryId',
        'type',
      ],
      getDocAndRecentOpsWithLock: [
        'lines',
        'version',
        'ops',
        'ranges',
        'pathname',
        'projectHistoryId',
        'type',
      ],
    },
  }),
  promises: DocumentManager,
}
