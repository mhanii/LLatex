import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import TrackChangesController from './TrackChangesController.mjs'

export default {
  apply(webRouter) {
    webRouter.get(
      '/project/:project_id/ranges',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      TrackChangesController.getProjectRanges
    )

    webRouter.post(
      '/project/:project_id/track_changes',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteOrReviewProjectContent,
      TrackChangesController.saveTrackChanges
    )

    webRouter.post(
      '/project/:project_id/doc/:doc_id/changes/accept',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteOrReviewProjectContent,
      TrackChangesController.acceptChanges
    )

    webRouter.post(
      '/project/:project_id/doc/:doc_id/changes/reject',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteOrReviewProjectContent,
      TrackChangesController.rejectChanges
    )
  },
}
