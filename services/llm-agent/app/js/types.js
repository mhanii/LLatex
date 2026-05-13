/**
 * Text selection anchored to a document in docstore.
 * All fields are optional — any non-empty subset is valid.
 *
 * @typedef {Object} Selection
 * @property {string} [docId]      - MongoDB ObjectId of the docstore document
 * @property {number} [fromLine]   - 0-indexed, inclusive (maps to doc.lines[fromLine])
 * @property {number} [toLine]     - 0-indexed, inclusive
 * @property {string} [content]    - resolved text (sent by frontend to avoid a docstore roundtrip)
 */

/**
 * Snapshot of project-level context captured at run time.
 *
 * @typedef {Object} ProjectContext
 * @property {string} projectName
 * @property {string} compiler
 * @property {Array<{path: string, docId: string}>} files
 */

/**
 * The payload that enters the agent loop.
 * Assembled by the web module before calling POST /project/:pid/run.
 * The agent service treats this as read-only input.
 *
 * @typedef {Object} AgentInput
 * @property {string} projectId
 * @property {string} userId
 * @property {string} conversationId  - thread ID in the chat service
 * @property {string} userMessage
 * @property {Selection} [selection]
 * @property {ProjectContext} [context]
 * @property {{path: string, docId: string}} [currentFile]  - file the user has open; takes precedence over selection.docId only as a fallback
 * @property {string} [agentName]  - registry key for the requested agent prompt/tool profile
 * @property {Array<ChatHistoryMessage>} [chatHistory]  - prior turns of this conversation. When provided, the seeder uses these (with role info from the web module) instead of fetching the chat thread directly. Each entry includes a `runId` for assistant turns so the agent can replay that turn's tool calls / outputs / reasoning from the agentRuns collection.
 */

/**
 * @typedef {Object} ChatHistoryMessage
 * @property {string} id           - chat message ObjectId
 * @property {string} user_id
 * @property {string} content
 * @property {number} timestamp
 * @property {'user'|'assistant'} role
 * @property {string|null} runId   - the runId of the assistant turn that produced this message (null for user messages)
 */

/**
 * Metadata recorded for each LLM call or tool execution.
 *
 * @typedef {Object} StepMetadata
 * @property {string} [model]
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 * @property {number} latencyMs
 */

/**
 * One recorded step in the run — one LLM call or one tool execution.
 * Steps are appended via $push and never rewritten.
 *
 * @typedef {Object} RunStep
 * @property {string} name
 * @property {Date} startedAt
 * @property {Date} [finishedAt]
 * @property {unknown} input        - exact payload sent to the LLM or tool
 * @property {unknown} [output]     - exact response received
 * @property {StepMetadata} [metadata]
 * @property {string} [error]
 */

/**
 * A single edit proposal produced by the agent.
 * Sent to document-updater via the agent-replace endpoint.
 *
 * @typedef {Object} EditProposal
 * @property {string} docId
 * @property {string} oldText
 * @property {string} newText
 */

/**
 * Final result of a completed run.
 *
 * @typedef {Object} AgentOutput
 * @property {'text'|'edits'|'error'} type
 * @property {string} content               - text response or error message
 * @property {Array<EditProposal>} [edits]  - populated when type === 'edits'
 */

/**
 * Context injected into every tool execution.
 * Keeps tools stateless — they receive everything they need here.
 *
 * @typedef {Object} RunContext
 * @property {string} projectId
 * @property {string} userId
 * @property {string} runId
 * @property {string} conversationId
 * @property {ProjectContext} [context]
 * @property {(event: {toolName: string, status: 'running'|'completed'|'error', input?: unknown, error?: string}) => Promise<void>} [onToolEvent]
 */

/**
 * Abstract tool interface. Every agent tool implements this shape.
 *
 * The LLM receives `name`, `description`, and `inputSchema` during
 * function-calling to decide whether and how to invoke the tool.
 * `execute` is called server-side with the parsed arguments from the LLM.
 *
 * @template TInput, TOutput
 * @typedef {Object} AgentTool
 * @property {string} name
 * @property {string} description
 * @property {Record<string, unknown>} inputSchema  - JSON Schema sent to the LLM
 * @property {(input: TInput, ctx: RunContext) => Promise<TOutput>} execute
 */

export {}
