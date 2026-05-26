'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

interface AdminSessionState {
  configured: boolean
  admin: boolean
  subject: string | null
}

interface KpiDashboard {
  generatedAt: string
  range: string
  since: string | null
  northStar: {
    seen: number
    entered: number
    activated: number
    returned: number
    asked: number
  }
  totals: {
    sessions: number
    events: number
    activatedSessions: number
    activationRate: number
    avgSessionLengthMs: number
    dailyConnections: number
    worldsVisited: number
    flowBreaks: number
    shareEvents: number
    estimatedCostUsd: number
    costPerActivatedUserUsd: number
  }
  funnel: Array<{
    label: string
    value: number
    target: number
    rate?: number
  }>
  worlds: Array<{
    id: string
    name: string
    visibility: string
    visitCount: number
    objectCount: number
    updatedAt: string
    eventVisits: number
  }>
  connections: Array<{
    agentType: string
    count: number
  }>
  costSources: Array<{
    source: string
    costUsd: number
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
  }>
  recentEvents: Array<{
    id: number
    eventType: string
    sessionId: string
    userId: string
    worldId: string | null
    agentType: string | null
    durationMs: number | null
    costUsd: number | null
    metadata: unknown
    createdAt: string
  }>
  instrumentation: {
    tracked: string[]
    next: string[]
  }
}

interface LiveDashboard {
  generatedAt: string
  entry: {
    shortCodes: Array<{
      code: string
      event: string
      label: string
      targetCap: number
      hardCap: number
      maxShards: number
      rootUrl: string
      fallbackUrl: string
      demoUrl: string
    }>
  }
  totals: {
    livePlayers: number
    liveRooms: number
    commandsAccepted: number
    commandsRejected: number
    mutationsRelayed: number
    maxCommandLatencyMs: number
    roomConnections: number
    roomCount: number
  }
  processes: {
    next: {
      uptimeSec: number
      memory: {
        rssMb: number
        heapUsedMb: number
        heapTotalMb: number
      }
    }
    room: null | {
      uptimeSec?: number
      memory?: {
        rssMb?: number
        heapUsedMb?: number
        heapTotalMb?: number
      }
      eventLoopDelayMs?: {
        mean?: number
        p95?: number
        max?: number
      }
    }
  }
  demoWorlds: Array<{
    id: string
    name: string
    visibility: string
    pvpEnabled: boolean
    objectCount: number
    visitCount: number
    players: number
    maxClients: number | null
    createdAt: string
    updatedAt: string
  }>
  liveRooms: Array<{
    worldId: string
    name: string
    players?: number
    maxClients?: number
    commandsAccepted?: number
    commandsRejected?: number
    mutationsRelayed?: number
    commandLatencyAvgMs?: number
    commandLatencyMaxMs?: number
  }>
}

const RANGE_OPTIONS = ['hourly', 'daily', 'weekly', 'alltime']

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatDuration(ms: number): string {
  if (!ms) return '0s'
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

function formatSeconds(seconds: number | undefined): string {
  return formatDuration((seconds || 0) * 1000)
}

function formatCost(value: number): string {
  if (!value) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function shortId(value: string): string {
  if (!value) return 'none'
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function metadataSummary(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)
  const record = value as Record<string, unknown>
  return Object.entries(record)
    .slice(0, 3)
    .map(([key, item]) => `${key}:${Array.isArray(item) ? item.length : String(item).slice(0, 24)}`)
    .join(' ')
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.035] p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 font-mono text-2xl text-cyan-100">{value}</div>
      {detail && <div className="mt-2 text-xs text-slate-400">{detail}</div>}
    </div>
  )
}

function ProgressRow({ label, value, target, rate }: { label: string; value: number; target: number; rate?: number }) {
  const width = Math.max(4, Math.min(100, target ? Math.round((value / target) * 100) : 0))
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-cyan-100">
          {formatNumber(value)} / {formatNumber(target)}
          {typeof rate === 'number' ? ` (${formatPercent(rate)})` : ''}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-cyan-300" style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

export default function AdminPage() {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<AdminSessionState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [range, setRange] = useState('daily')
  const [dashboard, setDashboard] = useState<KpiDashboard | null>(null)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [live, setLive] = useState<LiveDashboard | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/session', { cache: 'no-store' })
    const json = await res.json()
    setStatus({
      configured: Boolean(json.configured),
      admin: Boolean(json.admin),
      subject: json.subject ?? null,
    })
  }, [])

  const refreshDashboard = useCallback(async () => {
    setDashboardError(null)
    const res = await fetch(`/api/admin/kpis?range=${encodeURIComponent(range)}`, { cache: 'no-store' })
    if (!res.ok) {
      setDashboard(null)
      setDashboardError(`Could not load dashboard (${res.status})`)
      return
    }
    setDashboard(await res.json())
  }, [range])

  const refreshLive = useCallback(async () => {
    setLiveError(null)
    const res = await fetch('/api/admin/live', { cache: 'no-store' })
    if (!res.ok) {
      setLive(null)
      setLiveError(`Could not load live rooms (${res.status})`)
      return
    }
    setLive(await res.json())
  }, [])

  useEffect(() => {
    refresh().catch(() => setMessage('Could not read admin session.'))
  }, [refresh])

  useEffect(() => {
    if (!status) return
    if (!status.admin && status.configured) return
    refreshDashboard().catch(() => setDashboardError('Could not load dashboard.'))
  }, [refreshDashboard, status])

  useEffect(() => {
    if (!status) return
    if (!status.admin && status.configured) return
    refreshLive().catch(() => setLiveError('Could not load live rooms.'))
    const timer = window.setInterval(() => {
      refreshLive().catch(() => setLiveError('Could not load live rooms.'))
    }, 3000)
    return () => window.clearInterval(timer)
  }, [refreshLive, status])

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setMessage(body?.error || `Login failed (${res.status})`)
      return
    }
    setToken('')
    setMessage('Admin session active.')
    await refresh()
  }

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' })
    setMessage('Admin session cleared.')
    setDashboard(null)
    setLive(null)
    await refresh()
  }

  const northStar = useMemo(() => {
    if (!dashboard) return null
    return [
      { label: 'Seen', value: 0, target: dashboard.northStar.seen },
      { label: 'Entered', value: dashboard.totals.sessions, target: dashboard.northStar.entered },
      { label: 'Activated', value: dashboard.totals.activatedSessions, target: dashboard.northStar.activated },
      { label: 'Returned', value: dashboard.funnel.find(row => row.label === 'Returned')?.value || 0, target: dashboard.northStar.returned },
      { label: 'Asked', value: dashboard.funnel.find(row => row.label === 'Asked / Paid Signal')?.value || 0, target: dashboard.northStar.asked },
    ]
  }, [dashboard])

  return (
    <main className="min-h-screen bg-[#0a0d11] text-slate-100">
      <section className="mx-auto w-full max-w-7xl px-5 py-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Oasis Admin</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-wide">Hosted Control Room</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map(option => (
              <button
                key={option}
                onClick={() => setRange(option)}
                className={`rounded border px-3 py-2 text-xs uppercase tracking-[0.16em] ${
                  range === option
                    ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-100'
                    : 'border-white/10 text-slate-400'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6 rounded border border-white/15 bg-white/[0.03] p-5">
          <div className="mb-5 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-slate-500">Configured</div>
              <div className="font-mono text-cyan-200">{status?.configured ? 'yes' : 'no'}</div>
            </div>
            <div>
              <div className="text-slate-500">Session</div>
              <div className="font-mono text-cyan-200">{status?.admin ? 'admin' : 'visitor'}</div>
            </div>
            <div>
              <div className="text-slate-500">Subject</div>
              <div className="truncate font-mono text-cyan-200">{status?.subject || 'none'}</div>
            </div>
          </div>

          {!status?.admin ? (
            <form onSubmit={login} className="flex flex-col gap-3 sm:flex-row">
              <input
                value={token}
                onChange={event => setToken(event.target.value)}
                type="password"
                placeholder="Admin token"
                className="min-h-11 flex-1 rounded border border-white/15 bg-black/40 px-3 font-mono text-sm outline-none focus:border-cyan-300"
              />
              <button
                type="submit"
                disabled={!token.trim() || !status?.configured}
                className="min-h-11 rounded border border-cyan-300/40 px-5 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Login
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-3">
              <a
                href="/"
                className="rounded border border-cyan-300/40 px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-100"
              >
                Open Oasis
              </a>
              <button
                onClick={() => {
                  refreshDashboard().catch(() => setDashboardError('Could not load dashboard.'))
                  refreshLive().catch(() => setLiveError('Could not load live rooms.'))
                }}
                className="rounded border border-cyan-300/30 px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-100"
              >
                Refresh
              </button>
              <button
                onClick={logout}
                className="rounded border border-white/15 px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300"
              >
                Logout
              </button>
            </div>
          )}

          {message && <p className="mt-4 text-sm text-amber-200">{message}</p>}
        </div>

        {(status?.admin || status?.configured === false) && dashboardError && (
          <div className="mb-6 rounded border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
            {dashboardError}
          </div>
        )}

        {(status?.admin || status?.configured === false) && liveError && (
          <div className="mb-6 rounded border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
            {liveError}
          </div>
        )}

        {live && (
          <div className="mb-6 space-y-6">
            <div className="rounded border border-white/10 bg-white/[0.025] p-5">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-cyan-100">Live Rooms</h2>
                  <p className="text-sm text-slate-400">Projector-safe shard view for QR demos and hosted load checks.</p>
                </div>
                <div className="font-mono text-xs text-slate-500">Updated {new Date(live.generatedAt).toLocaleTimeString()}</div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <StatCard label="Live Players" value={formatNumber(live.totals.livePlayers)} detail={`${formatNumber(live.totals.liveRooms)} active world rooms`} />
                <StatCard label="Room CCU" value={formatNumber(live.totals.roomConnections)} detail={`${formatNumber(live.totals.roomCount)} Colyseus rooms`} />
                <StatCard label="Commands" value={formatNumber(live.totals.commandsAccepted)} detail={`${formatNumber(live.totals.commandsRejected)} rejected`} />
                <StatCard label="Mutations" value={formatNumber(live.totals.mutationsRelayed)} detail="Relayed room changes" />
                <StatCard label="Room RSS" value={`${formatNumber(live.processes.room?.memory?.rssMb || 0)} MB`} detail={`loop p95 ${formatNumber(live.processes.room?.eventLoopDelayMs?.p95 || 0)}ms`} />
                <StatCard label="Next RSS" value={`${formatNumber(live.processes.next.memory.rssMb)} MB`} detail={`up ${formatSeconds(live.processes.next.uptimeSec)}`} />
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded border border-white/10 bg-white/[0.025] p-5">
                <h2 className="mb-4 text-lg font-semibold text-cyan-100">Entry Codes</h2>
                <div className="space-y-3">
                  {live.entry.shortCodes.map(entry => (
                    <div key={entry.code} className="rounded border border-white/10 bg-black/20 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="font-mono text-2xl text-cyan-100">/{entry.code}</div>
                        <div className="font-mono text-xs text-slate-500">{entry.targetCap}/{entry.hardCap} x {entry.maxShards}</div>
                      </div>
                      <div className="truncate font-mono text-sm text-slate-200">{entry.rootUrl}</div>
                      <div className="mt-1 truncate font-mono text-xs text-slate-500">{entry.event}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded border border-white/10 bg-white/[0.025] p-5">
                <h2 className="mb-4 text-lg font-semibold text-cyan-100">Demo Shards</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
                      <tr>
                        <th className="pb-2">Shard</th>
                        <th className="pb-2 text-right">Players</th>
                        <th className="pb-2 text-right">Objects</th>
                        <th className="pb-2 text-right">Visits</th>
                        <th className="pb-2">PvP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {live.demoWorlds.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-5 text-center text-slate-500">No demo shards created yet.</td>
                        </tr>
                      ) : live.demoWorlds.map(world => (
                        <tr key={world.id}>
                          <td className="py-3">
                            <div className="font-medium text-slate-200">{world.name}</div>
                            <div className="font-mono text-xs text-slate-500">{shortId(world.id)}</div>
                          </td>
                          <td className="py-3 text-right font-mono text-cyan-100">
                            {formatNumber(world.players)}{world.maxClients ? ` / ${formatNumber(world.maxClients)}` : ''}
                          </td>
                          <td className="py-3 text-right font-mono">{formatNumber(world.objectCount)}</td>
                          <td className="py-3 text-right font-mono">{formatNumber(world.visitCount)}</td>
                          <td className="py-3 font-mono text-xs text-cyan-100">{world.pvpEnabled ? 'on' : 'off'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="rounded border border-white/10 bg-white/[0.025] p-5">
              <h2 className="mb-4 text-lg font-semibold text-cyan-100">Active Worlds</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="pb-2">World</th>
                      <th className="pb-2 text-right">Players</th>
                      <th className="pb-2 text-right">Accepted</th>
                      <th className="pb-2 text-right">Rejected</th>
                      <th className="pb-2 text-right">Mutations</th>
                      <th className="pb-2 text-right">Avg Ack</th>
                      <th className="pb-2 text-right">Max Ack</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {live.liveRooms.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-5 text-center text-slate-500">No live rooms right now.</td>
                      </tr>
                    ) : live.liveRooms.map(room => (
                      <tr key={room.worldId}>
                        <td className="py-3">
                          <div className="font-medium text-slate-200">{room.name}</div>
                          <div className="font-mono text-xs text-slate-500">{shortId(room.worldId)}</div>
                        </td>
                        <td className="py-3 text-right font-mono text-cyan-100">{formatNumber(room.players || 0)}</td>
                        <td className="py-3 text-right font-mono">{formatNumber(room.commandsAccepted || 0)}</td>
                        <td className="py-3 text-right font-mono">{formatNumber(room.commandsRejected || 0)}</td>
                        <td className="py-3 text-right font-mono">{formatNumber(room.mutationsRelayed || 0)}</td>
                        <td className="py-3 text-right font-mono">{formatNumber(room.commandLatencyAvgMs || 0)}ms</td>
                        <td className="py-3 text-right font-mono">{formatNumber(room.commandLatencyMaxMs || 0)}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {dashboard && (
          <div className="space-y-6">
            <div className="rounded border border-white/10 bg-white/[0.025] p-5">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-cyan-100">30-Day Lighthouse</h2>
                  <p className="text-sm text-slate-400">100 see it. 20 enter. 10 hit magic. 3 return. 1 asks to build or pay.</p>
                </div>
                <div className="font-mono text-xs text-slate-500">Updated {new Date(dashboard.generatedAt).toLocaleString()}</div>
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                {northStar?.map(row => (
                  <ProgressRow key={row.label} label={row.label} value={row.value} target={row.target} />
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <StatCard label="Sessions" value={formatNumber(dashboard.totals.sessions)} detail={`${formatNumber(dashboard.totals.events)} tracked events`} />
              <StatCard label="Activation" value={formatPercent(dashboard.totals.activationRate)} detail={`${formatNumber(dashboard.totals.activatedSessions)} activated`} />
              <StatCard label="Connections" value={formatNumber(dashboard.totals.dailyConnections)} detail="OpenClaw/Hermes pairing signals" />
              <StatCard label="Session Length" value={formatDuration(dashboard.totals.avgSessionLengthMs)} detail="Approx from browser session span" />
              <StatCard label="Flow Breaks" value={formatNumber(dashboard.totals.flowBreaks)} detail={`${formatNumber(dashboard.totals.shareEvents)} share signals`} />
              <StatCard label="Cost / Activated" value={formatCost(dashboard.totals.costPerActivatedUserUsd)} detail={`${formatCost(dashboard.totals.estimatedCostUsd)} estimated total`} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
              <div className="rounded border border-white/10 bg-white/[0.025] p-5">
                <h2 className="mb-4 text-lg font-semibold text-cyan-100">Activation Funnel</h2>
                <div className="space-y-4">
                  {dashboard.funnel.map(row => (
                    <ProgressRow key={row.label} {...row} />
                  ))}
                </div>
              </div>

              <div className="rounded border border-white/10 bg-white/[0.025] p-5">
                <h2 className="mb-4 text-lg font-semibold text-cyan-100">Recent Flow Log</h2>
                <div className="max-h-80 space-y-2 overflow-auto pr-2">
                  {dashboard.recentEvents.length === 0 ? (
                    <div className="rounded border border-white/10 p-4 text-sm text-slate-500">No events yet. Open the Oasis once and this starts breathing.</div>
                  ) : dashboard.recentEvents.map(event => (
                    <div key={event.id} className="grid gap-2 rounded border border-white/10 bg-black/25 p-3 text-xs md:grid-cols-[8.5rem_1fr_7rem]">
                      <div className="font-mono text-cyan-100">{event.eventType}</div>
                      <div className="min-w-0">
                        <div className="truncate text-slate-300">
                          session {shortId(event.sessionId)}
                          {event.worldId ? ` - world ${shortId(event.worldId)}` : ''}
                          {event.agentType ? ` - ${event.agentType}` : ''}
                        </div>
                        <div className="truncate text-slate-500">{metadataSummary(event.metadata)}</div>
                      </div>
                      <div className="text-right font-mono text-slate-500">{new Date(event.createdAt).toLocaleTimeString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <div className="rounded border border-white/10 bg-white/[0.025] p-5 xl:col-span-2">
                <h2 className="mb-4 text-lg font-semibold text-cyan-100">Worlds</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
                      <tr>
                        <th className="pb-2">World</th>
                        <th className="pb-2">Visibility</th>
                        <th className="pb-2 text-right">DB Visits</th>
                        <th className="pb-2 text-right">Event Visits</th>
                        <th className="pb-2 text-right">Objects</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {dashboard.worlds.map(world => (
                        <tr key={world.id}>
                          <td className="py-3">
                            <div className="font-medium text-slate-200">{world.name}</div>
                            <div className="font-mono text-xs text-slate-500">{shortId(world.id)}</div>
                          </td>
                          <td className="py-3 font-mono text-xs text-cyan-100">{world.visibility}</td>
                          <td className="py-3 text-right font-mono">{formatNumber(world.visitCount)}</td>
                          <td className="py-3 text-right font-mono">{formatNumber(world.eventVisits)}</td>
                          <td className="py-3 text-right font-mono">{formatNumber(world.objectCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded border border-white/10 bg-white/[0.025] p-5">
                  <h2 className="mb-4 text-lg font-semibold text-cyan-100">Agent Connections</h2>
                  <div className="space-y-2">
                    {dashboard.connections.length === 0 ? (
                      <div className="text-sm text-slate-500">No pairings in this range.</div>
                    ) : dashboard.connections.map(connection => (
                      <div key={connection.agentType} className="flex items-center justify-between rounded border border-white/10 p-3 text-sm">
                        <span className="font-mono text-cyan-100">{connection.agentType}</span>
                        <span className="font-mono">{connection.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded border border-white/10 bg-white/[0.025] p-5">
                  <h2 className="mb-4 text-lg font-semibold text-cyan-100">AI Cost Sources</h2>
                  <div className="space-y-2">
                    {dashboard.costSources.length === 0 ? (
                      <div className="text-sm text-slate-500">No token-burn rows in this range.</div>
                    ) : dashboard.costSources.slice(0, 6).map(source => (
                      <div key={source.source} className="rounded border border-white/10 p-3">
                        <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                          <span className="font-mono text-cyan-100">{source.source}</span>
                          <span className="font-mono">{formatCost(source.costUsd)}</span>
                        </div>
                        <div className="font-mono text-xs text-slate-500">
                          in {formatNumber(source.inputTokens)} / cached {formatNumber(source.cachedInputTokens)} / out {formatNumber(source.outputTokens)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded border border-white/10 bg-white/[0.025] p-5">
                <h2 className="mb-3 text-lg font-semibold text-cyan-100">Tracked Now</h2>
                <div className="flex flex-wrap gap-2">
                  {dashboard.instrumentation.tracked.map(item => (
                    <span key={item} className="rounded border border-cyan-300/20 px-2 py-1 font-mono text-xs text-cyan-100">{item}</span>
                  ))}
                </div>
              </div>
              <div className="rounded border border-white/10 bg-white/[0.025] p-5">
                <h2 className="mb-3 text-lg font-semibold text-cyan-100">Next Probes</h2>
                <div className="flex flex-wrap gap-2">
                  {dashboard.instrumentation.next.map(item => (
                    <span key={item} className="rounded border border-amber-300/20 px-2 py-1 font-mono text-xs text-amber-100">{item}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
