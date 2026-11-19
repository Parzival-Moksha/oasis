#!/usr/bin/env node
// Starts the Oasis on Windows, macOS and Linux: the page server and the agent engine, then the village in
// the browser. One file, no shell needed.
//
//   node scripts/oasis.mjs start [--session <id>]   set up if needed, start what is not running, open the village
//   node scripts/oasis.mjs setup                    install packages, make the database, build (first run)
//   node scripts/oasis.mjs status                   what is running
//   node scripts/oasis.mjs stop                     stop what `start` started (never anything else)
//
// Either server that is already listening is left alone, so running it twice is harmless.
//
// Settings (environment):
//   OASIS_WEB_PORT   the page server's port (default 4516)
//   OASIS_PORT       the agent engine's port (default 4530)
//   OASIS_NO_OPEN=1  do not open the browser
//   OASIS_REQUIRE_TOKEN  1: both servers ask for the local key (always so in the slim edition); 0: never
//   OASIS_TOKEN_FILE     where the key is kept (default ~/.oasis/token)
//   OASIS_PNPM       the pnpm command to use (default: pnpm, else corepack's, else `npx pnpm@<pinned>`)
//
// Two editions run from this one file:
//   - the workshop (a full checkout): `next dev`, exactly what `pnpm dev` + `pnpm dev:engine` do;
//   - the slim Oasis (a cut made by scripts/cut-slim.mjs, marked by a `.oasis-slim` file): built once with
//     `next build`, then `next start`.
// Exit codes: 0 fine, 3 the page server did not come up in time, 6 setup failed.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB_PORT = Number(process.env.OASIS_WEB_PORT || 4516)
const ENGINE_PORT = Number(process.env.OASIS_PORT || 4530)
const SLIM = fs.existsSync(path.join(HOME, '.oasis-slim'))
const PNPM_VERSION = '10.26.0'
const LOGS = path.join(HOME, 'logs')
const RUN_FILE = path.join(HOME, 'data', 'oasis-run.local.json')
const FIRST_RUN_FILE = path.join(HOME, 'data', 'first-run.local.json')
const WAIT_MS = Number(process.env.OASIS_WAIT_MS || 150_000)
const WIN = process.platform === 'win32'

const say = (line) => process.stdout.write(`${line}\n`)
const args = process.argv.slice(2)
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '')

export function portOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (open) => { socket.destroy(); resolve(open) }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForPort(port, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true
    await sleep(500)
  }
  return false
}

/** Runs a command to the end, showing its output. `.cmd` shims on Windows need a shell; the arguments are fixed. */
function runSync(command, argv, options = {}) {
  const shell = WIN && !/\.exe$/i.test(command) && command !== process.execPath
  const res = spawnSync(command, argv, { cwd: HOME, stdio: 'inherit', windowsHide: true, shell, ...options })
  return res.status ?? 1
}

function works(command, argv) {
  const shell = WIN && !/\.exe$/i.test(command)
  return spawnSync(command, argv, { stdio: 'ignore', windowsHide: true, shell }).status === 0
}

/** pnpm as [command, ...leading args]: the one on the PATH, corepack's, or a pinned one through npx. */
function pnpm() {
  if (process.env.OASIS_PNPM) return [process.env.OASIS_PNPM]
  if (works('pnpm', ['--version'])) return ['pnpm']
  if (works('corepack', ['--version'])) return ['corepack', `pnpm@${PNPM_VERSION}`]
  return ['npx', '--yes', `pnpm@${PNPM_VERSION}`]
}

const bin = (...parts) => path.join(HOME, 'node_modules', ...parts)
const node = (script, argv, options) => runSync(process.execPath, [script, ...argv], options)

/** Where Prisma keeps the SQLite file: DATABASE_URL is relative to prisma/schema.prisma. */
export function databaseFile(envText) {
  const match = /^\s*DATABASE_URL\s*=\s*"?file:([^"\r\n]+)"?/m.exec(envText || '')
  const rel = match ? match[1].trim() : './data/oasis.db'
  return path.isAbsolute(rel) ? rel : path.join(HOME, 'prisma', rel)
}

function readEnvFile() {
  try { return fs.readFileSync(path.join(HOME, '.env'), 'utf8') } catch { return '' }
}

/** First run: packages, the .env file, the database, and (slim) the build. Each step is skipped once done. */
function setup() {
  const steps = []
  if (!fs.existsSync(bin('next', 'package.json'))) {
    say('Installing the Oasis packages (once, a minute or two) …')
    const [command, ...lead] = pnpm()
    if (runSync(command, [...lead, 'install', '--frozen-lockfile', ...(SLIM ? ['--prod=false'] : [])]) !== 0) return fail('The package install failed.')
    steps.push('packages')
  }
  if (!fs.existsSync(path.join(HOME, '.env'))) {
    const lines = ['# Written by scripts/oasis.mjs on first run. Keys are optional; add them here.', 'DATABASE_URL="file:./data/oasis.db"']
    if (SLIM) lines.push('NEXT_PUBLIC_OASIS_PROFILE=village', 'OASIS_EDITION=slim')
    fs.writeFileSync(path.join(HOME, '.env'), `${lines.join('\n')}\n`)
    steps.push('.env')
  }
  const prisma = bin('prisma', 'build', 'index.js')
  if (!fs.existsSync(bin('.prisma', 'client', 'index.js'))) {
    if (node(prisma, ['generate']) !== 0) return fail('Preparing the database client failed.')
    steps.push('database client')
  }
  // Only ever on a machine without a database: an existing one is never pushed to.
  const db = databaseFile(readEnvFile())
  if (!fs.existsSync(db)) {
    fs.mkdirSync(path.dirname(db), { recursive: true })
    if (node(prisma, ['db', 'push', '--skip-generate']) !== 0) return fail('Creating the database failed.')
    steps.push('database')
    const seed = path.join(HOME, 'scripts', 'slim', 'seed-first-world.mjs')
    if (fs.existsSync(seed) && node(seed, []) !== 0) say('The first world could not be seeded; the Oasis starts with an empty one.')
  }
  if (SLIM && !fs.existsSync(path.join(HOME, '.next', 'BUILD_ID'))) {
    say('Building the Oasis (once, a minute or two) …')
    // The build fetches its web fonts from Google; one hiccup there fails it, so it is tried twice.
    const build = () => node(bin('next', 'dist', 'bin', 'next'), ['build'], { env: { ...process.env, ...webEnv() } })
    if (build() !== 0) {
      say('The build failed; trying once more …')
      if (build() !== 0) return fail('The build failed twice. It needs the internet once (for its fonts); check the connection and start the Oasis again.')
    }
    steps.push('build')
  }
  if (steps.length) say(`Set up: ${steps.join(', ')}.`)
  return true
}

function fail(message) {
  say(message)
  return false
}

/**
 * The local key: made once, kept in a file only its owner can read. Both servers get it and then refuse
 * requests without it; the browser gets it in the address the village is opened with.
 */
const TOKEN_FILE = process.env.OASIS_TOKEN_FILE || path.join(process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis'), 'token')
const REQUIRE_TOKEN = process.env.OASIS_REQUIRE_TOKEN === '1' || (SLIM && process.env.OASIS_REQUIRE_TOKEN !== '0')

export function localToken(file = TOKEN_FILE) {
  try {
    const token = fs.readFileSync(file, 'utf8').trim()
    if (/^[A-Za-z0-9_-]{32,}$/.test(token)) return token
  } catch {
    // made below
  }
  const token = randomBytes(32).toString('base64url')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${token}
`, { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* Windows: the user's profile folder is already private */ }
  return token
}

const tokenEnv = () => (REQUIRE_TOKEN ? { OASIS_LOCAL_TOKEN: localToken(), OASIS_TOKEN_FILE: TOKEN_FILE } : {})

function webEnv() {
  const env = { OASIS_ENGINE_HTTP_URL: `http://127.0.0.1:${ENGINE_PORT}` }
  if (ENGINE_PORT !== 4530) env.NEXT_PUBLIC_AGENT_ENGINE_URL = `ws://127.0.0.1:${ENGINE_PORT}/ws`
  if (SLIM) {
    env.NEXT_PUBLIC_OASIS_PROFILE = 'village'
    env.OASIS_EDITION = 'slim'
  }
  return env
}

/** The engine does not load .env by itself: the few switches a person sets there are handed to it. */
function engineEnvFromFile() {
  const env = SLIM ? { OASIS_EDITION: 'slim' } : {}
  const text = readEnvFile()
  for (const key of ['OASIS_EARS_INSTALL', 'OASIS_LOOKS', 'OASIS_KEEP_API_KEY', 'OASIS_EDITION']) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, 'm').exec(text)
    if (match && process.env[key] === undefined) env[key] = match[1].trim()
  }
  return env
}

function readRun() {
  try { return JSON.parse(fs.readFileSync(RUN_FILE, 'utf8')) } catch { return {} }
}

function writeRun(run) {
  fs.mkdirSync(path.dirname(RUN_FILE), { recursive: true })
  fs.writeFileSync(RUN_FILE, JSON.stringify(run, null, 2))
}

function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/** Starts a server in the background, with its output in logs/<name>.log. Returns its pid. */
function startServer(name, script, argv, env) {
  fs.mkdirSync(LOGS, { recursive: true })
  const log = fs.openSync(path.join(LOGS, `${name}.log`), 'a')
  const child = spawn(process.execPath, [script, ...argv], {
    cwd: HOME,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  })
  child.unref()
  fs.closeSync(log)
  return child.pid
}

function openBrowser(url) {
  if (process.env.OASIS_NO_OPEN) return
  const [command, argv] = WIN
    ? ['cmd.exe', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    spawn(command, argv, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: WIN }).unref()
  } catch {
    // no browser opener on this machine: the URL is printed
  }
}

export function villageUrl({ session = '', firstRun = false, port = WEB_PORT, key = '' } = {}) {
  const query = new URLSearchParams({ profile: 'village' })
  if (key) query.set('key', key)
  if (session) query.set('session', session)
  if (firstRun) query.set('firstRun', '1')
  return `http://localhost:${port}/?${query}`
}

async function start() {
  if (!setup()) return 6
  const run = readRun()
  const started = []
  if (await portOpen(ENGINE_PORT)) {
    say(`The engine was already running on port ${ENGINE_PORT}.`)
  } else {
    run.engine = startServer('engine', path.join(HOME, 'packages', 'oasis-agent-engine', 'src', 'index.js'), [], {
      OASIS_PORT: String(ENGINE_PORT),
      OASIS_WEB_URL: `http://127.0.0.1:${WEB_PORT}`,
      ...engineEnvFromFile(),
      ...tokenEnv(),
    })
    started.push('engine')
  }
  if (await portOpen(WEB_PORT)) {
    say(`The world was already running on port ${WEB_PORT}.`)
  } else {
    const next = bin('next', 'dist', 'bin', 'next')
    run.web = startServer('world', next, [SLIM ? 'start' : 'dev', '-p', String(WEB_PORT), '-H', '127.0.0.1'], { ...webEnv(), ...tokenEnv() })
    started.push('world')
  }
  if (started.length) {
    writeRun(run)
    say(`Started the ${started.join(' and the ')} (logs in ${LOGS}).`)
  }
  if (!(await waitForPort(WEB_PORT, WAIT_MS))) {
    say(`The world did not answer on port ${WEB_PORT} within ${Math.round(WAIT_MS / 1000)} seconds. Look at ${path.join(LOGS, 'world.log')}.`)
    return 3
  }
  // The first time on this machine: the page is told, so a welcome can meet the newcomer (the onboarding mission).
  const firstRun = !fs.existsSync(FIRST_RUN_FILE)
  if (firstRun) {
    fs.mkdirSync(path.dirname(FIRST_RUN_FILE), { recursive: true })
    fs.writeFileSync(FIRST_RUN_FILE, JSON.stringify({ at: new Date().toISOString(), node: process.versions.node, platform: `${os.platform()} ${os.arch()}` }, null, 2))
  }
  const url = villageUrl({ session: arg('--session'), firstRun })
  // The key goes to the browser, never to the output (a log or a chat window would keep it).
  openBrowser(REQUIRE_TOKEN ? villageUrl({ session: arg('--session'), firstRun, key: localToken() }) : url)
  say(process.env.OASIS_NO_OPEN ? `The Oasis is running at ${url}` : `Opened ${url}`)
  return 0
}

async function status() {
  const [engine, web] = await Promise.all([portOpen(ENGINE_PORT), portOpen(WEB_PORT)])
  say(`Engine (port ${ENGINE_PORT}): ${engine ? 'running' : 'not running'}`)
  say(`World  (port ${WEB_PORT}): ${web ? 'running' : 'not running'}`)
  say(`Edition: ${SLIM ? 'slim' : 'workshop'}, in ${HOME}`)
  say(`Local key: ${REQUIRE_TOKEN ? 'asked for' : 'not asked for'}`)
  return 0
}

function killTree(pid) {
  if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  else {
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
  }
}

function stop() {
  const run = readRun()
  const stopped = []
  for (const name of ['web', 'engine']) {
    if (alive(run[name])) { killTree(run[name]); stopped.push(name === 'web' ? 'world' : 'engine') }
    delete run[name]
  }
  writeRun(run)
  say(stopped.length ? `Stopped the ${stopped.join(' and the ')}.` : 'Nothing that this script started is running.')
  return 0
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    say(`The Oasis needs Node.js 20 or later (this is ${process.versions.node}).`)
    return 6
  }
  const command = args[0] || 'start'
  if (command === 'start') return start()
  if (command === 'setup') return setup() ? 0 : 6
  if (command === 'status') return status()
  if (command === 'stop') return stop()
  say('Usage: node scripts/oasis.mjs start | setup | status | stop')
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code))
}
