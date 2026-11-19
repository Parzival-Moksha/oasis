#!/usr/bin/env node
// The Oasis's launcher, for Windows, macOS and Linux. /oasis in Claude Code runs this (hooks/register.ts);
// `npx` runs the same file from the npm package.
//
// What it does, in order:
//   1. Finds the Oasis on this machine: --home, then OASIS_HOME, then the checkout this folder sits in,
//      then ~/.oasis/app (where step 2 puts it).
//   2. Not there yet: installs it. One file is downloaded, the packaged Oasis, at the one version and checksum
//      pinned in release.json beside this file, from the Oasis's own GitHub releases, and unpacked to
//      ~/.oasis/app. The full Oasis by default (every feature and asset, about 570 MB); --lite takes the small
//      one (about 30 MB) for a quick look. Then the Oasis's own start script installs its packages from its
//      lockfile and builds it. Nothing else is downloaded by this file.
//      From /oasis this runs in the background (a mod may wait ten minutes at most): the first /oasis says that
//      the install began, each later /oasis says how far it is, and the browser opens by itself at the end.
//      From a terminal (--wait, what npx uses) it runs in front of you with its progress.
//   3. Hands over to the Oasis's start script (<home>/scripts/oasis.mjs start), which starts the page server
//      and the agent engine if they are not running, and opens the village in the browser.
//
//   node oasis-launch.mjs [--session <id>] [--home <folder>] [--lite] [--wait] [--from <file.tar.gz>]
//                         [--no-install] [--where] [--token]
//
// --token prints the Oasis's local key (~/.oasis/token) and nothing else: the plugin's hooks send it with their
// requests to the Oasis on this machine, which refuses requests without it. It is sent nowhere else.
//
// Exit codes: 0 opened, 2 not installed and not installing, 3 it did not come up in time,
//             4 the download or its checksum failed, 5 Node is too old, 7 installing in the background.
// OASIS_NO_OPEN=1: everything but the browser tab (tests).
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const arg = (name) => (has(name) ? args[args.indexOf(name) + 1] : '')
const say = (line) => process.stdout.write(`${line}\n`)
const MB = 1024 * 1024

export const dataDir = () => process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis')
const stateFile = () => path.join(dataDir(), 'install.json')
const logFile = () => path.join(dataDir(), 'install.log')

/** A folder is an Oasis when it has the start script and a package.json that names the engine. */
export function isOasis(dir) {
  try {
    if (!dir || !fs.existsSync(path.join(dir, 'scripts', 'oasis.mjs'))) return false
    return /"dev:engine"|"oasis:engine"/.test(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return false
  }
}

/** The main Oasis repository (the owner's own checkout) has no package marker; on Windows it keeps its two-window launcher. */
const isMainRepository = (dir) => !fs.existsSync(path.join(dir, '.oasis-slim'))

export function findHome({ home = arg('--home'), env = process.env } = {}) {
  const candidates = [home, env.OASIS_HOME, path.resolve(HERE, '..', '..', '..'), path.join(dataDir(), 'app')]
  return candidates.find((dir) => dir && isOasis(dir)) || ''
}

/**
 * release.json: { repo, version, editions: { full: { asset, sha256, megabytes }, lite: { … } } }.
 * (An older file with one `asset` and `sha256` at the top is read as the lite edition.)
 */
export function readRelease(file = path.join(HERE, 'release.json'), edition = 'full') {
  const release = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!/^[\w.-]+\/[\w.-]+$/.test(release.repo || '')) throw new Error('release.json: repo')
  if (!/^\d+\.\d+\.\d+$/.test(release.version || '')) throw new Error('release.json: version')
  const editions = release.editions || { lite: { asset: release.asset, sha256: release.sha256 } }
  const chosen = editions[edition] || editions.full || editions.lite
  if (!chosen || !/^[\w.-]+\.tar\.gz$/.test(chosen.asset || '')) throw new Error('release.json: asset')
  return { repo: release.repo, version: release.version, edition: editions[edition] ? edition : Object.keys(editions).find((k) => editions[k] === chosen), ...chosen }
}

export const releaseUrl = (r) => `https://github.com/${r.repo}/releases/download/v${r.version}/${r.asset}`

function sha256(file) {
  const hash = createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(4 * MB)
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (!read) break
      hash.update(buffer.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

// --- the state of an install, for whoever asks next ---------------------------------------------------------

export function readState(file = stateFile()) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeState(patch) {
  const next = { ...(readState() || {}), ...patch, at: Date.now() }
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2))
  return next
}

function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/** One plain line on a running or finished install; '' when there is none to speak of. */
export function describeState(state, now = Date.now()) {
  if (!state) return ''
  const minutes = Math.max(0, Math.round((now - (state.startedAt || now)) / 60000))
  const since = minutes ? `, ${minutes} minute${minutes === 1 ? '' : 's'} so far` : ''
  if (state.state === 'failed') return `The install stopped: ${state.error || 'see the log'} (${state.log || ''}). Type /oasis to try again.`
  if (state.state !== 'running') return ''
  if (state.step === 'download') {
    const got = Math.round((state.bytes || 0) / MB)
    const of = state.total ? ` of ${Math.round(state.total / MB)}` : ''
    return `Installing the Oasis: downloading, ${got}${of} MB${since}. The browser opens by itself when it is ready.`
  }
  const steps = { unpack: 'unpacking', setup: 'installing its packages and building (the long part, a few minutes)', start: 'starting' }
  return `Installing the Oasis: ${steps[state.step] || state.step}${since}. The browser opens by itself when it is ready.`
}

// --- install -----------------------------------------------------------------------------------------------

async function download(release, archive, progress) {
  if (!/^[0-9a-f]{64}$/.test(release.sha256 || '')) throw new Error('This version has no published Oasis to download yet. Get the Oasis from its repository and set OASIS_HOME to its folder.')
  const res = await fetch(releaseUrl(release), { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`The download answered ${res.status}.`)
  const total = Number(res.headers.get('content-length')) || 0
  const out = fs.openSync(archive, 'w')
  let bytes = 0
  let told = 0
  try {
    for await (const chunk of res.body) {
      fs.writeSync(out, chunk)
      bytes += chunk.length
      if (Date.now() - told > 1500) { told = Date.now(); progress(bytes, total) }
    }
  } finally {
    fs.closeSync(out)
  }
  progress(bytes, total)
}

/** Downloads (or takes --from), checks the checksum, unpacks to ~/.oasis/app. Returns the folder. */
async function install({ from, edition, onStep = () => {}, onBytes = () => {} }) {
  const release = readRelease(undefined, edition)
  const root = dataDir()
  fs.mkdirSync(root, { recursive: true })
  const archive = path.join(root, release.asset)
  onStep('download')
  if (from) fs.copyFileSync(from, archive)
  else await download(release, archive, onBytes)
  if (release.sha256 && sha256(archive) !== release.sha256) {
    fs.rmSync(archive, { force: true })
    throw new Error('The downloaded file does not match the checksum this version was published with. Nothing was installed.')
  }
  onStep('unpack')
  const target = path.join(root, 'app')
  const fresh = path.join(root, `app-${release.version}-${process.pid}`)
  fs.mkdirSync(fresh, { recursive: true })
  // On Windows: the system's own tar. A GNU tar from Git Bash on the PATH reads "C:" as a remote host.
  const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  const tarCommand = process.platform === 'win32' && fs.existsSync(systemTar) ? systemTar : 'tar'
  const tar = spawnSync(tarCommand, ['-xzf', archive, '-C', fresh], { stdio: 'ignore', windowsHide: true })
  if (tar.status !== 0) {
    fs.rmSync(fresh, { recursive: true, force: true })
    throw new Error('Could not unpack the download (the `tar` command failed).')
  }
  // An archive may hold its files directly or inside one top folder.
  const entries = fs.readdirSync(fresh)
  const inner = entries.length === 1 && fs.statSync(path.join(fresh, entries[0])).isDirectory() ? path.join(fresh, entries[0]) : fresh
  if (!isOasis(inner)) {
    fs.rmSync(fresh, { recursive: true, force: true })
    throw new Error('The download does not look like the Oasis.')
  }
  if (fs.existsSync(target)) fs.renameSync(target, path.join(root, `app-old-${Date.now()}`))
  fs.renameSync(inner, target)
  if (inner !== fresh) fs.rmSync(fresh, { recursive: true, force: true })
  fs.rmSync(archive, { force: true })
  return target
}

function run(command, argv, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { stdio: 'inherit', windowsHide: true, ...options })
    child.on('error', () => resolve(1))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

const startArgs = (home, session) => [path.join(home, 'scripts', 'oasis.mjs'), 'start', ...(session ? ['--session', session] : [])]

/** The whole first install, to the open browser: download, unpack, packages and build, start. */
async function installAndStart({ quiet }) {
  const edition = has('--lite') ? 'lite' : 'full'
  const session = arg('--session')
  writeState({ state: 'running', step: 'download', pid: process.pid, startedAt: Date.now(), edition, bytes: 0, total: 0, error: '', log: logFile() })
  try {
    const home = await install({
      from: arg('--from'),
      edition,
      onStep: (step) => { writeState({ step }); if (!quiet) say(step === 'download' ? 'Downloading the Oasis …' : 'Unpacking …') },
      onBytes: (bytes, total) => { writeState({ bytes, total }); if (!quiet && process.stdout.isTTY) process.stdout.write(`\r  ${Math.round(bytes / MB)}${total ? ` of ${Math.round(total / MB)}` : ''} MB `) },
    })
    if (!quiet) say(`\nInstalled the Oasis in ${home}.`)
    writeState({ step: 'setup' })
    const setup = await run(process.execPath, [path.join(home, 'scripts', 'oasis.mjs'), 'setup'], { cwd: home })
    if (setup !== 0) throw new Error('installing its packages or building failed')
    writeState({ step: 'start' })
    const code = await run(process.execPath, startArgs(home, session), { cwd: home })
    if (code !== 0) throw new Error('it was installed, but did not start')
    writeState({ state: 'done', step: 'done', home })
    return 0
  } catch (error) {
    const message = String(error?.message || error)
    writeState({ state: 'failed', error: message })
    say(message)
    return 4
  }
}

/** Starts the install as its own process, which outlives this one; its output goes to ~/.oasis/install.log. */
function installInBackground() {
  fs.mkdirSync(dataDir(), { recursive: true })
  const log = fs.openSync(logFile(), 'w')
  const pass = ['--install-worker', ...(has('--lite') ? ['--lite'] : []), ...(arg('--session') ? ['--session', arg('--session')] : []), ...(arg('--from') ? ['--from', arg('--from')] : [])]
  const child = spawn(process.execPath, [SELF, ...pass], { detached: true, windowsHide: true, stdio: ['ignore', log, log] })
  child.unref()
  fs.closeSync(log)
  writeState({ state: 'running', step: 'download', pid: child.pid, startedAt: Date.now(), edition: has('--lite') ? 'lite' : 'full', bytes: 0, total: 0, error: '', log: logFile() })
}

export async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    say(`The Oasis needs Node.js 20 or later (this is ${process.versions.node}).`)
    return 5
  }
  if (has('--token')) {
    try { say(fs.readFileSync(process.env.OASIS_TOKEN_FILE || path.join(dataDir(), 'token'), 'utf8').trim()) } catch { /* no key: the Oasis runs without one */ }
    return 0
  }
  if (has('--install-worker')) return installAndStart({ quiet: true })

  const home = findHome()
  if (has('--where')) {
    say(home || 'not installed')
    return home ? 0 : 2
  }
  if (!home) {
    const state = readState()
    const running = state?.state === 'running' && alive(state.pid)
    if (running) {
      say(describeState(state))
      return 7
    }
    if (has('--no-install')) {
      say('The Oasis is not installed on this machine. /oasis installs it.')
      return 2
    }
    if (has('--wait')) return installAndStart({ quiet: false })
    let size = ''
    try {
      const release = readRelease(undefined, has('--lite') ? 'lite' : 'full')
      size = release.megabytes ? ` (${release.megabytes} MB, then its packages and a build: about ten minutes)` : ''
    } catch {
      // said by the worker
    }
    installInBackground()
    say(`Installing the Oasis in the background${size}. The browser opens by itself when it is ready; /oasis again says how far it is.`)
    return 7
  }
  // Installed, but the first build may still be running in the background.
  const state = readState()
  if (state?.state === 'running' && alive(state.pid) && path.resolve(home) === path.resolve(dataDir(), 'app')) {
    say(describeState(state))
    return 7
  }
  const session = arg('--session')
  // The main repository on Windows keeps the launcher its owner knows: two titled windows, one per server.
  const ps1 = path.join(HERE, 'oasis-launch.ps1')
  if (process.platform === 'win32' && isMainRepository(home) && fs.existsSync(ps1)) {
    const url = `http://localhost:4516/?profile=village${session ? `&session=${encodeURIComponent(session)}` : ''}`
    return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Url', url, '-OasisHome', home])
  }
  return run(process.execPath, startArgs(home, session), { cwd: home })
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main().then((code) => process.exit(code))
}
