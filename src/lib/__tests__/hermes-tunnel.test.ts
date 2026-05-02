import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('../hermes-config', () => ({
  resolveHermesConfig: vi.fn().mockResolvedValue({
    apiBase: 'http://127.0.0.1:8642/v1',
    apiKey: '',
    defaultModel: '',
    systemPrompt: '',
    source: 'none',
  }),
}))

import {
  resolveRemoteOasisBaseUrlFromTunnelCommand,
  tunnelProcessMatchesCommand,
} from '../hermes-tunnel'

describe('tunnelProcessMatchesCommand', () => {
  it('accepts the real combined Oasis tunnel even when the live process uses a full ssh.exe path', () => {
    const expected = 'ssh -L 8642:127.0.0.1:8642 -R 4516:127.0.0.1:4516 art3mis@178.156.222.149 -N'
    const actual = '"C:\\Windows\\System32\\OpenSSH\\ssh.exe" -o ExitOnForwardFailure=yes -L 8642:127.0.0.1:8642 -R 4516:127.0.0.1:4516 art3mis@178.156.222.149 -N'

    expect(tunnelProcessMatchesCommand(expected, actual)).toBe(true)
  })

  it('rejects unrelated ssh forwards that happen to still be running', () => {
    const expected = 'ssh -L 8642:127.0.0.1:8642 -R 4516:127.0.0.1:4516 art3mis@178.156.222.149 -N'
    const actual = '"C:\\Windows\\System32\\OpenSSH\\ssh.exe" -L 18789:localhost:18789 art3mis@178.156.222.149'

    expect(tunnelProcessMatchesCommand(expected, actual)).toBe(false)
  })

  it('rejects ssh commands that are missing the Oasis reverse forward', () => {
    const expected = 'ssh -L 8642:127.0.0.1:8642 -R 4516:127.0.0.1:4516 art3mis@178.156.222.149 -N'
    const actual = 'ssh -o ExitOnForwardFailure=yes -L 8642:127.0.0.1:8642 art3mis@178.156.222.149 -N'

    expect(tunnelProcessMatchesCommand(expected, actual)).toBe(false)
  })

  it('matches a reattached keepalive tunnel on the non-conflicting reverse port', () => {
    const expected = 'ssh -o ExitOnForwardFailure=yes -L 8642:127.0.0.1:8642 -R 14516:127.0.0.1:4516 art3mis@178.156.222.149 -N'
    const actual = 'ssh -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 8642:127.0.0.1:8642 -R 14516:127.0.0.1:4516 art3mis@178.156.222.149 -N'

    expect(tunnelProcessMatchesCommand(expected, actual)).toBe(true)
  })
})

describe('resolveRemoteOasisBaseUrlFromTunnelCommand', () => {
  it('uses the configured remote reverse port that points back to local Oasis', () => {
    const command = 'ssh -L 8642:127.0.0.1:8642 -R 14516:127.0.0.1:4516 art3mis@178.156.222.149 -N'

    expect(resolveRemoteOasisBaseUrlFromTunnelCommand(command)).toBe('http://127.0.0.1:14516')
  })

  it('falls back to the historical 4516 reverse URL when parsing fails', () => {
    expect(resolveRemoteOasisBaseUrlFromTunnelCommand('not ssh')).toBe('http://127.0.0.1:4516')
  })
})
