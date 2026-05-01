#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)

function readOption(name, fallback) {
  const prefix = `--${name}=`
  const found = args.find(arg => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

const host = readOption('host', 'parzival-us')
const remoteDir = readOption('dir', '/home/art3mis/openclaw-oasis')
const branch = readOption('branch', 'main')
const reset = args.includes('--reset')
const seedWelcome = args.includes('--seed-welcome')
const skipInstall = args.includes('--skip-install')

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

const commands = [
  'set -euo pipefail',
  `cd ${shellQuote(remoteDir)}`,
  'if [ -f .env.openclaw ]; then set -a; . ./.env.openclaw; set +a; fi',
  'export OASIS_MODE=hosted',
  'export OASIS_PROFILE=hosted-openclaw',
  `git fetch origin ${shellQuote(branch)}`,
  reset
    ? `git reset --hard origin/${branch}`
    : `git pull --ff-only origin ${shellQuote(branch)}`,
  skipInstall ? 'echo "[deploy] skipping pnpm install"' : 'pnpm install --frozen-lockfile',
  'npx prisma generate',
  'pnpm build',
  seedWelcome ? 'pnpm seed:welcome-hub' : 'echo "[deploy] skipping welcome reseed"',
  'PM2=./node_modules/.bin/pm2',
  'if [ ! -x "$PM2" ]; then PM2="$(command -v pm2 || true)"; fi',
  'if [ -z "${PM2:-}" ]; then echo "[deploy] pm2 not found" >&2; exit 1; fi',
  '$PM2 reload openclaw-oasis-web --time --update-env',
  'if $PM2 describe openclaw-oasis-relay >/dev/null 2>&1; then $PM2 reload openclaw-oasis-relay --time --update-env; fi',
  '$PM2 save',
  'echo "[deploy] done"',
]

const remoteScript = commands.join('\n')
const result = spawnSync('ssh', [host, remoteScript], {
  stdio: 'inherit',
  shell: false,
})

if (result.error) {
  console.error(`[deploy] failed to run ssh: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
