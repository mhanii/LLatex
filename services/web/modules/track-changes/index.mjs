import TrackChangesRouter from './app/src/TrackChangesRouter.mjs'
import ProjectEditorHandler from '../../app/src/Features/Project/ProjectEditorHandler.mjs'

/** @import { WebModule } from "../../types/web-module" */

const buildProjectModelView =
  ProjectEditorHandler.buildProjectModelView.bind(ProjectEditorHandler)

ProjectEditorHandler.trackChangesAvailable = true

ProjectEditorHandler.buildProjectModelView = function (...args) {
  const project = args[0]
  const result = buildProjectModelView(...args)

  result.features.trackChanges = true
  result.features.trackChangesVisible = true
  result.trackChangesState = project.track_changes || false

  return result
}

/** @type {WebModule} */
const TrackChangesModule = {
  router: TrackChangesRouter,
}

export default TrackChangesModule
