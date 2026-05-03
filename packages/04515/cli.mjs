import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

function normalizePairingTarget(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://openclaw.04515.xyz/pair/${raw}`
}

function quoteCommandPart(value) {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

function bridgeScriptPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'bin', '04515-bridge.mjs')
}

async function runBridge(pairingTarget, options = {}) {
  const target = normalizePairingTarget(pairingTarget)
  if (!target) {
    throw new Error('Pairing code or URL is required.')
  }

  const args = [bridgeScriptPath(), target]
  if (options.gatewayUrl) args.push(`--gateway-url=${options.gatewayUrl}`)
  if (options.relayUrl) args.push(`--relay-url=${options.relayUrl}`)
  if (options.mcpPort) args.push(`--mcp-port=${options.mcpPort}`)
  if (options.noMcpConfig) args.push('--no-mcp-config')
  if (options.noGateway) args.push('--no-gateway')

  if (options.printCommand) {
    console.log([process.execPath, ...args].map(quoteCommandPart).join(' '))
    return
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`04515 bridge exited via ${signal}`))
        return
      }
      if (code && code !== 0) {
        reject(new Error(`04515 bridge exited with code ${code}`))
        return
      }
      resolve()
    })
  })
}

export function register04515Cli({ program }) {
  const root = program
    .command('04515')
    .description('Connect OpenClaw to the hosted Oasis at openclaw.04515.xyz')
    .addHelpText('after', () => '\nDocs: https://openclaw.04515.xyz/skill.md\n')

  root
    .command('connect')
    .argument('<pairing-code-or-url>', 'Pairing code like OASIS-ABCD1234 or full pairing URL')
    .description('Pair this OpenClaw with a hosted 04515 Oasis session')
    .option('--gateway-url <url>', 'Local OpenClaw Gateway WebSocket URL')
    .option('--relay-url <url>', 'Hosted or local Oasis relay WebSocket URL')
    .option('--mcp-port <port>', 'Local bridge MCP adapter port', '17890')
    .option('--no-mcp-config', 'Do not update the OpenClaw oasis MCP server entry')
    .option('--no-gateway', 'Skip local OpenClaw Gateway and use console echo mode')
    .option('--print-command', 'Print the underlying Node command without running it')
    .action(async (pairingTarget, options) => {
      try {
        await runBridge(pairingTarget, options)
      } catch (error) {
        console.error(`[04515] ${error?.message || String(error)}`)
        process.exitCode = 1
      }
    })
}
