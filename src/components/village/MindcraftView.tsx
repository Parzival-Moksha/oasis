'use client'

// ░▒▓ MINDCRAFT — the list of days: what was worked on, how long, how much XP ▓▒░
// Self-contained: <MindcraftView /> fills whatever holds it (a menu tile's page, a window) and needs
// nothing but /api/village/work. <MindcraftWindow /> is the same view as a window over the world; it
// opens on the `oasis:open-mindcraft` window event (openMindcraft()).
//
// Tabs: Mine (the owner's days), The Oasis (all agents together), and one per agent. A day is one
// row; click it and it opens into its units of work: one per mission, one for time with agents, one
// for just being in the Oasis. Never a row per turn.

import { useCallback, useEffect, useState } from 'react'
import { useMindcraftLook } from './mindcraft-look'
import { ManualTimeForm } from './ManualTimeForm'
import { formatClock, type MindcraftBook, type MindcraftDay, type WorkSnapshot, type WorkUnit } from '../../lib/village/work-vow'

const UNIT_COLOR = { mission: '#38bdf8', agent: '#c084fc', free: '#34d399', manual: '#f59e0b' }

export const MINDCRAFT_EVENT = 'oasis:open-mindcraft'

/** Open the Mindcraft window from anywhere (a menu tile, a key, the work counter). */
export function openMindcraft(): void {
  window.dispatchEvent(new CustomEvent(MINDCRAFT_EVENT))
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
          {/* An agent's XP is its minutes × its mission's priority: say which mission, and the rate. */}
          {unit.kind === 'agent' && !unit.parts && (
            <span className="text-white/55">
              {unit.mission
                ? <> · counted for “{unit.mission}”{typeof unit.priority === 'number' ? <> at {unit.priority} XP a minute (that mission&rsquo;s priority)</> : null}</>
                : <> · no mission names it: hours, no XP</>}
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

export function MindcraftView() {
  useMindcraftLook() // the look (textures, typefaces) lives in mindcraft-look.tsx; this file carries its class names
  const [book, setBook] = useState<MindcraftBook | null>(null)
  const [snapshot, setSnapshot] = useState<WorkSnapshot | null>(null)
  const [tab, setTab] = useState<'you' | 'agents'>('you')
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
    { id: 'you' as const, label: 'You', sub: `${hms(book.totals.owner.seconds)} · ${book.totals.owner.xp} XP` },
    { id: 'agents' as const, label: 'The Agents', sub: `${hms(book.totals.oasis.seconds)} · ${book.totals.oasis.xp} XP` },
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
          <button key={item.id} type="button" onClick={() => setTab(item.id)} className="mc-tab" style={{ minWidth: 260 }} data-on={tab === item.id ? '1' : '0'}>
            <div>{item.label}</div>
            <div>{item.sub}</div>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === 'you' && <DayList days={book.owner} today={snapshot.date} target={snapshot.targetSeconds} onRemoveManual={removeManual} empty="Nothing counted yet. Time counts while the Oasis is in front and you are doing something." />}
        {tab === 'agents' && (
          <div className="flex flex-col gap-3">
            {book.agents.length > 0 && (
              <div className="mc-card flex flex-col gap-1 px-3 py-2">
                <div className="mc-strong text-[14px]">All days: who worked longest</div>
                {book.agents.map(agent => (
                  <UnitRow key={agent.key} date="" unit={{ kind: 'agent', label: agent.name, seconds: agent.seconds, xp: agent.xp, ...(agent.mission ? { mission: agent.mission } : {}), ...(typeof agent.priority === 'number' ? { priority: agent.priority } : {}) }} />
                ))}
              </div>
            )}
            <DayList days={book.oasis} today={snapshot.date} target={null} empty="No agent has finished a turn yet while an Oasis page was listening." />
          </div>
        )}
      </div>
      {tab === 'you' && (
        <ManualTimeForm
          today={snapshot.date}
          targetSeconds={snapshot.targetSeconds}
          daySeconds={date => book.owner.find(day => day.date === date)?.seconds || 0}
          onSaved={() => { void load() }}
        />
      )}
      <div className="mc-foot shrink-0 pt-2 leading-snug" style={{ fontSize: 21 }}>
        Hours are the main number. You earn 1 XP a minute with an agent or a mission open, {snapshot.settings.freeValor} with nothing open; an agent earns its minutes × its mission&rsquo;s priority. A day runs from {snapshot.settings.dayStartsAt} to {snapshot.settings.dayStartsAt}.
      </div>
    </div>
  )
}

/** The view as a window over the world. Esc or a click outside closes it. */
export function MindcraftWindow() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onOpen = () => setOpen(true)
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
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-[9390] bg-slate-950/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div
        data-ui-panel="mindcraft"
        data-jewels="1"
        className="oasis-frame fixed left-1/2 top-[5%] z-[9395] flex h-[90%] w-[min(900px,calc(100vw-32px))] -translate-x-1/2 flex-col px-2 pb-1 pt-0"
      >
        <button type="button" onClick={() => setOpen(false)} title="Close (Esc)" className="mc-scope absolute right-1 top-1 z-10"><span className="mc-close flex items-center justify-center">✕</span></button>
        <MindcraftView />
      </div>
    </>
  )
}
