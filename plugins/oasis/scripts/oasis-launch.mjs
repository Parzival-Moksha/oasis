#!/usr/bin/env node
// The Oasis plugin's launcher, for Windows, macOS and Linux. /oasis in Claude Code runs this (hooks/register.ts).
//
// What it does, in order:
//   1. Finds the Oasis on this machine: --home, then OASIS_HOME, then the checkout this plugin folder sits in,
//      then ~/.oasis/app (where step 2 puts it).
//   2. Not there yet: downloads the slim Oasis, at the one version and checksum pinned in release.json beside
//      this file, from the Oasis's own GitHub repository, and unpacks it to ~/.oasis/app. Nothing else is
//      downloaded by this file. (The Oasis's own start script then installs its packages from its lockfile.)
//   3. Hands over to the Oasis's start script (<home>/scripts/oasis.mjs start), which starts the page server
//      and the agent engine if they are not running, and opens the village in the browser.
//
//   node oasis-launch.mjs [--session <id>] [--home <folder>] [--from <file.tar.gz>] [--no-install] [--where] [--token]
//
// --token prints the Oasis's local key (~/.oasis/token) and nothing else: the plugin's hooks send it with their
// requests to the Oasis on this machine, which refuses requests without it. It is sent nowhere else.
//
// Exit codes: 0 opened, 2 the Oasis is not installed and was not installed now, 3 it did not come up in time,
//             4 the download or its checksum failed, 5 Node is too old.
// OASIS_NO_OPEN=1: everything but the browser tab (tests).
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const arg = (name) => (has(name) ? args[args.indexOf(name) + 1] : '')
const say = (line) => process.stdout.write(`${line}\n`)

export const dataDir = () => process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis')

/** A folder is an Oasis when it has the start script and a package.json that names the engine. */
export function isOasis(dir) {
  try {
    if (!dir || !fs.existsSync(path.join(dir, 'scripts', 'oasis.mjs'))) return false
    return /"dev:engine"|"oasis:engine"/.test(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return false
  }
}

/** The owner's workshop checkout has no slim marker; on Windows it keeps its two-window launcher. */
const isWorkshop = (dir) => !fs.existsSync(path.join(dir, '.oasis-slim'))

export function findHome({ home = arg('--home'), env = process.env } = {}) {
  const candidates = [home, env.OASIS_HOME, path.resolve(HERE, '..', '..', '..'), path.join(dataDir(), 'app')]
  return candidates.find((dir) => dir && isOasis(dir)) || ''
}

export function readRelease(file = path.join(HERE, 'release.json')) {
  const release = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!/^[\w.-]+\/[\w.-]+$/.test(release.repo || '')) throw new Error('release.json: repo')
  if (!/^\d+\.\d+\.\d+$/.test(release.version || '')) throw new Error('release.json: version')
  if (!/^[\w.-]+\.tar\.gz$/.test(release.asset || '')) throw new Error('release.json: asset')
  return release
}

export const releaseUrl = (r) => `https://github.com/${r.repo}/releases/download/v${r.version}/${r.asset}`

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/** Downloads (or takes --from), checks the checksum, unpacks to ~/.oasis/app. Returns the folder. */
async function install(from) {
  const release = readRelease()
  const root = dataDir()
  fs.mkdirSync(root, { recursive: true })
  const archive = path.join(root, release.asset)
  if (from) {
    fs.copyFileSync(from, archive)
  } else {
    if (!/^[0-9a-f]{64}$/.test(release.sha256 || '')) throw new Error('This version of the plugin has no published Oasis to download yet. Install the Oasis from its repository and set OASIS_HOME to its folder.')
    say(`Downloading the Oasis ${release.version} (about 40 MB) from github.com/${release.repo} …`)
    const res = await fetch(releaseUrl(release), { redirect: 'follow' })
    if (!res.ok) throw new Error(`The download answered ${res.status}.`)
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
  }
  if (release.sha256 && sha256(archive) !== release.sha256) {
    fs.rmSync(archive, { force: true })
    throw new Error('The downloaded file does not match the checksum this plugin was published with. Nothing was installed.')
  }
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

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    say(`The Oasis needs Node.js 20 or later (this is ${process.versions.node}).`)
    return 5
  }
  if (has('--token')) {
    try { say(fs.readFileSync(process.env.OASIS_TOKEN_FILE || path.join(dataDir(), 'token'), 'utf8').trim()) } catch { /* no key: the Oasis runs without one */ }
    return 0
  }
  let home = findHome()
  if (has('--where')) {
    say(home || 'not installed')
    return home ? 0 : 2
  }
  if (!home) {
    if (has('--no-install')) {
      say('The Oasis is not installed on this machine. /oasis installs it (about 40 MB, then its packages).')
      return 2
    }
    try {
      home = await install(arg('--from'))
      say(`Installed the Oasis in ${home}.`)
    } catch (error) {
      say(String(error?.message || error))
      return 4
    }
  }
  const session = arg('--session')
  // The workshop on Windows keeps the launcher its owner knows: two titled windows, one per server.
  const ps1 = path.join(HERE, 'oasis-launch.ps1')
  if (process.platform === 'win32' && isWorkshop(home) && fs.existsSync(ps1)) {
    const url = `http://localhost:4516/?profile=village${session ? `&session=${encodeURIComponent(session)}` : ''}`
    return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Url', url, '-OasisHome', home])
  }
  return run(process.execPath, [path.join(home, 'scripts', 'oasis.mjs'), 'start', ...(session ? ['--session', session] : [])], { cwd: home })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code))
}
