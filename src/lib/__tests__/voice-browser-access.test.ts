import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const nextConfigPath = path.resolve(__dirname, '../../../next.config.mjs')

describe('voice browser access wiring', () => {
  it('allows first-party camera and microphone usage in Next security headers', () => {
    const source = fs.readFileSync(nextConfigPath, 'utf-8')

    expect(source).toContain("Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()'")
  })
  // ░▒▓ A local-network-host helper (Tailscale/.local/RFC1918) was aspirational   ▓▒░
  // ░▒▓ dead code pruned 2026-04 — loopback-only is the deliberate posture for    ▓▒░
  // ░▒▓ the local-first git-clone audience. See carbondir/migrationspec.txt:484.  ▓▒░
})
