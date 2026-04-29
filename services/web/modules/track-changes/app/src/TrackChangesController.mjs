import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import CollaboratorsHandler from '../../../../app/src/Features/Collaborators/CollaboratorsHandler.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'

async function getProjectRanges(req, res) {
  const { project_id: projectId } = req.params
  const docs = await DocumentUpdaterHandler.promises.getProjectRanges(projectId)
  res.json(docs)
}

async function saveTrackChanges(req, res) {
  const { project_id: projectId } = req.params
  const body = req.body || {}

  if (body.on != null && typeof body.on !== 'boolean') {
    return res.status(400).json({ error: 'on must be a boolean' })
  }

  if (
    body.on_for != null &&
    (typeof body.on_for !== 'object' || Array.isArray(body.on_for))
  ) {
    return res.status(400).json({ error: 'on_for must be an object' })
  }

  if (
    body.on_for_guests != null &&
    typeof body.on_for_guests !== 'boolean'
  ) {
    return res.status(400).json({ error: 'on_for_guests must be a boolean' })
  }

  if (
    body.on == null &&
    body.on_for == null &&
    body.on_for_guests == null
  ) {
    return res.status(400).json({ error: 'track changes state required' })
  }

  const project = await Project.findOne(
    { _id: projectId },
    { track_changes: 1 }
  )
    .lean()
    .exec()

  if (!project) {
    return res.status(404).json({ error: 'project not found' })
  }

  let nextTrackChangesState

  if (typeof body.on === 'boolean') {
    nextTrackChangesState = body.on
  } else {
    nextTrackChangesState = await getExplicitTrackChangesState(
      projectId,
      project.track_changes
    )

    if (body.on_for) {
      for (const [userId, enabled] of Object.entries(body.on_for)) {
        if (typeof enabled !== 'boolean') {
          return res
            .status(400)
            .json({ error: 'on_for values must be booleans' })
        }
        nextTrackChangesState[userId] = enabled
      }
    }

    if (typeof body.on_for_guests === 'boolean') {
      nextTrackChangesState.__guests__ = body.on_for_guests
    }
  }

  await Project.updateOne(
    { _id: projectId },
    { $set: { track_changes: nextTrackChangesState } }
  ).exec()

  EditorRealTimeController.emitToRoom(
    projectId,
    'toggle-track-changes',
    nextTrackChangesState
  )

  res.sendStatus(204)
}

async function acceptChanges(req, res) {
  const { project_id: projectId, doc_id: docId } = req.params
  const changeIds = req.body?.change_ids
  const userId = getLoggedInUserId(req)

  if (!Array.isArray(changeIds)) {
    return res.status(400).json({ error: 'change_ids must be an array' })
  }

  await DocumentUpdaterHandler.promises.acceptChanges(
    projectId,
    docId,
    changeIds,
    userId
  )

  EditorRealTimeController.emitToRoom(
    projectId,
    'accept-changes',
    docId,
    changeIds
  )

  res.sendStatus(204)
}

async function rejectChanges(req, res) {
  const { project_id: projectId, doc_id: docId } = req.params
  const changeIds = req.body?.change_ids
  const userId = getLoggedInUserId(req)

  if (!Array.isArray(changeIds)) {
    return res.status(400).json({ error: 'change_ids must be an array' })
  }

  const response = await DocumentUpdaterHandler.promises.rejectChanges(
    projectId,
    docId,
    changeIds,
    userId
  )

  EditorRealTimeController.emitToRoom(
    projectId,
    'reject-changes',
    docId,
    response.rejectedChangeIds
  )

  res.json(response)
}

async function getExplicitTrackChangesState(projectId, trackChangesState) {
  if (
    trackChangesState &&
    typeof trackChangesState === 'object' &&
    !Array.isArray(trackChangesState)
  ) {
    return { ...trackChangesState }
  }

  if (trackChangesState === true) {
    return await CollaboratorsHandler.promises.convertTrackChangesToExplicitFormat(
      projectId,
      trackChangesState
    )
  }

  return {}
}

function getLoggedInUserId(req) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    throw new Error('no logged-in user')
  }
  return userId.toString()
}

export default {
  getProjectRanges: expressify(getProjectRanges),
  saveTrackChanges: expressify(saveTrackChanges),
  acceptChanges: expressify(acceptChanges),
  rejectChanges: expressify(rejectChanges),
}
