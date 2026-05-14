// @ts-check

import { TEST_PORT } from './AgentApp.js'

const BASE_URL = `http://127.0.0.1:${TEST_PORT}`

async function request(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
  }
  const response = await fetch(`${BASE_URL}${path}`, opts)
  let parsed
  try {
    parsed = await response.json()
  } catch {
    parsed = null
  }
  return { status: response.status, body: parsed }
}

export async function health() {
  const response = await fetch(`${BASE_URL}/health`)
  return { status: response.status }
}

export async function startRun(projectId, payload) {
  return await request('POST', `/project/${projectId}/run`, payload)
}
