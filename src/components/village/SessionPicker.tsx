'use client'

// ░▒▓ SESSION PICKER — summon a Claude Code session as an agent (owned) or observe it (read-only) ▓▒░
// The engine lists metadata only (title, cwd, size, live badge from a 128 KB head/tail read);
// transcripts are replayed only when you spawn or observe one.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useUILayer } from '../../lib/input-manager'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import type { EngineSessionMeta, SpawnAgentArgs } from '../../lib/agent-engine-types'
import { DEFAULT_ANORAK_PRO_CWD, filterSessions, pickSuggestions } from '../../lib/village/village-sessions'
import { showNotice } from '../forge/GlobalNotice'
import { VILLAGE_PICKER_LAYER, focusVillageAgent, openVillagePicker } from './village-actions'
import { cwdLabel, formatAgo, formatBytes } from './village-status'

/** Anorak Pro's home folder (override with NEXT_PUBLIC_ANORAK_PRO_CWD). */
const ANORAK_PRO_CWD = process.env.NEXT_PUBLIC_ANORAK_PRO_CWD || DEFAULT_ANORAK_PRO_CWD
const PAGE = 60
const FETCH_STEP = 300
const MODELS = ['', 'haiku', 'sonnet', 'opus']
const MODES = ['', 'default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions']

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useSessionLoader(open: boolean) {
  const dispatch = useOasisStore(s => s.agentEngineDispatch)
  const connected = useOasisStore(s => s.agentEngine.connection.status === 'open')
  const [limit, setLimit] = useState(FETCH_STEP)
  const load = useCallback((nextLimit: number) => {
    dispatch({ type: 'sessions/loading' })
    getAgentEngineClient()
      .listSessions(nextLimit)
      .then(items => dispatch({ type: 'sessions/loaded', items, at: Date.now() }))
      .catch(error => dispatch({ type: 'sessions/error', error: describeError(error) }))
  }, [dispatch])
  useEffect(() => {
    if (!open || !connected) return
    const loadedAt = useOasisStore.getState().agentEngine.sessions.loadedAt
    if (loadedAt && Date.now() - loadedAt < 20000) return
    load(limit)
  }, [open, connected, load, limit])
  return {
    reload: () => load(limit),
    loadOlder: () => {
      const next = limit + FETCH_STEP
      setLimit(next)
      load(next)
    },
    limit,
  }
}

interface SpawnDefaults {
  model: string
  permissionMode: string
}

function SessionRow({ session, defaults, onDone }: { session: EngineSessionMeta; defaults: SpawnDefaults; onDone: (agentId: string) => void }) {
  const [busy, setBusy] = useState<'spawn' | 'observe' | null>(null)
  const client = getAgentEngineClient()
  const name = (session.title || cwdLabel(session.cwd) || 'agent').slice(0, 32)

  const spawn = () => {
    if (!session.cwd) return
    let fork = false
    if (session.live) {
      const ok = window.confirm(
        `"${session.title}" is open right now (pid ${session.live.pid}, ${session.live.entrypoint || session.live.kind || 'claude'}, ${session.live.status || '?'}).\n\n` +
        'Driving one session from two places silently forks its transcript. OK spawns a forked copy (safe); Cancel does nothing.',
      )
      if (!ok) return
      fork = true
    }
    const args: SpawnAgentArgs = { name, cwd: session.cwd, sessionId: session.sessionId, fork }
    if (defaults.model) args.model = defaults.model
    if (defaults.permissionMode) args.permissionMode = defaults.permissionMode
    setBusy('spawn')
    client.spawnAgent(args)
      .then(agent => onDone(agent.id))
      .catch(error => showNotice(`Spawn failed: ${describeError(error)}`, 'error'))
      .finally(() => setBusy(null))
  }

  const observe = () => {
    setBusy('observe')
    client.observe(session.path, name)
      .then(agent => onDone(agent.id))
      .catch(error => showNotice(`Observe failed: ${describeError(error)}`, 'error'))
      .finally(() => setBusy(null))
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 hover:border-white/15">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12.5px] font-bold text-white" title={session.firstPrompt || session.title}>{session.title}</span>
          {session.live && (
            <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-amber-100" title={`open in pid ${session.live.pid} (${session.live.entrypoint || session.live.kind || ''})`}>
              open · {session.live.status || 'live'}
            </span>
          )}
          {!session.live && session.recentlyActive && <span className="rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-100">active</span>}
        </div>
        <div className="mt-0.5 truncate text-[10.5px] text-white/45" title={session.cwd || session.projectDir}>
          {session.cwd || session.projectDir || 'unknown folder'} · {session.entrypoint || '?'} · {formatAgo(session.mtime)} · {formatBytes(session.size)}
          {session.gitBranch ? ` · ${session.gitBranch}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {session.ownedBy || session.observedBy ? (
          <button
            type="button"
            onClick={() => onDone((session.ownedBy || session.observedBy) as string)}
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10.5px] font-bold text-white/75 hover:bg-white/15"
          >
            {session.ownedBy ? 'in village' : 'observing'} · go
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={observe}
              title="Watch it read-only. Nothing is written to the session."
              className="rounded-md border border-cyan-300/35 bg-cyan-400/10 px-2 py-1 text-[10.5px] font-bold text-cyan-100 hover:bg-cyan-400/25 disabled:opacity-40"
            >
              {busy === 'observe' ? '…' : 'observe'}
            </button>
            <button
              type="button"
              disabled={busy !== null || !session.cwd}
              onClick={spawn}
              title={session.live ? 'Open elsewhere: spawns a forked copy' : 'Resume it as an agent you can talk to'}
              className="rounded-md border border-emerald-300/40 bg-emerald-400/15 px-2 py-1 text-[10.5px] font-bold text-emerald-50 hover:bg-emerald-400/30 disabled:opacity-40"
            >
              {busy === 'spawn' ? '…' : session.live ? 'fork' : 'spawn'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function NewAgentForm({ defaults, onDone, initialCwd = '' }: { defaults: SpawnDefaults; onDone: (agentId: string) => void; initialCwd?: string }) {
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(initialCwd)
  const [busy, setBusy] = useState(false)
  const submit = () => {
    const folder = cwd.trim()
    if (!folder) return
    const args: SpawnAgentArgs = { name: name.trim() || cwdLabel(folder), cwd: folder }
    if (defaults.model) args.model = defaults.model
    if (defaults.permissionMode) args.permissionMode = defaults.permissionMode
    setBusy(true)
    getAgentEngineClient().spawnAgent(args)
      .then(agent => onDone(agent.id))
      .catch(error => showNotice(`Spawn failed: ${describeError(error)}`, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={event => { event.preventDefault(); submit() }}
    >
      <input value={name} onChange={event => setName(event.target.value)} onKeyDown={event => event.stopPropagation()} placeholder="name" className="w-32 rounded-md border border-white/15 bg-black/45 px-2 py-1 text-[12px] text-white placeholder:text-white/30 focus:outline-none max-[700px]:w-full" />
      <input value={cwd} onChange={event => setCwd(event.target.value)} onKeyDown={event => event.stopPropagation()} placeholder="working folder, e.g. C:\7p_nocrastination" className="min-w-[200px] flex-1 rounded-md border border-white/15 bg-black/45 px-2 py-1 text-[12px] text-white placeholder:text-white/30 focus:outline-none" />
      <button type="submit" disabled={busy || !cwd.trim()} className="rounded-md border border-emerald-300/40 bg-emerald-400/15 px-3 py-1 text-[11px] font-bold text-emerald-50 hover:bg-emerald-400/30 disabled:opacity-40">
        {busy ? '…' : 'new agent'}
      </button>
    </form>
  )
}

function Suggestions({ sessions, defaults, onDone }: { sessions: EngineSessionMeta[]; defaults: SpawnDefaults; onDone: (agentId: string) => void }) {
  const { anorak, recent } = useMemo(() => pickSuggestions(sessions, ANORAK_PRO_CWD), [sessions])
  const [busy, setBusy] = useState(false)
  const newAnorak = () => {
    const args: SpawnAgentArgs = { name: 'Anorak Pro', cwd: ANORAK_PRO_CWD }
    if (defaults.model) args.model = defaults.model
    if (defaults.permissionMode) args.permissionMode = defaults.permissionMode
    setBusy(true)
    getAgentEngineClient().spawnAgent(args)
      .then(agent => onDone(agent.id))
      .catch(error => showNotice(`Spawn failed: ${describeError(error)}`, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200/80">Start here</div>
      <div className="rounded-lg border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-black text-white">Anorak Pro</div>
            <div className="truncate text-[10.5px] text-white/50">{ANORAK_PRO_CWD}{anorak ? ` · latest: ${anorak.title} (${formatAgo(anorak.mtime)})` : ' · no session there yet'}</div>
          </div>
          <button type="button" disabled={busy} onClick={newAnorak} className="rounded-md border border-fuchsia-300/40 bg-fuchsia-400/15 px-2.5 py-1 text-[11px] font-bold text-fuchsia-50 hover:bg-fuchsia-400/30 disabled:opacity-40">
            {busy ? '…' : 'new session'}
          </button>
        </div>
        {anorak && <div className="mt-2"><SessionRow session={{ ...anorak, title: `Anorak Pro: ${anorak.title}` }} defaults={defaults} onDone={onDone} /></div>}
      </div>
      {recent.length > 0 && <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/45">Most recent</div>}
      {recent.map(session => <SessionRow key={session.path} session={session} defaults={defaults} onDone={onDone} />)}
    </div>
  )
}

export function SessionPicker() {
  const open = useOasisStore(s => s.agentEngine.pickerOpen)
  const sessions = useOasisStore(s => s.agentEngine.sessions)
  const rosterEmpty = useOasisStore(s => s.agentEngine.order.length === 0)
  const connected = useOasisStore(s => s.agentEngine.connection.status === 'open')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [defaults, setDefaults] = useState<SpawnDefaults>({ model: '', permissionMode: '' })
  useUILayer(VILLAGE_PICKER_LAYER, open)
  const { reload, loadOlder, limit } = useSessionLoader(open)

  const close = useCallback(() => openVillagePicker(false), [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [open, close])

  useEffect(() => { setShown(PAGE) }, [query])

  const filtered = useMemo(() => filterSessions(sessions.items, query), [sessions.items, query])

  if (!open) return null

  const onDone = (agentId: string) => {
    close()
    window.setTimeout(() => focusVillageAgent(agentId), 0)
  }

  return (
    <div
      data-ui-panel="village-picker"
      className="fixed inset-0 z-[9600] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm max-[700px]:p-0"
      onPointerDown={event => { if (event.target === event.currentTarget) close() }}
    >
      <div className="flex max-h-[86vh] w-[min(780px,100%)] flex-col gap-3 rounded-2xl border border-white/15 bg-slate-950/95 p-4 text-white shadow-[0_30px_90px_rgba(0,0,0,0.6)] max-[700px]:h-full max-[700px]:max-h-none max-[700px]:rounded-none">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[15px] font-black tracking-wide">Summon an agent</div>
            <div className="text-[11px] text-white/45">Spawn resumes a session as an agent you can talk to. Observe watches it read-only.</div>
          </div>
          <button type="button" onClick={close} className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[12px] font-bold text-white/70 hover:bg-white/15">✕</button>
        </div>

        {!connected ? (
          <div className="rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100">
            The agent engine is offline. Start it next to the Oasis with <code className="rounded bg-black/40 px-1">pnpm dev:engine</code>.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/60">
              <label className="flex items-center gap-1">
                model
                <select value={defaults.model} onChange={event => setDefaults(d => ({ ...d, model: event.target.value }))} className="rounded border border-white/15 bg-black/50 px-1 py-0.5 text-white">
                  {MODELS.map(model => <option key={model} value={model}>{model || '(from settings)'}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">
                permissions
                <select value={defaults.permissionMode} onChange={event => setDefaults(d => ({ ...d, permissionMode: event.target.value }))} className="rounded border border-white/15 bg-black/50 px-1 py-0.5 text-white">
                  {MODES.map(mode => <option key={mode} value={mode}>{mode || '(from settings)'}</option>)}
                </select>
              </label>
              <span className="text-white/35">apply to spawns below</span>
            </div>

            <NewAgentForm defaults={defaults} onDone={onDone} />

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {rosterEmpty && !query && sessions.status === 'ready' && (
                <Suggestions sessions={sessions.items} defaults={defaults} onDone={onDone} />
              )}
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-slate-950/95 py-1">
                <input
                  value={query}
                  autoFocus
                  onChange={event => setQuery(event.target.value)}
                  onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }}
                  placeholder="filter by title, folder, prompt, branch…"
                  className="flex-1 rounded-md border border-white/15 bg-black/45 px-2.5 py-1.5 text-[12.5px] text-white placeholder:text-white/30 focus:border-emerald-300/40 focus:outline-none"
                />
                <button type="button" onClick={reload} className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-[11px] font-bold text-white/70 hover:bg-white/15">refresh</button>
              </div>
              <div className="text-[10.5px] text-white/40">
                {sessions.status === 'loading' ? 'reading session metadata…' : sessions.status === 'error' ? `could not list sessions: ${sessions.error}` : `${filtered.length} of ${sessions.items.length} newest sessions${filtered.length > shown ? ` · showing ${shown}` : ''}`}
              </div>
              {filtered.slice(0, shown).map(session => (
                <SessionRow key={session.path} session={session} defaults={defaults} onDone={onDone} />
              ))}
              {filtered.length > shown && (
                <button type="button" onClick={() => setShown(n => n + PAGE)} className="rounded-md border border-white/10 bg-white/5 py-1.5 text-[11px] font-bold text-white/70 hover:bg-white/10">
                  show {Math.min(PAGE, filtered.length - shown)} more
                </button>
              )}
              {sessions.status === 'ready' && sessions.items.length >= limit && filtered.length <= shown && (
                <button type="button" onClick={loadOlder} className="rounded-md border border-white/10 bg-white/5 py-1.5 text-[11px] font-bold text-white/60 hover:bg-white/10">
                  load older sessions
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
