'use client'

// Settings > Agents > Oasis services: the agent engine and the page server, their state, and a Restart button for
// each (the owner's click only; /api/oasis/services asks the supervisor, scripts/oasis-supervisor.mjs). Without the
// supervisor (the old two-window launcher) it says how to get it. The red warning when one is down is
// ConnectionWarning's; this is where to act on it.

import { useCallback, useEffect, useState } from 'react'

interface ServiceView {
  name: 'engine' | 'world'
  label: string
  state: 'running' | 'starting' | 'down' | 'stopping' | 'gave-up' | 'unknown'
  managed: boolean
  since?: number | null
  restarts?: number
  lastExit?: { at: number; code: number | null; signal: string | null } | null
  log?: string
}

const STATE_TEXT: Record<ServiceView['state'], string> = {
  running: 'running',
  starting: 'starting…',
  down: 'down: starting it again shortly',
  stopping: 'restarting…',
  'gave-up': 'down: it crashed five times in ten minutes; Restart tries again',
  unknown: '…',
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

export function ServicesSettings() {
  const [data, setData] = useState<{ supervisor: boolean; services: ServiceView[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/oasis/services', { cache: 'no-store' })
      .then(res => res.json())
      .then(body => { setData(body); setError(null) })
      .catch(() => setError('The page server does not answer right now.'))
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 3000)
    return () => window.clearInterval(timer)
  }, [load])

  const restart = (service: ServiceView) => {
    const what = service.name === 'world'
      ? 'Restart the page server? This window goes blank for about half a minute, then reloads by itself. Agents keep working.'
      : 'Restart the agent engine? Agents in the middle of a turn are stopped and told to carry on when it is back (about ten seconds).'
    if (!window.confirm(what)) return
    setAsked(service.name)
    fetch('/api/oasis/services', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: service.name }) })
      .then(async res => { if (!res.ok) setError((await res.json().catch(() => ({}))).error || `Restart failed (${res.status})`) })
      .catch(() => { /* the page server's own restart ends this request: expected */ })
      .finally(() => window.setTimeout(() => setAsked(null), 4000))
  }

  return (
    <section data-services-settings>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Oasis services</div>
      {error && <div className="text-[11px] text-amber-300 mb-1">{error}</div>}
      {data && data.services.map(service => (
        <div key={service.name} className="flex items-center justify-between gap-2 py-1" data-service={service.name} data-service-state={service.state}>
          <div className="min-w-0">
            <div className="text-sm text-gray-300">{service.label}</div>
            <div className={`text-[10px] ${service.state === 'running' ? 'text-gray-500' : 'text-amber-300'}`} title={service.log ? `Log: ${service.log}` : undefined}>
              {STATE_TEXT[service.state] || service.state}
              {service.state === 'running' && service.since ? ` since ${clock(service.since)}` : ''}
              {data.supervisor ? (service.managed ? ' · no window' : ' · in its own window') : ''}
              {service.restarts ? ` · restarted ${service.restarts}×` : ''}
            </div>
          </div>
          <button
            type="button"
            disabled={!data.supervisor || asked === service.name || service.state === 'stopping'}
            onClick={() => restart(service)}
            data-service-restart={service.name}
            className="shrink-0 rounded border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 text-xs font-bold text-cyan-50 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {asked === service.name ? 'Restarting…' : 'Restart'}
          </button>
        </div>
      ))}
      <div className="text-[10px] text-gray-500 mt-1">
        {data?.supervisor
          ? 'The supervisor runs both without windows, keeps their logs in C:\\af_oasis\\logs and starts one again if it stops.'
          : 'The servers run in windows of their own (the OASIS launcher). Start the Oasis from the "Oasis app" desktop icon to run them hidden and restart them from here.'}
      </div>
    </section>
  )
}
