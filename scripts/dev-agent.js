// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// DEV AGENT — Blue-Green production server for autonomous Anorak sessions
// Zero-downtime rebuilds. Server NEVER reads from a half-built directory.
//
// Architecture:
//   1. pnpm start serves from .next/ (stable, never touched during rebuild)
//   2. On file change (debounced 5s): build to .next-staging/
//   3. If build succeeds: swap dirs, kill old server, start new one (~2s)
//   4. If build fails: keep old server running, log error
//
// Use: pnpm dev:agent
// For: Autonomous Anorak sessions where stability > HMR speed
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

const { spawn, execSync } = require('child_process')
const { watch, existsSync, rmSync, renameSync, mkdirSync } = require('fs')
const { join } = require('path')

const PORT = 4516
const ROOT = process.cwd()
const NEXT_DIR = join(ROOT, '.next')
const STAGING_DIR = join(ROOT, '.next-staging')
const OLD_DIR = join(ROOT, '.next-old')
const HEALTH_URL = `http://localhost:${PORT}/api/health`
const DEBOUNCE_MS = 5000
const HEALTH_POLL_MS = 10000

let serverProcess = null
let buildTimer = null
let building = false

// ═══════════════════════════════════════════════════════════════════════════
// SERVER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

function startServer() {
  log('🟢', 'Starting production server...')
  serverProcess = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    stdio: 'inherit',
    shell: true,
    cwd: ROOT,
  })

  serverProcess.on('close', (code) => {
    log('🔴', `Server exited (code ${code})`)
    serverProcess = null
  })

  return serverProcess
}

function killServer() {
  return new Promise((resolve) => {
    if (!serverProcess) { resolve(); return }
    log('🟡', 'Killing server...')
    const proc = serverProcess
    serverProcess = null

    // On Windows, SIGTERM is unreliable. Use taskkill for the process tree.
    if (process.platform === 'win32' && proc.pid) {
      try {
        execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' })
      } catch { /* already dead */ }
    } else {
      proc.kill('SIGTERM')
    }

    // Wait for process to actually exit (release file handles)
    proc.on('close', () => resolve())
    // Safety timeout — don't hang forever
    setTimeout(resolve, 5000)
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// BLUE-GREEN BUILD + SWAP
// ═══════════════════════════════════════════════════════════════════════════

function triggerBuild() {
  if (building) {
    log('⏳', 'Build already in progress, skipping')
    return
  }
  building = true
  log('🔨', 'Building to staging directory...')

  // Clean staging dir
  if (existsSync(STAGING_DIR)) rmSync(STAGING_DIR, { recursive: true, force: true })

  const buildProcess = spawn('npx', ['next', 'build'], {
    stdio: 'inherit',
    shell: true,
    cwd: ROOT,
    env: { ...process.env, NEXT_DIST_DIR: '.next-staging' },
  })

  buildProcess.on('close', async (code) => {
    building = false
    if (code !== 0) {
      log('❌', `Build FAILED (code ${code}). Old server stays up.`)
      if (existsSync(STAGING_DIR)) rmSync(STAGING_DIR, { recursive: true, force: true })
      return
    }

    log('✅', 'Build succeeded. Swapping...')
    await swapAndRestart()
  })
}

async function swapAndRestart() {
  try {
    // Kill old server first and WAIT for file handles to release
    await killServer()
    // Extra pause for Windows to release file locks
    await new Promise(r => setTimeout(r, 1000))

    // Atomic swap: .next → .next-old, .next-staging → .next
    if (existsSync(OLD_DIR)) rmSync(OLD_DIR, { recursive: true, force: true })
    if (existsSync(NEXT_DIR)) renameSync(NEXT_DIR, OLD_DIR)
    renameSync(STAGING_DIR, NEXT_DIR)

    // Start new server
    startServer()

    // Cleanup old
    setTimeout(() => {
      if (existsSync(OLD_DIR)) rmSync(OLD_DIR, { recursive: true, force: true })
    }, 5000)

    log('🔄', 'Swap complete. New server starting.')
  } catch (err) {
    log('❌', `Swap failed: ${err.message}`)
    // Try to recover
    if (!existsSync(NEXT_DIR) && existsSync(OLD_DIR)) {
      renameSync(OLD_DIR, NEXT_DIR)
    }
    startServer()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE WATCHER (debounced)
// ═══════════════════════════════════════════════════════════════════════════

function startWatcher() {
  const watchDirs = ['src', 'prisma', 'public'].map(d => join(ROOT, d))
  const ignorePatterns = [/node_modules/, /\.next/, /\.git/, /test-screenshots/]
  const ignoreExtensions = ['.db', '.db-shm', '.db-wal', '.db-journal', '.test.ts', '.test.tsx', '.map']

  for (const dir of watchDirs) {
    if (!existsSync(dir)) continue
    watch(dir, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      if (ignorePatterns.some(p => p.test(filename))) return
      if (ignoreExtensions.some(ext => filename.endsWith(ext))) return
      // Only rebuild for source code changes
      if (!filename.match(/\.(ts|tsx|js|jsx|mjs|css|json|prisma|md)$/)) return

      // Debounce: batch Anorak's multi-file writes
      if (buildTimer) clearTimeout(buildTimer)
      buildTimer = setTimeout(() => {
        log('📝', `File changed: ${filename}. Rebuilding in ${DEBOUNCE_MS / 1000}s...`)
        triggerBuild()
      }, DEBOUNCE_MS)
    })
  }
  log('👁', `Watching src/, prisma/, public/ for changes`)
}

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH POLL — detect zombie server (alive but 500)
// ═══════════════════════════════════════════════════════════════════════════

function startHealthPoll() {
  setInterval(async () => {
    if (!serverProcess || building) return
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        if (text.includes('Cannot find module') || text.includes('ENOENT')) {
          log('💀', 'Zombie server detected (cache corruption). Rebuilding...')
          triggerBuild()
        }
      }
    } catch {
      // Server might be restarting, that's fine
    }
  }, HEALTH_POLL_MS)
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════════════

function log(icon, msg) {
  const time = new Date().toLocaleTimeString()
  console.log(`\x1b[36m[dev-agent ${time}]\x1b[0m ${icon} ${msg}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\n\x1b[36m╔══════════════════════════════════════════╗\x1b[0m`)
console.log(`\x1b[36m║  ॐ  Oasis Agent Mode (Blue-Green)        ║\x1b[0m`)
console.log(`\x1b[36m║  Port ${PORT} · Zero-downtime rebuilds      ║\x1b[0m`)
console.log(`\x1b[36m║  For autonomous Anorak sessions           ║\x1b[0m`)
console.log(`\x1b[36m╚══════════════════════════════════════════╝\x1b[0m\n`)

// Initial build (always clean — stale .next is the #1 crash cause)
log('🔨', 'Running clean initial build...')
if (existsSync(NEXT_DIR)) {
  rmSync(NEXT_DIR, { recursive: true, force: true })
  log('🧹', 'Removed stale .next/')
}
try {
  execSync('npx next build', { stdio: 'inherit', cwd: ROOT })
} catch {
  log('❌', 'Initial build failed. Fix errors and retry.')
  process.exit(1)
}

startServer()
startWatcher()
startHealthPoll()

// Graceful shutdown
process.on('SIGINT', () => {
  log('👋', 'Shutting down...')
  killServer()
  if (buildTimer) clearTimeout(buildTimer)
  process.exit(0)
})

process.on('SIGTERM', () => {
  killServer()
  process.exit(0)
})
