// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// DEV LOOP — Auto-restart wrapper for Next.js dev server
// Use `pnpm dev:loop` instead of `pnpm dev` when operating on the Oasis
// from within (Anorak agent / Claude Code). The restart API endpoint
// calls process.exit(0) and this wrapper brings the server back up.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

const { spawn } = require('child_process')

const PORT = 4516
const RESTART_DELAY_MS = 2000

function start() {
  console.log(`\n\x1b[35m╔══════════════════════════════════════╗\x1b[0m`)
  console.log(`\x1b[35m║  ॐ  Oasis dev server starting...     ║\x1b[0m`)
  console.log(`\x1b[35m║  Port ${PORT} · Auto-restart enabled    ║\x1b[0m`)
  console.log(`\x1b[35m╚══════════════════════════════════════╝\x1b[0m\n`)

  const child = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    stdio: 'inherit',
    shell: true,
    cwd: process.cwd(),
  })

  child.on('close', (code) => {
    if (code === null || code === 0) {
      console.log(`\n\x1b[33m[dev-loop] Server stopped (code ${code}). Restarting in ${RESTART_DELAY_MS / 1000}s...\x1b[0m\n`)
      setTimeout(start, RESTART_DELAY_MS)
    } else {
      console.error(`\n\x1b[31m[dev-loop] Server crashed (code ${code}). Restarting in ${RESTART_DELAY_MS / 1000}s...\x1b[0m\n`)
      setTimeout(start, RESTART_DELAY_MS)
    }
  })

  // Forward SIGINT (Ctrl+C) to actually stop the loop
  process.on('SIGINT', () => {
    console.log('\n\x1b[35m[dev-loop] Ctrl+C — shutting down.\x1b[0m')
    child.kill('SIGINT')
    process.exit(0)
  })
}

start()
