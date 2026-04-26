// @ts-check

import Metrics from '@overleaf/metrics'
import Settings from '@overleaf/settings'
import MongoUtils from '@overleaf/mongo-utils'
import { MongoClient, ObjectId } from 'mongodb'

export { ObjectId }

export const mongoClient = new MongoClient(
  Settings.mongo.url,
  Settings.mongo.options
)
const mongoDb = mongoClient.db()

export const db = {
  agentRuns: mongoDb.collection('agent_runs'),
}

Metrics.mongodb.monitor(mongoClient)

export async function cleanupTestDatabase() {
  await MongoUtils.cleanupTestDatabase(mongoClient)
}
