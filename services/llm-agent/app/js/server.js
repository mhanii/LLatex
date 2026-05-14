// @ts-check

import express from 'express'
import metrics from '@overleaf/metrics'
import logger from '@overleaf/logger'
import AgentController from './AgentController.js'

logger.initialize('llm-agent')
metrics.open_sockets.monitor()

export function createServer() {
  const app = express()

  app.use(metrics.http.monitor(logger))
  metrics.injectMetricsRoute(app)
  app.use(express.json())

  app.get('/health', (req, res) => res.sendStatus(200))

  app.post('/project/:projectId/run', async (req, res) => {
    try {
      await AgentController.startRun(req, res)
    } catch (err) {
      logger.error({ err }, 'unhandled error in AgentController.startRun')
      res.status(500).json({ error: 'internal error' })
    }
  })

  return { app }
}
