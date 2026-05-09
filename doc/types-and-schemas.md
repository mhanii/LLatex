# Types & Schemas

Type definitions used across the LLM Agent system.

## Selection

Text selection anchored to a document in docstore. All fields are optional — any non-empty subset is valid.

```js
/**
 * @typedef {Object} Selection
 * @property {string} [docId]      - MongoDB ObjectId of the docstore document
 * @property {number} [fromLine]   - 0-indexed, inclusive (maps to doc.lines[fromLine])
 * @property {number} [toLine]     - 0-indexed, inclusive
 * @property {string} [content]    - resolved text (sent by frontend to avoid a docstore roundtrip)
 */
```

## ProjectContext

Snapshot of project-level context captured at run time.

```js
/**
 * @typedef {Object} ProjectContext
 * @property {string} projectName
 * @property {string} compiler
 * @property {Array<{path: string, docId: string}>} files
 */
```

## AgentInput

The payload that enters the agent loop. Assembled by the web module before calling `POST /project/:pid/run`. The agent service treats this as read-only input.

```js
/**
 * @typedef {Object} AgentInput
 * @property {string} projectId
 * @property {string} userId
 * @property {string} conversationId  - thread ID in the chat service
 * @property {string} userMessage
 * @property {Selection} [selection]
 * @property {ProjectContext} [context]
 */
```

## ContextItem

A single, individually-traceable input in the model's context window. Managed by `ContextManager`. Persisted via `$push` to `agentRuns.contextItems[]`. Replaced singletons stay in the array with `replacedBy/replacedAt` set; only items without `replacedBy` are "active".

```js
/**
 * @typedef {'system_prompt'|'current_file'|'selection'|
 *           'user_message'|'assistant_message'|
 *           'tool_call'|'tool_output'|
 *           'chat_history_message'} ContextItemKind
 *
 * @typedef {Object} ContextItem
 * @property {string} id              - uuid; stable across the run
 * @property {ContextItemKind} kind
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {{kind: string, ref?: string}} source
 * @property {string|object|null} content   - inline content; null when ref carries the data
 * @property {{path: string, docId: string}} [ref]  - reference-mode payload (current_file)
 * @property {Date} addedAt
 * @property {string} addedBy         - seed:<name> | tool:<name> | llm:assistant | user
 * @property {string} [replacedBy]    - id of the item that superseded this one
 * @property {Date}   [replacedAt]
 * @property {Object} [meta]          - {bytes, toolCallId, stepIndex, ...}
 */
```

Singleton kinds (`system_prompt`, `current_file`, `selection`) replace the prior active item instead of duplicating. All other kinds append normally.

## RunContext

Context injected into every tool execution. Keeps tools stateless — they receive everything they need here.

```js
/**
 * @typedef {Object} RunContext
 * @property {string} projectId
 * @property {string} userId
 * @property {string} runId
 * @property {ProjectContext} [context]
 */
```

## RunStep

One recorded step in the run — one LLM call or one tool execution. Steps are appended via `$push` and never rewritten.

```js
/**
 * @typedef {Object} RunStep
 * @property {string} name
 * @property {Date} startedAt
 * @property {Date} [finishedAt]
 * @property {unknown} input        - exact payload sent to the LLM or tool
 * @property {unknown} [output]     - exact response received
 * @property {StepMetadata} [metadata]
 * @property {string} [error]
 */
```

## StepMetadata

Metadata recorded for each LLM call or tool execution.

```js
/**
 * @typedef {Object} StepMetadata
 * @property {string} [model]
 * @property {number} [inputTokens]
 * @property {number} [outputTokens]
 * @property {number} latencyMs
 */
```

## AgentOutput

Final result of a completed run.

```js
/**
 * @typedef {Object} AgentOutput
 * @property {'text'|'edits'|'error'} type
 * @property {string} content               - text response or error message
 * @property {Array<EditProposal>} [edits]  - populated when type === 'edits'
 */
```

## EditProposal

A single edit proposal produced by the agent. Sent to document-updater via the agent-replace endpoint.

```js
/**
 * @typedef {Object} EditProposal
 * @property {string} docId
 * @property {string} oldText
 * @property {string} newText
 */
```

## AgentTool

Abstract tool interface. Every agent tool implements this shape.

```js
/**
 * @template TInput, TOutput
 * @typedef {Object} AgentTool
 * @property {string} name
 * @property {string} description
 * @property {Record<string, unknown>} inputSchema  - JSON Schema sent to the LLM
 * @property {(input: TInput, ctx: RunContext) => Promise<TOutput>} execute
 */
```

## ChatMessage

Message shape for LLM provider calls.

```js
/**
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {string} content
 * @property {string} [name]
 * @property {string} [toolCallId]
 */
```

## CompletionRequest / CompletionResult

Request and response shapes for the LLM provider abstraction.

```js
/**
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} description
 * @property {Record<string, unknown>} parameters  - JSON Schema
 *
 * @typedef {Object} ToolCall
 * @property {string} id
 * @property {string} name
 * @property {Record<string, unknown>} arguments
 *
 * @typedef {Object} CompletionRequest
 * @property {string} [system]
 * @property {Array<ChatMessage>} messages
 * @property {string} model
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {Array<ToolDef>} [tools]
 *
 * @typedef {Object} CompletionResult
 * @property {string} text
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {string} model
 * @property {number} latencyMs
 * @property {Array<ToolCall>} [toolCalls]
 * @property {string} [finishReason]
 * @property {string} [reasoningText]   - hidden chain-of-thought from reasoning models
 * @property {unknown} [rawResponse]
 */
```

## MongoDB Schema: agent_runs

The actual MongoDB document stored in the `agent_runs` collection:

```json
{
  "_id": ObjectId,
  "projectId": ObjectId,
  "userId": ObjectId,
  "conversationId": ObjectId,
  "createdAt": ISODate,
  "status": "running",
  "input": {
    "userMessage": "string",
    "selection": { "docId": "...", "fromLine": 0, "toLine": 5, "content": "..." },
    "context": { "projectName": "...", "compiler": "pdflatex", "files": [...] }
  },
  "contextItems": [
    {
      "id": "uuid",
      "kind": "system_prompt",
      "role": "system",
      "source": { "kind": "agent", "ref": "default" },
      "content": "You are a LaTeX editing assistant...",
      "addedAt": ISODate,
      "addedBy": "seed:system_prompt"
    }
  ],
  "steps": [
    {
      "name": "llm-call",
      "startedAt": ISODate,
      "finishedAt": ISODate,
      "input": { "messages": [...], "tools": [...] },
      "output": { "text": "...", "toolCalls": [...], "toolResults": [...] },
      "metadata": { "model": "gpt-4o", "inputTokens": 142, "outputTokens": 287, "latencyMs": 1843 }
    }
  ],
  "output": { "type": "text", "content": "..." },
  "finishedAt": ISODate,
  "durationMs": 2100,
  "error": null
}
```
