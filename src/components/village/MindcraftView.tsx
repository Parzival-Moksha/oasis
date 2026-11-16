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
import { formatClock, type MindcraftBook, type MindcraftDay, type WorkSnapshot } from '../../lib/village/work-vow'

const UNIT_COLOR = { mission: '#38bdf8', agent: '#c084fc', free: '#34d399', manual: '#f59e0b' }

export const MINDCRAFT_EVENT = 'oasis:open-mindcraft'

/** Open the Mindcraft window from anywhere (a menu tile, a key, the work counter). */
export function openMindcraft(): void {
  window.dispatchEvent(new CustomEvent(MINDCRAFT_EVENT))
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function DayList({ days, today, target, empty }: { days: MindcraftDay[]; today: string; target: number | null; empty: string }) {
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
              <span className="mc-strong w-[124px] shrink-0 text-[13px]">{dayLabel(day.date)}{day.date === today ? ' · today' : ''}</span>
              <span className="mc-track min-w-0 flex-1">
                <span className="block h-full" style={{ width: `${(day.seconds / (target ? Math.max(target, top) : top)) * 100}%`, background: hit ? '#34d399' : '#fbbf24' }} />
              </span>
              <span className="w-[66px] shrink-0 text-right tabular-nums">{formatClock(day.seconds)}</span>
              <span className="w-[72px] shrink-0 text-right font-bold tabular-nums" style={{ color: hit ? '#34d399' : '#fde68a' }}>{day.xp} XP</span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-2">
                {day.units.map((unit, index) => (
                  <div key={index} className="flex items-center gap-3 text-white/85">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: UNIT_COLOR[unit.kind] }} />
                    <span className="min-w-0 flex-1 truncate">{unit.label}{unit.mission ? <span className="text-white/45"> · {unit.mission}</span> : null}</span>
                    <span className="w-[66px] shrink-0 text-right tabular-nums text-white/70">{formatClock(unit.seconds)}</span>
                    <span className="w-[72px] shrink-0 text-right tabular-nums">{unit.xp} XP</span>
                  </div>
                ))}
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
  const [tab, setTab] = useState<string>('mine')
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

  const setValor = async (value: number) => {
    await fetch('/api/village/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { freeValor: value } }) }).catch(() => null)
    void load()
  }

  if (error && !book) return <div className="p-6 text-rose-200">Mindcraft can&rsquo;t read the work book: {error}</div>
  if (!book || !snapshot) return <div className="p-6 text-white/50">Opening the book…</div>

  const agent = book.agents.find(item => item.key === tab)
  const tabs = [
    { id: 'mine', label: 'Mine', sub: `${formatClock(book.totals.owner.seconds)} · ${book.totals.owner.xp} XP` },
    { id: 'oasis', label: 'The Oasis', sub: `${formatClock(book.totals.oasis.seconds)} · ${book.totals.oasis.xp} XP` },
    ...book.agents.map(item => ({ id: item.key, label: item.name, sub: `${formatClock(item.seconds)} · ${item.xp} XP` })),
  ]
  const vow = snapshot.commitments[0]
  return (
    <div className="mc-scope flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mc-eyebrow">Mindcraft</div>
          <div className="mc-title text-[26px] leading-tight">
            Today {formatClock(snapshot.today.seconds)} <span className="text-white/45">/ {formatClock(snapshot.targetSeconds)}</span> · {snapshot.today.xp} XP
          </div>
          {vow && (
            <div className="mc-note">
              {vow.label}: a day hit <span className="text-emerald-300">×{vow.multiplier}</span>, a missing minute <span className="text-rose-300">−{vow.penaltyPerMinute} XP</span>. So far {snapshot.totals.xp} + {snapshot.totals.bonusXp} − {snapshot.totals.penaltyXp} = <span className="font-bold text-white">{snapshot.totals.netXp} XP</span>.
            </div>
          )}
        </div>
        <label className="mc-field flex items-center gap-2 px-2.5 py-1.5" title="What a minute is worth when no agent and no mission is open">
          Valor with nothing in focus
          <select
            value={String(snapshot.settings.freeValor)}
            onChange={event => { void setValor(Number(event.target.value)) }}
            onKeyDown={event => event.stopPropagation()}
            className="rounded border border-white/15 bg-black/50 px-1 py-0.5 text-white"
          >
            {[...new Set([0, 0.3, 0.5, 0.7, 0.8, 1, snapshot.settings.freeValor])].sort((a, b) => a - b).map(value => <option key={value} value={String(value)}>×{value}</option>)}
          </select>
        </label>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2.5 px-1 pb-1">
        {tabs.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className="mc-tab"
            data-on={tab === item.id ? '1' : '0'}
          >
            <div>{item.label}</div>
            <div>{item.sub}</div>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === 'mine' && <DayList days={book.owner} today={snapshot.date} target={snapshot.targetSeconds} empty="Nothing counted yet. Time counts while the Oasis is in front and you are doing something." />}
        {tab === 'oasis' && <DayList days={book.oasis} today={snapshot.date} target={null} empty="No agent has finished a turn yet while an Oasis page was listening." />}
        {agent && <DayList days={agent.days} today={snapshot.date} target={null} empty="Nothing yet." />}
      </div>
      {tab === 'mine' && <ManualTimeForm today={snapshot.date} onSaved={() => { void load() }} />}
      <div className="mc-foot shrink-0 pt-2 leading-snug">
        {snapshot.rule} A day runs from {snapshot.settings.dayStartsAt} to {snapshot.settings.dayStartsAt}. One row per mission, per agent and for the Oasis each day, never one per turn.
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
        className="fixed left-1/2 top-[5%] z-[9395] flex h-[90%] w-[min(900px,calc(100vw-32px))] -translate-x-1/2 flex-col px-3 pb-2 pt-3"
        style={{
          // The spell book's materials (Hipster, 2026-11-16): a painted iron frame, nine-sliced so its
          // jewelled corners keep their shape, around a dark page.
          border: '46px solid transparent',
          borderImage: 'url(/ui/rail/frame-large.png) 118 / 46px / 5px stretch',
          // The page runs under the frame, to its edge: nothing of the world shows between the two.
          background: 'linear-gradient(180deg, rgba(13,15,22,0.9) 0%, rgba(9,10,15,0.95) 100%) border-box, url(/ui/spellbook/frame/page-bg-agent.jpg) center / cover border-box',
          borderRadius: 10,
          boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
        }}
      >
        <button type="button" onClick={() => setOpen(false)} title="Close (Esc)" className="mc-scope absolute right-1 top-1 z-10"><span className="mc-close flex items-center justify-center">✕</span></button>
        <MindcraftView />
      </div>
    </>
  )
}
