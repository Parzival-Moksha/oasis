import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const nextConfigPath = path.resolve(__dirname, '../../../next.config.mjs')
const transcriptionRoutePath = path.resolve(__dirname, '../voice/transcription-route.ts')

describe('voice browser access wiring', () => {
  it('allows first-party camera and microphone usage in Next security headers', () => {
    const source = fs.readFileSync(nextConfigPath, 'utf-8')

    expect(source).toContain("Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()'")
  })

  it('accepts local-network style hosts for voice transcription by default', () => {
    const source = fs.readFileSync(transcriptionRoutePath, 'utf-8')

    expect(source).toContain('function isTrustedLocalNetworkHost')
    expect(source).toContain("hostname.endsWith('.local')")
    expect(source).toContain("hostname.endsWith('.ts.net')")
    expect(source).toContain('100 && b >= 64 && b <= 127')
  })
})
