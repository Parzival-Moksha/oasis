// ░▒▓ CONNECTION WATCH — which of the Oasis's own processes is down, in words ▓▒░
// The owner wants a red warning that stays while something they run is offline (2026-11-17): the Oasis server
// (pnpm dev, this page's server), the agent engine (pnpm dev:engine, the village's agents) and the relay
// (pnpm dev:relay, the Hermes / OpenClaw bridges). Pure: ConnectionWarning.tsx feeds it what it sees.

import type { EngineConnectionStatus } from '../store/slices/agentEngineSlice'

/** The engine may take this long to connect (first load, a restart) before it counts as down. */
export const ENGINE_GRACE_MS = 8_000
/** Failed /api/health checks in a row before the Oasis server counts as down (one can be a hiccup). */
export const SERVER_FAILS_DOWN = 2

export interface WatchInput {
  now: number
  /** The agent engine connection; null where this page doesn't use one (status 'disabled'). */
  engine: { status: EngineConnectionStatus; since: number; nextRetryAt: number | null; error: string | null } | null
  /** Failed health checks in a row. */
  serverFailures: number
  /**
   * The relay: running now (null: not known, e.g. while the server is down), and whether it ran at some point
   * since this page loaded. It is optional locally, so it only counts as down once it was seen up.
   */
  relay: { running: boolean | null; seen: boolean } | null
  /** The engine answered "unknown command" since it last connected: it runs older code than this page. */
  engineOutdated?: boolean
}

export type WarningId = 'oasis' | 'engine' | 'engine-old' | 'relay'

export interface ConnectionWarningLine {
  id: WarningId
  title: string
  detail: string
  action?: 'retry-engine' | 'start-relay'
}

export function connectionWarnings(input: WatchInput): ConnectionWarningLine[] {
  const out: ConnectionWarningLine[] = []
  const serverDown = input.serverFailures >= SERVER_FAILS_DOWN
  if (serverDown) {
    out.push({ id: 'oasis', title: 'Oasis server offline', detail: 'Nothing saves or loads until it is back. Run pnpm dev.' })
  }
  const engine = input.engine
  if (engine && engine.status !== 'disabled' && engine.status !== 'open' && input.now - engine.since >= ENGINE_GRACE_MS) {
    const retryIn = engine.nextRetryAt ? Math.max(0, Math.ceil((engine.nextRetryAt - input.now) / 1000)) : null
    out.push({
      id: 'engine',
      title: 'Agent engine offline',
      detail: `Your agents can't hear you. Run pnpm dev:engine${retryIn !== null ? ` · retry in ${retryIn}s` : ''}.`,
      action: 'retry-engine',
    })
  }
  if (input.engineOutdated && engine?.status === 'open') {
    out.push({ id: 'engine-old', title: 'Agent engine is older than this page', detail: 'Restart it: close the ENGINE window, double-click the OASIS shortcut.' })
  }
  if (!serverDown && input.relay?.seen && input.relay.running === false) {
    out.push({ id: 'relay', title: 'Relay offline', detail: 'Hermes and OpenClaw bridges are cut off. Run pnpm dev:relay.', action: 'start-relay' })
  }
  return out
}
