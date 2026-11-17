'use client'

// ░▒▓ CONNECTION WARNING — a red card at the top while one of the Oasis's processes is offline ▓▒░
// Stays as long as it is down, goes away by itself when it is back (lib/connection-watch.ts decides):
// - the Oasis server: /api/health every 10 s;
// - the agent engine: its WebSocket (only where this page uses one), with a Retry button;
// - the relay (local only): through /api/relay/local-dev every 15 s, once it was seen running, with Start.
// It replaces the old Village bar's engine pill. An engine restart it reports is said once, as a notice.

import { useEffect, useRef, useState } from 'react'

import { useOasisStore } from '../../store/oasisStore'
import { ENGINE_OUTDATED_EVENT, getAgentEngineClient } from '../../lib/agent-engine-client'
import { connectionWarnings, type ConnectionWarningLine } from '../../lib/connection-watch'
import { showNotice } from './GlobalNotice'

const HEALTH_EVERY_MS = 10_000
const RELAY_EVERY_MS = 15_000
const CHECK_TIMEOUT_MS = 4_000

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const abort = new AbortController()
  const timer = window.setTimeout(() => abort.abort(), CHECK_TIMEOUT_MS)
  try {
    return await fetch(url, { cache: 'no-store', ...init, signal: abort.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

/** Runs `check` now and every `everyMs` while the tab is visible (and at once when it comes back). */
function usePoll(check: () => void | Promise<void>, everyMs: number, enabled: boolean) {
  const latest = useRef(check)
  latest.current = check
  useEffect(() => {
    if (!enabled) return
    let timer = 0
    const run = () => {
      if (document.visibilityState === 'visible') void latest.current()
      timer = window.setTimeout(run, everyMs)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void latest.current() }
    run()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [everyMs, enabled])
}

export function ConnectionWarning({ local }: { local: boolean }) {
  const connection = useOasisStore(s => s.agentEngine.connection)
  const [serverFailures, setServerFailures] = useState(0)
  const [relay, setRelay] = useState<{ running: boolean | null; seen: boolean }>({ running: null, seen: false })
  const [startingRelay, setStartingRelay] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // The engine said "unknown command" (older than this page): until it connects again (a restart).
  const [outdatedAt, setOutdatedAt] = useState<number | null>(null)
  useEffect(() => {
    const onOutdated = () => setOutdatedAt(useOasisStore.getState().agentEngine.connection.connectedAt ?? 0)
    window.addEventListener(ENGINE_OUTDATED_EVENT, onOutdated)
    return () => window.removeEventListener(ENGINE_OUTDATED_EVENT, onOutdated)
  }, [])
  const engineOutdated = outdatedAt !== null && outdatedAt === (connection.connectedAt ?? 0)

  // Since when the engine has not been connected (the grace period counts from there). Not from its last status
  // change: while it is down it flips between connecting and offline on every retry.
  const engineDownSince = useRef<number | null>(null)
  if (connection.status === 'open' || connection.status === 'disabled') engineDownSince.current = null
  else engineDownSince.current ??= Date.now()

  usePoll(async () => {
    try {
      const res = await fetchWithTimeout('/api/health')
      setServerFailures(res.ok ? 0 : n => n + 1)
    } catch {
      setServerFailures(n => n + 1)
    }
  }, HEALTH_EVERY_MS, true)

  usePoll(async () => {
    try {
      const res = await fetchWithTimeout('/api/relay/local-dev')
      if (!res.ok) return setRelay(r => ({ ...r, running: null }))
      const body = await res.json() as { running?: boolean }
      setRelay(r => ({ running: body.running === true, seen: r.seen || body.running === true }))
    } catch {
      setRelay(r => ({ ...r, running: null }))
    }
  }, RELAY_EVERY_MS, local)

  // A clock for the grace period and the retry countdown, only while the engine isn't connected.
  const engineWaiting = connection.status === 'connecting' || connection.status === 'offline'
  useEffect(() => {
    if (!engineWaiting) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [engineWaiting])

  // An engine restart, said once (it used to sit in the Village bar's engine pill).
  const restart = connection.status === 'open' ? connection.server?.restart || null : null
  useEffect(() => {
    if (!restart?.line || Date.now() - restart.startedAt > 30 * 60_000) return
    const key = `oasis.engine.restartSaid.${restart.startedAt}`
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch { /* storage blocked: say it anyway */ }
    const names = restart.resumed?.length ? ` Told to carry on: ${restart.resumed.map(a => a.name).join(', ')}.` : ''
    showNotice(`Agent engine ${restart.line}.${names}`, restart.stop?.planned === false ? 'warn' : 'info')
  }, [restart])

  const lines = connectionWarnings({
    now: Math.max(now, engineDownSince.current ?? 0),
    engine: { status: connection.status, since: engineDownSince.current ?? now, nextRetryAt: connection.nextRetryAt, error: connection.error },
    serverFailures,
    relay: local ? relay : null,
    engineOutdated,
  })
  if (!lines.length) return null

  const startRelay = async () => {
    setStartingRelay(true)
    try {
      const res = await fetchWithTimeout('/api/relay/local-dev', { method: 'POST' }).catch(() => null)
      const body = res ? await res.json().catch(() => null) as { running?: boolean; error?: string } | null : null
      if (body?.running) setRelay({ running: true, seen: true })
      else showNotice(`The relay did not start${body?.error ? `: ${body.error}` : ''}. Run pnpm dev:relay.`, 'error')
    } finally {
      setStartingRelay(false)
    }
  }

  const button = (line: ConnectionWarningLine) => {
    if (line.action === 'retry-engine') {
      return <button type="button" data-part="retry" className="shrink-0 rounded-md border border-red-200/40 bg-red-200/15 px-2 py-0.5 text-[11px] font-bold hover:bg-red-200/30" onClick={() => getAgentEngineClient().retryNow()}>Retry</button>
    }
    if (line.action === 'start-relay') {
      return <button type="button" data-part="start" disabled={startingRelay} className="shrink-0 rounded-md border border-red-200/40 bg-red-200/15 px-2 py-0.5 text-[11px] font-bold hover:bg-red-200/30 disabled:opacity-50" onClick={() => void startRelay()}>{startingRelay ? 'Starting…' : 'Start'}</button>
    }
    return null
  }

  return (
    <div data-connection-warning className="pointer-events-none fixed left-1/2 top-3 z-[185] flex w-max max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col gap-1.5" role="alert">
      {lines.map(line => (
        <div
          key={line.id}
          data-warning={line.id}
          className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-red-400/70 bg-red-950/90 px-3 py-2 text-red-50 shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_24px_rgba(239,68,68,0.35)] backdrop-blur-md"
          title={line.id === 'engine' && connection.error ? connection.error : undefined}
        >
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]" />
          <span className="text-[12px] font-black uppercase tracking-[0.12em]">{line.title}</span>
          <span className="text-[12px] text-red-100/85">{line.detail}</span>
          {button(line)}
        </div>
      ))}
    </div>
  )
}
