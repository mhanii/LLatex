const http = require('node:http')
const https = require('node:https')

http.globalAgent.keepAlive = false
https.globalAgent.keepAlive = false

module.exports = {
  internal: {
    llmAgent: {
      host: process.env.LISTEN_ADDRESS || '127.0.0.1',
      port: 3055,
    },
  },

  mongo: {
    url:
      process.env.MONGO_CONNECTION_STRING ||
      `mongodb://${process.env.MONGO_HOST || '127.0.0.1'}/sharelatex`,
    options: {
      monitorCommands: true,
    },
  },

  apis: {
    documentUpdater: {
      url: `http://${process.env.DOCUMENT_UPDATER_HOST || '127.0.0.1'}:3003`,
    },
    chat: {
      url: `http://${process.env.CHAT_HOST || '127.0.0.1'}:3010`,
    },
    web: {
      url: `http://${process.env.WEB_HOST || '127.0.0.1'}:3000`,
    },
  },

  llm: {
    model: process.env.LLM_MODEL || 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  },

  httpAuthUser: process.env.WEB_API_USER || 'overleaf',
  httpAuthPass: process.env.WEB_API_PASSWORD || 'overleaf',
}
