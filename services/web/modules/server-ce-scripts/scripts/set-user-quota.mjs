import minimist from 'minimist'
import { fileURLToPath } from 'url'
import { db } from '../../../app/src/infrastructure/mongodb.mjs'

const filename = fileURLToPath(import.meta.url)

const USAGE = `\
Usage: node ${filename} --email=joe@example.com \\
  [--output-tokens-limit=N | -1] \\
  [--cost-usd-limit=N | -1] \\
  [--reset]

Adjusts a user's agentQuota fields. Pass no quota flags and no --reset to
print the user's current quota. --reset zeroes outputTokensUsed and
costUsdUsed. -1 means unlimited.`

export default async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['email', 'output-tokens-limit', 'cost-usd-limit'],
    boolean: ['reset'],
  })

  const { email, reset } = argv
  if (!email) {
    console.error(USAGE)
    process.exit(1)
  }

  const user = await db.users.findOne(
    { email },
    { projection: { _id: 1, email: 1, agentQuota: 1 } }
  )
  if (!user) {
    console.error(`no user with email ${email}`)
    process.exit(1)
  }

  const set = {}
  if (argv['output-tokens-limit'] != null) {
    const v = parseInt(argv['output-tokens-limit'], 10)
    if (!Number.isFinite(v)) {
      console.error(`invalid --output-tokens-limit: ${argv['output-tokens-limit']}`)
      process.exit(1)
    }
    set['agentQuota.outputTokensLimit'] = v
  }
  if (argv['cost-usd-limit'] != null) {
    const v = parseFloat(argv['cost-usd-limit'])
    if (!Number.isFinite(v)) {
      console.error(`invalid --cost-usd-limit: ${argv['cost-usd-limit']}`)
      process.exit(1)
    }
    set['agentQuota.costUsdLimit'] = v
  }
  if (reset) {
    set['agentQuota.outputTokensUsed'] = 0
    set['agentQuota.costUsdUsed'] = 0
  }

  if (Object.keys(set).length > 0) {
    await db.users.updateOne({ _id: user._id }, { $set: set })
  }

  const after = await db.users.findOne(
    { _id: user._id },
    { projection: { email: 1, agentQuota: 1 } }
  )
  const q = after?.agentQuota ?? {}
  console.log(`${after.email}:`)
  console.log(
    `  outputTokens:  ${q.outputTokensUsed ?? 0} / ${q.outputTokensLimit === -1 ? 'unlimited' : (q.outputTokensLimit ?? '-')}`
  )
  console.log(
    `  costUsd:       $${q.costUsdUsed ?? 0} / ${q.costUsdLimit === -1 ? 'unlimited' : '$' + (q.costUsdLimit ?? '-')}`
  )
}

if (filename === process.argv[1]) {
  try {
    await main()
    process.exit(0)
  } catch (error) {
    console.error({ error })
    process.exit(1)
  }
}
