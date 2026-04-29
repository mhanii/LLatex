// @ts-check

import { db } from '../../../../app/js/mongodb.js'

// Wipe the agent_runs collection before each test suite so tests are isolated
before('clear agent_runs collection', async function () {
  await db.agentRuns.deleteMany({})
})
