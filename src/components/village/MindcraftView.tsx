'use client'

// ░▒▓ MINDCRAFT — the list of days: what was worked on, how long, how much XP ▓▒░
// Self-contained: <MindcraftView /> fills whatever holds it (a menu tile's page, a window) and needs
// nothing but /api/village/work. <MindcraftWindow /> is the same view as a window over the world; it
// opens on the `oasis:open-mindcraft` window event (openMindcraft()).
//
// Tabs: Mine (the owner's days), The Oasis (all agents together), and one per agent. A day is one
// row; click it and it opens into its units of work: one per mission, one for time with agents, one
// for just being in the Oasis. Never a row per turn.

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useMindcraftLook } from './mindcraft-look'
import { ManualTimeForm } from './ManualTimeForm'
import { CarbonMissions } from './CarbonMissions'
import { useKitStyle } from '@/components/ui-kit'
import { setWorkInMindcraft } from './work-vow-client'
import { formatClock, type MindcraftBook, type MindcraftDay, type WorkSnapshot, type WorkUnit } from '../../lib/village/work-vow'

const UNIT_COLOR = { mission: '#38bdf8', agent: '#c084fc', free: '#34d399', manual: '#f59e0b' }

export const MINDCRAFT_EVENT = 'oasis:open-mindcraft'

/** Open the Mindcraft window from anywhere (a menu tile, a key, the work counter). */
export function openMindcraft(carbonFile?: string): void {
  window.dispatchEvent(new CustomEvent(MINDCRAFT_EVENT, { detail: carbonFile ? { carbon: carbonFile } : {} }))
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** `1:23:45`, spelled so nobody misreads it: hours, minutes, seconds. */
function hms(seconds: number): string {
  return formatClock(seconds)
}

function UnitRow({ unit, date, onRemoveManual }: { unit: WorkUnit; date: string; onRemoveManual?: (date: string, index: number) => void }) {
  const [open, setOpen] = useState(false)
  const foldable = Boolean(unit.parts?.length)
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`flex items-start gap-3 text-white/90 ${foldable ? 'cursor-pointer' : ''}`} onClick={foldable ? () => setOpen(value => !value) : undefined}>
        <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: UNIT_COLOR[unit.kind] }} />
        <span className="min-w-0 flex-1 break-words">
          {foldable ? (open ? '▾ ' : '▸ ') : ''}{unit.label}
          {/* XP is time; the mission only says what the time went to. */}
          {unit.kind === 'agent' && !unit.parts && (
            <span className="text-white/55">
              {unit.mission ? <> · on “{unit.mission}”</> : <> · no mission named</>}
              {unit.split ? <> · own {hms(unit.split.own)} + helpers {hms(unit.split.helpers)}</> : null}
            </span>
          )}
        </span>
        <span className="shrink-0 whitespace-nowrap text-right font-bold tabular-nums">{hms(unit.seconds)}</span>
        <span className="min-w-[78px] shrink-0 whitespace-nowrap text-right tabular-nums text-white/60">{unit.xp} XP</span>
        {unit.kind === 'manual' && typeof unit.manualIndex === 'number' && onRemoveManual && (
          <button
            type="button"
            data-mindcraft="manual-delete"
            title="Delete this entry"
            onClick={event => { event.stopPropagation(); onRemoveManual(date, unit.manualIndex as number) }}
            className="shrink-0 rounded border border-rose-300/40 bg-rose-500/15 px-2 py-0.5 text-[12px] font-bold text-rose-100 hover:bg-rose-500/35"
          >
            delete
          </button>
        )}
      </div>
      {open && unit.parts && (
        <div className="ml-5 flex flex-col gap-0.5 border-l border-white/10 pl-3">
          {unit.parts.map(part => (
            <div key={part.label} className="flex items-start gap-3 text-white/75">
              <span className="min-w-0 flex-1 break-words">{part.label}</span>
              <span className="shrink-0 whitespace-nowrap tabular-nums">{hms(part.seconds)}</span>
              <span className="min-w-[78px] shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DayList({ days, today, target, empty, onRemoveManual }: { days: MindcraftDay[]; today: string; target: number | null; empty: string; onRemoveManual?: (date: string, index: number) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (!days.length) return <div className="py-6 text-center text-white/45">{empty}</div>
  const top = Math.max(1, ...days.map(day => day.seconds))
  return (
    <div className="flex flex-col gap-1.5">
      {days.map(day => {
        const isOpen = open[day.date] ?? day.date === today
        const hit = target !== null && day.seconds >= target
        return (
          <div key={day.date} className="mc-card">
            <button type="button" onClick={() => setOpen(value => ({ ...value, [day.date]: !isOpen }))} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/5">
              <span className="w-3 text-white/50">{isOpen ? '▾' : '▸'}</span>
              <span className="mc-strong w-[136px] shrink-0 text-[14px]">{dayLabel(day.date)}{day.date === today ? ' · today' : ''}</span>
              <span className="mc-track min-w-0 flex-1">
                <span className="block h-full" style={{ width: `${(day.seconds / (target ? Math.max(target, top) : top)) * 100}%`, background: hit ? '#34d399' : '#fbbf24' }} />
              </span>
              {/* Hours are the main number; XP stands beside it, smaller. */}
              <span className="shrink-0 whitespace-nowrap text-right text-[17px] font-bold tabular-nums" style={{ color: hit ? '#34d399' : '#fff' }}>{hms(day.seconds)}</span>
              <span className="min-w-[78px] shrink-0 whitespace-nowrap text-right tabular-nums text-white/65">{day.xp} XP</span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-2">
                {day.units.map((unit, index) => <UnitRow key={index} unit={unit} date={day.date} onRemoveManual={onRemoveManual} />)}
                {(day.bonusXp || day.penaltyXp) ? (
                  <div className="mt-1 text-white/55">
                    {day.bonusXp ? <>The day was kept: its XP counts double (+{day.bonusXp}).</> : <>The day fell short: −{day.penaltyXp} XP for the missing minutes.</>} That is inside the {day.xp} XP above.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The agents' missions (docs/missions), ranked: they moved here from the Zen garden's wall, which now shows his. */
function AgentMissionBoard() {
  const [list, setList] = useState<Array<{ file: string; title: string; column: string; state: string; who: string; priority: number | null; tldr: string }> | null>(null)
  useEffect(() => {
    let gone = false
    fetch('/api/village/missions', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then((data: { missions?: typeof list } | null) => { if (!gone) setList(data?.missions || []) })
      .catch(() => { if (!gone) setList([]) })
    return () => { gone = true }
  }, [])
  if (!list?.length) return null
  const open = list.filter(m => m.column !== 'done')
  return (
    <div className="mc-card flex flex-col gap-1 px-3 py-2" data-mindcraft="silicon-missions">
      <div className="mc-strong text-[14px]">The agents&rsquo; missions ({open.length} open)</div>
      {open.map(m => (
        <div key={m.file} className="flex items-start gap-3 text-white/85">
          <span className="w-[42px] shrink-0 text-right font-bold tabular-nums" style={{ color: m.column === 'doing' ? '#fbbf24' : '#7dd3fc' }}>{m.priority === null ? '—' : m.priority.toFixed(2)}</span>
          <span className="min-w-0 flex-1 break-words">{m.title} <span className="text-white/50">· {m.state} · {m.who || 'nobody yet'}</span></span>
        </div>
      ))}
    </div>
  )
}

export function MindcraftView({ carbonFile }: { carbonFile?: string | null } = {}) {
  useMindcraftLook() // the look (textures, typefaces) lives in mindcraft-look.tsx; this file carries its class names
  // Time in Mindcraft is work at valor 1 (the owner, 2026-11-20), wherever this view is shown.
  useEffect(() => {
    setWorkInMindcraft(true)
    return () => setWorkInMindcraft(false)
  }, [])
  const [book, setBook] = useState<MindcraftBook | null>(null)
  const [snapshot, setSnapshot] = useState<WorkSnapshot | null>(null)
  // Carbon: what the Oasis needs from him. Silicon: what the agents did. Today: his own time (the owner, 2026-11-20).
  const [tab, setTab] = useState<'carbon' | 'silicon' | 'today'>('carbon')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([
        fetch('/api/village/work?mindcraft=1', { cache: 'no-store' }),
        fetch('/api/village/work', { cache: 'no-store' }),
      ])
      if (!b.ok || !s.ok) throw new Error(`the work book answered ${b.ok ? s.status : b.status}`)
      setBook(await b.json() as MindcraftBook)
      setSnapshot(await s.json() as WorkSnapshot)
      setError('')
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    }
  }, [])
  // The lists move slowly: on open, then every 30 s while it is looked at.
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const post = async (body: unknown) => {
    await fetch('/api/village/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    void load()
  }
  const removeManual = (date: string, index: number) => {
    const entry = book?.owner.find(day => day.date === date)?.units.find(unit => unit.manualIndex === index)
    if (entry && window.confirm(`Delete "${entry.label}" (${formatClock(entry.seconds)}) from ${date}?`)) void post({ manual: { date, remove: index } })
  }

  if (error && !book) return <div className="p-6 text-rose-200">Mindcraft can&rsquo;t read the work book: {error}</div>
  if (!book || !snapshot) return <div className="p-6 text-white/50">Opening the book…</div>

  const tabs = [
    { id: 'carbon' as const, label: 'Carbon', sub: 'your missions' },
    { id: 'silicon' as const, label: 'Silicon', sub: `agents today ${hms(snapshot.agentHours?.today || 0)}` },
    { id: 'today' as const, label: 'Today', sub: `you ${hms(snapshot.today.seconds)} · ${book.totals.owner.xp} XP in all` },
  ]
  const vow = snapshot.commitments[0]
  return (
    <div className="mc-scope flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mc-eyebrow">Mindcraft</div>
          <div className="mc-title text-[26px] leading-tight">
            Today {hms(snapshot.today.seconds)} <span className="text-white/45">/ {hms(snapshot.targetSeconds)}</span> <span className="text-[17px] text-white/60">· {book.owner.find(day => day.date === snapshot.date)?.xp ?? snapshot.today.xp} XP</span>
          </div>
          {vow && (
            <div className="mc-note" style={{ fontSize: 21 }}>
              {vow.label}. A day kept counts <span className="text-emerald-300">double</span>; a missing minute costs <span className="text-rose-300">{vow.penaltyPerMinute} XP</span>.
            </div>
          )}
        </div>
        <label className="mc-field flex items-center gap-2 px-2.5 py-1.5" title="What a minute is worth when no agent and no mission is open">
          Valor with nothing in focus
          <select
            value={String(snapshot.settings.freeValor)}
            onChange={event => { void post({ settings: { freeValor: Number(event.target.value) } }) }}
            onKeyDown={event => event.stopPropagation()}
            className="rounded border border-white/15 bg-black/50 px-1 py-0.5 text-white"
          >
            {[...new Set([0, 0.3, 0.5, 0.7, 0.8, 1, snapshot.settings.freeValor])].sort((a, b) => a - b).map(value => <option key={value} value={String(value)}>×{value}</option>)}
          </select>
        </label>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2.5 px-1 pb-1">
        {tabs.map(item => (
          <button key={item.id} type="button" onClick={() => setTab(item.id)} className="mc-tab" style={{ minWidth: 220 }} data-on={tab === item.id ? '1' : '0'}>
            <div>{item.label}</div>
            <div>{item.sub}</div>
          </button>
        ))}
      </div>
      {/* Carbon fills the space and scrolls inside its own list; the other tabs scroll here. */}
      <div className={`min-h-0 flex-1 pr-1 ${tab === 'carbon' ? 'flex flex-col' : 'overflow-y-auto'}`}>
        {tab === 'carbon' && <CarbonMissions key={carbonFile || ''} initialFile={carbonFile || null} />}
        {tab === 'today' && <DayList days={book.owner} today={snapshot.date} target={snapshot.targetSeconds} onRemoveManual={removeManual} empty="Nothing counted yet. Time counts while the Oasis is in front and you are doing something." />}
        {tab === 'silicon' && (
          <div className="flex flex-col gap-3">
            {snapshot.agentHours && (
              <div className="mc-card px-3 py-2 text-[14px] leading-snug">
                <div className="mc-strong">The Oasis worked {hms(snapshot.agentHours.today)} today{snapshot.agentHours.mark ? `: ${snapshot.agentHours.mark}` : ''} · yesterday {hms(snapshot.agentHours.yesterday)}</div>
                <div className="text-white/60">24 h of agent work in a day: alive · 72 h: superalive · 168 h: uploaded. An agent-hour is time inside an agent&rsquo;s turns (minus time it only waited on its helpers) plus its helpers&rsquo; time; time between turns doesn&rsquo;t count. Helpers working at once each count.</div>
              </div>
            )}
            {book.agents.length > 0 && (
              <div className="mc-card flex flex-col gap-1 px-3 py-2">
                <div className="mc-strong text-[14px]">All days: who worked longest</div>
                {book.agents.map(agent => (
                  <UnitRow key={agent.key} date="" unit={{ kind: 'agent', label: agent.name, seconds: agent.seconds, xp: agent.xp, ...(agent.mission ? { mission: agent.mission } : {}), ...(typeof agent.priority === 'number' ? { priority: agent.priority } : {}) }} />
                ))}
              </div>
            )}
            <DayList days={book.oasis} today={snapshot.date} target={null} empty="No agent has finished a turn yet while an Oasis page was listening." />
            <AgentMissionBoard />
          </div>
        )}
      </div>
      {tab === 'today' && (
        <ManualTimeForm
          today={snapshot.date}
          targetSeconds={snapshot.targetSeconds}
          daySeconds={date => book.owner.find(day => day.date === date)?.seconds || 0}
          onSaved={() => { void load() }}
        />
      )}
      <div className="mc-foot shrink-0 pt-2 leading-snug" style={{ fontSize: 16, display: tab === 'carbon' ? 'none' : undefined }}>
        Hours are the main number, and XP is time: 1 XP a minute of work, for you and for every agent; 0.7 only for time in the world with nothing in focus. A mission&rsquo;s priority decides what comes next, not what it pays. A day runs from {snapshot.settings.dayStartsAt} to {snapshot.settings.dayStartsAt}.
      </div>
    </div>
  )
}

const WINDOW_Z = 9395
// Nearly full screen (the owner: "honestly, that could be full screen somehow"), between the always-on buttons.
const WINDOW_MAX_WIDTH = 1500
const WINDOW_GAP = 12

/**
 * Where the window may stand: between the always-on overlays that sit above it (the game rail on the
 * left, the key hints on the right), so it opens beside them, never under them (the owner, 2026-11-20).
 * Measured from the page, so a restyled rail or a phone layout needs no change here.
 */
export function clearBand(viewportWidth: number, obstacles: Array<{ left: number; right: number }>): { left: number; right: number } {
  let left = 0
  let right = viewportWidth
  for (const box of obstacles) {
    const middle = (box.left + box.right) / 2
    if (middle < viewportWidth / 2) left = Math.max(left, box.right)
    else right = Math.min(right, box.left)
  }
  // Too narrow beside them (a phone): use the whole width; the window then covers the rail, as before.
  if (right - left < 360) return { left: 0, right: viewportWidth }
  return { left, right }
}

/** Fixed, narrow overlays at an edge that stand above `minZ` (the game rail, the key hints). */
export function overlayObstacles(minZ = WINDOW_Z, ignore = '[data-ui-panel="mindcraft"]'): Array<{ left: number; right: number }> {
  const out: Array<{ left: number; right: number }> = []
  const vw = window.innerWidth
  const vh = window.innerHeight
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('body *'))) {
    const style = getComputedStyle(el)
    if (style.position !== 'fixed' || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue
    const z = Number.parseInt(style.zIndex, 10)
    if (!Number.isFinite(z) || z <= minZ) continue
    if (el.closest(ignore)) continue
    const box = el.getBoundingClientRect()
    // Edge overlays only: narrow, inside the window's height band, not full-screen layers or bars.
    if (box.width <= 0 || box.height <= 0 || box.width > vw * 0.4 || box.bottom < vh * 0.05 || box.top > vh * 0.95) continue
    out.push({ left: box.left, right: box.right })
  }
  return out
}

/** The view as a window over the world. Esc or a click outside closes it. */
export function MindcraftWindow() {
  const kitStyle = useKitStyle()
  const [open, setOpen] = useState(false)
  const [carbonFile, setCarbonFile] = useState<string | null>(null)
  useEffect(() => {
    const onOpen = (event: Event) => {
      const file = (event as CustomEvent<{ carbon?: string }>).detail?.carbon
      setCarbonFile(typeof file === 'string' ? file : null)
      setOpen(true)
    }
    window.addEventListener(MINDCRAFT_EVENT, onOpen)
    return () => window.removeEventListener(MINDCRAFT_EVENT, onOpen)
  }, [])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open])
  // Beside the always-on buttons, not under them: measured on open and on every resize.
  const [band, setBand] = useState<{ left: number; right: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => setBand(clearBand(window.innerWidth, overlayObstacles()))
    measure()
    const late = window.setTimeout(measure, 300) // overlays that settle after the first paint
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(late)
      window.removeEventListener('resize', measure)
    }
  }, [open])
  if (!open) return null
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  const area = band || { left: 0, right: vw }
  const width = Math.max(0, Math.min(WINDOW_MAX_WIDTH, area.right - area.left - WINDOW_GAP * 2))
  const left = area.left + (area.right - area.left - width) / 2
  return (
    <>
      <div className="fixed inset-0 z-[9390] bg-slate-950/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div
        data-ui-panel="mindcraft"
        // A kit panel (Hipster's UI kit), so the one menu-style switch reaches Mindcraft too.
        data-kit-style={kitStyle}
        className="kit-panel fixed top-[5%] z-[9395] flex h-[90%] flex-col px-2 pb-1 pt-0"
        style={{ left, width }}
      >
        <button type="button" onClick={() => setOpen(false)} title="Close (Esc)" className="mc-scope absolute right-1 top-1 z-10"><span className="mc-close flex items-center justify-center">✕</span></button>
        <MindcraftView carbonFile={carbonFile} />
      </div>
    </>
  )
}
