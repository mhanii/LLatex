import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import LlmAgentController from './LlmAgentController.mjs'

export default {
  apply(webRouter) {
    webRouter.post(
      '/project/:project_id/agent/message',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      LlmAgentController.sendMessage
    )
  },
}
