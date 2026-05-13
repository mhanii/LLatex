import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import LlmAgentController from './LlmAgentController.mjs'

const requirePrivateApiAuth = () =>
  AuthenticationController.requirePrivateApiAuth()

export default {
  apply(webRouter) {
    webRouter.get(
      '/project/:project_id/agent/conversations',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      LlmAgentController.listConversations
    )
    webRouter.post(
      '/project/:project_id/agent/conversations',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      LlmAgentController.createConversation
    )
    webRouter.delete(
      '/project/:project_id/agent/conversations/:conversation_id',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      LlmAgentController.deleteConversation
    )
    webRouter.get(
      '/project/:project_id/agent/conversations/:conversation_id/messages',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      LlmAgentController.getConversationMessages
    )
    webRouter.post(
      '/project/:project_id/agent/message',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanReadProject,
      LlmAgentController.sendMessage
    )
  },

  // Internal service-to-service routes must be registered before CSRF middleware
  // is attached to webRouter. They use Basic auth, not session cookies, so CSRF
  // is not an attack vector.
  applyNonCsrfRouter(webRouter) {
    webRouter.post(
      '/internal/project/:project_id/agent/complete',
      requirePrivateApiAuth(),
      LlmAgentController.agentComplete
    )
    webRouter.post(
      '/internal/project/:project_id/agent/tool-call',
      requirePrivateApiAuth(),
      LlmAgentController.agentToolCall
    )
    webRouter.post(
      '/internal/project/:project_id/agent/create-file',
      requirePrivateApiAuth(),
      LlmAgentController.agentCreateFile
    )
    webRouter.post(
      '/internal/project/:project_id/agent/delete-file',
      requirePrivateApiAuth(),
      LlmAgentController.agentDeleteFile
    )
    webRouter.post(
      '/internal/project/:project_id/agent/move-file',
      requirePrivateApiAuth(),
      LlmAgentController.agentMoveFile
    )
    webRouter.post(
      '/internal/project/:project_id/agent/compile',
      requirePrivateApiAuth(),
      LlmAgentController.internalCompile
    )
    webRouter.get(
      '/internal/project/:project_id/agent/pdf-page',
      requirePrivateApiAuth(),
      LlmAgentController.agentPdfPage
    )
    webRouter.get(
      '/internal/project/:project_id/agent/syntax-check',
      requirePrivateApiAuth(),
      LlmAgentController.agentSyntaxCheck
    )
    webRouter.post(
      '/internal/agent/create-project',
      requirePrivateApiAuth(),
      LlmAgentController.agentCreateProject
    )
  },
}
