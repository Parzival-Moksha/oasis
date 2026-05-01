'use client'

/**
 * /relay-test - DEV ONLY scratch page for proving the relay round trip end to
 * end with a real browser tab. Mount the browser relay executor, watch its
 * status, and run `node scripts/openclaw-oasis-bridge.mjs` against the sidecar.
 *
 * Also includes a "get pairing code" button that hits POST /api/relay/pairings
 * - useful for demoing the production flow (browser shows code, user pastes it
 *   into `node scripts/openclaw-oasis-bridge.mjs <code>`).
 *
 * TODO: gate this route behind OASIS_MODE !== 'hosted' before public deploy.
 */

import { useState } from 'react'

import { useOpenclawRelayBridge } from '@/hooks/useOpenclawRelayBridge'
import { useOasisStore } from '@/store/oasisStore'

const STATUS_COLOR: Record<string, string> = {
  idle:         '#888',
  connecting:   '#d4a017',
  connected:    '#0aa3d6',
  paired:       '#3acb7c',
  reconnecting: '#d4a017',
  closed:       '#888',
  error:        '#e35d5d',
}

interface PairingResult {
  code: string
  expiresAt: number
  scopes: string[]
}

export default function RelayTestPage() {
  const activeWorldId = useOasisStore(state => state.activeWorldId)
  const [enabled, setEnabled] = useState(false)
  const [pairing, setPairing] = useState<PairingResult | null>(null)
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)

  const state = useOpenclawRelayBridge({
    enabled,
    worldId: activeWorldId || '__active__',
  })

  async function requestPairing() {
    setPairingBusy(true)
    setPairingError(null)
    try {
      // Make sure the cookie exists first.
      await fetch('/api/session/init', { credentials: 'same-origin' })
      const response = await fetch('/api/relay/pairings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(activeWorldId ? { worldId: activeWorldId } : {}),
      })
      const json = await response.json().catch(() => null) as
        | { ok: true; code: string; expiresAt: number; scopes: string[] }
        | { ok: false; error: { code: string; message: string } }
        | null
      if (!json) { setPairingError('non-JSON response'); return }
      if (!json.ok) { setPairingError(`${json.error.code}: ${json.error.message}`); return }
      setPairing({ code: json.code, expiresAt: json.expiresAt, scopes: json.scopes })
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : String(err))
    } finally {
      setPairingBusy(false)
    }
  }

  const expiresInS = pairing ? Math.max(0, Math.round((pairing.expiresAt - Date.now()) / 1000)) : 0

  return (
    <main style={{
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      maxWidth: 720,
      margin: '40px auto',
      padding: 24,
      color: '#e6e6e6',
      background: '#111',
      minHeight: '100vh',
    }}>
      <h1 style={{ fontSize: 18, marginBottom: 16 }}>relay switchboard - dev probe</h1>

      <p style={{ opacity: 0.8, lineHeight: 1.6 }}>
        Toggle <code>enabled</code> to open a WSS connection to the dev sidecar
        at <code>ws://localhost:4517/?role=browser</code>. Then run the
        OpenClaw bridge process in another terminal. The process exposes a
        local MCP adapter, sends <code>tool.call get_world_info</code> through
        the relay switchboard, and this browser page executes it via{' '}
        <code>/api/relay/execute</code>. Counters below increment per call.
      </p>

      <button
        onClick={() => setEnabled(v => !v)}
        style={{
          background: enabled ? '#3acb7c' : '#222',
          color: enabled ? '#0a0a0a' : '#e6e6e6',
          border: '1px solid #444',
          padding: '8px 16px',
          fontFamily: 'inherit',
          fontWeight: 600,
          cursor: 'pointer',
          marginTop: 12,
        }}
      >
        {enabled ? 'disable relay' : 'enable relay'}
      </button>

      <dl style={{
        marginTop: 24,
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        rowGap: 6,
        columnGap: 12,
      }}>
        <dt style={{ opacity: 0.6 }}>status</dt>
        <dd style={{
          margin: 0,
          color: STATUS_COLOR[state.status] ?? '#e6e6e6',
          fontWeight: 600,
        }}>{state.status}</dd>

        <dt style={{ opacity: 0.6 }}>relaySessionId</dt>
        <dd style={{ margin: 0 }}>{state.relaySessionId ?? '—'}</dd>

        <dt style={{ opacity: 0.6 }}>worldId</dt>
        <dd style={{ margin: 0 }}>{activeWorldId || '—'}</dd>

        <dt style={{ opacity: 0.6 }}>inFlightCalls</dt>
        <dd style={{ margin: 0 }}>{state.inFlightCalls}</dd>

        <dt style={{ opacity: 0.6 }}>totalCalls</dt>
        <dd style={{ margin: 0 }}>{state.totalCalls}</dd>

        <dt style={{ opacity: 0.6 }}>droppedCalls</dt>
        <dd style={{ margin: 0, color: state.droppedCalls ? '#e35d5d' : '#888' }}>
          {state.droppedCalls}
        </dd>

        <dt style={{ opacity: 0.6 }}>lastError</dt>
        <dd style={{ margin: 0, color: state.lastError ? '#e35d5d' : '#888' }}>
          {state.lastError ?? '—'}
        </dd>
      </dl>

      <hr style={{ marginTop: 32, marginBottom: 24, border: 0, borderTop: '1px solid #333' }} />

      <h2 style={{ fontSize: 14, marginBottom: 8 }}>pair an OpenClaw bridge process</h2>
      <p style={{ opacity: 0.7, fontSize: 13, lineHeight: 1.6 }}>
        Mints a code via <code>POST /api/relay/pairings</code>. Use this on
        production to demo the OpenClaw-side process flow.
      </p>

      <button
        onClick={requestPairing}
        disabled={pairingBusy}
        style={{
          background: '#222',
          color: '#e6e6e6',
          border: '1px solid #444',
          padding: '8px 16px',
          fontFamily: 'inherit',
          fontWeight: 600,
          cursor: pairingBusy ? 'wait' : 'pointer',
          marginTop: 4,
          opacity: pairingBusy ? 0.6 : 1,
        }}
      >
        {pairingBusy ? 'requesting…' : 'get pairing code'}
      </button>

      {pairingError && (
        <p style={{ marginTop: 12, color: '#e35d5d', fontSize: 13 }}>error: {pairingError}</p>
      )}

      {pairing && (
        <div style={{ marginTop: 16, padding: 12, background: '#1a1a1a', border: '1px solid #333' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#3acb7c', letterSpacing: 1 }}>
            {pairing.code}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            expires in ~{expiresInS}s · scopes: {pairing.scopes.join(', ')}
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 12, fontFamily: 'inherit' }}>
            on the OpenClaw host, run:
          </div>
          <pre style={{ marginTop: 4, padding: 8, background: '#0a0a0a', fontSize: 12, overflow: 'auto' }}>
{`node scripts/openclaw-oasis-bridge.mjs ${pairing.code}`}
          </pre>
        </div>
      )}

      <p style={{ marginTop: 32, fontSize: 12, opacity: 0.5 }}>
        sidecar log: terminal running <code>node scripts/openclaw-relay-dev.mjs</code> (or <code>openclaw-relay.mjs</code> for hosted)
        <br />
        bridge-process log: terminal running <code>node scripts/openclaw-oasis-bridge.mjs</code>
      </p>
    </main>
  )
}
