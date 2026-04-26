// @ts-check

import { createServer } from '../../../../app/js/server.js'
import { promisify } from 'node:util'
import { mongoClient } from '../../../../app/js/mongodb.js'

export { db } from '../../../../app/js/mongodb.js'

export const TEST_PORT = 13055

let serverPromise = null

export async function ensureRunning() {
  if (!serverPromise) {
    await mongoClient.connect()
    const { app } = createServer()
    const startServer = promisify(app.listen.bind(app))
    serverPromise = startServer(TEST_PORT, '127.0.0.1')
  }
  return serverPromise
}
