const HOSTED_ORIGIN = 'https://openclaw.04515.xyz'

function normalizePairingTarget(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.host !== 'openclaw.04515.xyz') {
      throw new Error('04515 only accepts pairing URLs on https://openclaw.04515.xyz.')
    }
    if (!/^\/(?:pair|p)\/OASIS-[A-Z0-9]+$/.test(url.pathname)) {
      throw new Error('Expected a 04515 pairing URL like https://openclaw.04515.xyz/pair/OASIS-XXXXXXXX.')
    }
    return url.toString()
  }
  return `${HOSTED_ORIGIN}/pair/${raw}`
}

async function runBridge(pairingTarget, options = {}) {
  const target = normalizePairingTarget(pairingTarget)
  if (!target) {
    throw new Error('Pairing code or URL is required.')
  }

  const args = [target]
  if (options.gatewayUrl) args.push(`--gateway-url=${options.gatewayUrl}`)
  if (options.mcpPort) args.push(`--mcp-port=${options.mcpPort}`)
  if (options.noMcpConfig) args.push('--no-mcp-config')

  globalThis.__04515BridgeArgv = args
  await import(`./bin/04515-bridge.mjs?run=${Date.now()}`)
}

export function register04515Cli({ program }) {
  const root = program
    .command('04515')
    .description('Connect OpenClaw to the hosted Oasis at openclaw.04515.xyz')
    .addHelpText('after', () => '\nDocs: https://openclaw.04515.xyz/skill.md\n')

  root
    .command('connect')
    .argument('<pairing-code-or-url>', 'Pairing code like OASIS-ABCD1234 or full 04515 pairing URL')
    .description('Pair this OpenClaw with a hosted 04515 Oasis session')
    .option('--gateway-url <url>', 'Local OpenClaw Gateway WebSocket URL')
    .option('--mcp-port <port>', 'Local bridge MCP adapter port', '17890')
    .option('--no-mcp-config', 'Do not update the OpenClaw oasis MCP server entry')
    .action(async (pairingTarget, options) => {
      try {
        await runBridge(pairingTarget, options)
      } catch (error) {
        console.error(`[04515] ${error?.message || String(error)}`)
        process.exitCode = 1
      }
    })
}
