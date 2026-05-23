import minimist from 'minimist'
import { fileURLToPath } from 'url'
import Settings from '@overleaf/settings'
import { db } from '../../../app/src/infrastructure/mongodb.mjs'
import UserRegistrationHandler from '../../../app/src/Features/User/UserRegistrationHandler.mjs'

const filename = fileURLToPath(import.meta.url)

const USAGE = `\
Usage: node ${filename} \\
  --email=joe@example.com \\
  --password=changeme \\
  [--admin] \\
  [--output-tokens-limit=N | -1] \\
  [--cost-usd-limit=N | -1]

Creates a new user with the given password set inline (no activation email).
Use --output-tokens-limit and --cost-usd-limit to override the defaults from
AGENT_DEFAULT_OUTPUT_TOKENS_LIMIT / AGENT_DEFAULT_COST_USD_LIMIT. A value of
-1 means unlimited.`

export default async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['email', 'password', 'output-tokens-limit', 'cost-usd-limit'],
    boolean: ['admin'],
  })

  const { email, password, admin } = argv
  if (!email || !password) {
    console.error(USAGE)
    process.exit(1)
  }

  const defaults = Settings.agentQuota?.defaults ?? {}
  const outputTokensLimit =
    argv['output-tokens-limit'] != null
      ? parseInt(argv['output-tokens-limit'], 10)
      : (defaults.outputTokensLimit ?? -1)
  const costUsdLimit =
    argv['cost-usd-limit'] != null
      ? parseFloat(argv['cost-usd-limit'])
      : (defaults.costUsdLimit ?? -1)

  if (!Number.isFinite(outputTokensLimit)) {
    console.error(`invalid --output-tokens-limit: ${argv['output-tokens-limit']}`)
    process.exit(1)
  }
  if (!Number.isFinite(costUsdLimit)) {
    console.error(`invalid --cost-usd-limit: ${argv['cost-usd-limit']}`)
    process.exit(1)
  }

  const user = await UserRegistrationHandler.promises.registerNewUser({
    email,
    password,
  })

  await db.users.updateOne(
    { _id: user._id },
    {
      $set: {
        isAdmin: Boolean(admin),
        'agentQuota.outputTokensLimit': outputTokensLimit,
        'agentQuota.outputTokensUsed': 0,
        'agentQuota.costUsdLimit': costUsdLimit,
        'agentQuota.costUsdUsed': 0,
      },
    }
  )

  const loginUrl = `${Settings.siteUrl ?? 'http://localhost'}/login`
  // Do NOT print the password. Docker captures script stdout into the
  // container log (readable indefinitely via `docker logs`), and the
  // operator already typed it on the command line.
  console.log('')
  console.log(`Created ${admin ? 'admin' : 'user'} ${email}.`)
  console.log(
    `  outputTokensLimit:  ${outputTokensLimit === -1 ? 'unlimited' : outputTokensLimit}`
  )
  console.log(
    `  costUsdLimit:       ${costUsdLimit === -1 ? 'unlimited' : '$' + costUsdLimit}`
  )
  console.log(`  login at:           ${loginUrl}`)
  console.log('')
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
