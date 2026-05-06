import TrackChangesRouter from './app/src/TrackChangesRouter.mjs'
import ProjectEditorHandler from '../../app/src/Features/Project/ProjectEditorHandler.mjs'

/** @import { WebModule } from "../../types/web-module" */

const PATCH_APPLIED_FLAG = '__trackChangesBuildProjectModelViewPatched__'

if (!ProjectEditorHandler[PATCH_APPLIED_FLAG]) {
  const buildProjectModelView =
    ProjectEditorHandler.buildProjectModelView.bind(ProjectEditorHandler)

  ProjectEditorHandler.buildProjectModelView = function (...args) {
    const project = args[0]
    const result = buildProjectModelView(...args)

    result.features.trackChanges = true
    result.features.trackChangesVisible = true
    result.trackChangesState = project.track_changes || false

    return result
  }

  ProjectEditorHandler[PATCH_APPLIED_FLAG] = true
}

ProjectEditorHandler.trackChangesAvailable = true

/** @type {WebModule} */
const TrackChangesModule = {
  router: TrackChangesRouter,
}

export default TrackChangesModule
