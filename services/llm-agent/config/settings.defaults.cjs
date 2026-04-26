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
}
