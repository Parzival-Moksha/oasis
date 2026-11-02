// Share the dev Oasis on your network, e.g. to test on a phone.
// Agent routes (Claude Code, Codex, Merlin, Anorak) are switched off in this mode
// because any device on the network could otherwise drive them. Use `pnpm dev`
// (localhost only) when you want agents.
import { spawn } from 'node:child_process'

const child = spawn('npx', ['next', 'dev', '-p', '4516', '-H', '0.0.0.0'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, OASIS_LAN: '1' },
})
child.on('exit', (code) => process.exit(code ?? 0))
