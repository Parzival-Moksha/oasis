'use client'

// ░▒▓ ADD TIME BY HAND — for a day the counter missed (it was broken, or the work was elsewhere) ▓▒░
// Hours and minutes are two separate boxes, so "15" in the minutes box can only mean fifteen minutes,
// and the line under them says in words what will be added before anything is saved. It posts to
// /api/village/work; the entry shows as "Added by hand: <reason>" everywhere and can be deleted in
// the day's list. Self-contained; skin it from outside (data-mindcraft hooks).

import { useState } from 'react'
import { formatClock } from '../../lib/village/work-vow'

/** "2 hours 5 minutes", "15 minutes". */
export function spokenDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || 'nothing'
}

export function ManualTimeForm({ today, daySeconds, targetSeconds, onSaved }: {
  today: string
  /** Seconds already on a day (for the preview's "the day becomes"). */
  daySeconds?: (date: string) => number
  targetSeconds?: number
  onSaved?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(today)
  const [hours, setHours] = useState('')
  const [mins, setMins] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const field = 'rounded border border-white/15 bg-black/50 px-1.5 py-1 text-[14px] text-white outline-none focus:border-emerald-300/60'

  const whole = (text: string) => (/^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : text.trim() ? NaN : 0)
  const h = whole(hours)
  const m = whole(mins)
  const valid = Number.isFinite(h) && Number.isFinite(m) && h <= 24 && m <= 59
  const minutes = valid ? h * 60 + m : 0
  const before = daySeconds ? daySeconds(date) : null
  const after = before === null ? null : before + minutes * 60

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/village/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manual: { date, minutes, reason } }) })
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || `HTTP ${response.status}`)
      setHours('')
      setMins('')
      setReason('')
      setOpen(false)
      onSaved?.()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" data-mindcraft="manual-open" onClick={() => setOpen(true)} className="self-start rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[13px] font-bold text-white/80 hover:bg-white/15">
        + add time by hand
      </button>
    )
  }
  return (
    <div data-mindcraft="manual-form" className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-[14px] text-white" onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={event => setDate(event.target.value)} className={field} />
        <label className="flex items-center gap-1.5">
          <input inputMode="numeric" value={hours} onChange={event => setHours(event.target.value)} placeholder="0" aria-label="hours" className={`${field} w-[56px] text-right`} />
          hours
        </label>
        <label className="flex items-center gap-1.5">
          <input inputMode="numeric" value={mins} onChange={event => setMins(event.target.value)} placeholder="0" aria-label="minutes" className={`${field} w-[56px] text-right`} />
          minutes
        </label>
        <input value={reason} onChange={event => setReason(event.target.value)} placeholder="why (it is shown with the entry)" className={`${field} min-w-[220px] flex-1`} />
      </div>
      <div data-mindcraft="manual-preview" className="text-[14px]" style={{ color: !valid ? '#fca5a5' : minutes ? '#fde68a' : 'rgba(255,255,255,0.55)' }}>
        {!valid
          ? 'Whole numbers only: hours up to 24, minutes up to 59.'
          : minutes
            ? <>This adds <b>{spokenDuration(minutes)}</b> to {date}{after !== null && before !== null ? <>: the day goes from {formatClock(before)} to <b>{formatClock(after)}</b>{targetSeconds ? (after >= targetSeconds ? ', which keeps the day' : `, still ${formatClock(targetSeconds - after)} short`) : ''}</> : null}. It earns {minutes} XP before the commitment.</>
            : 'Fill in hours, minutes, or both.'}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || !minutes || !reason.trim()} onClick={() => { void save() }} className="rounded-md border border-emerald-300/45 bg-emerald-400/20 px-3 py-1 text-[13px] font-bold text-emerald-50 hover:bg-emerald-400/35 disabled:opacity-40">
          {minutes ? `add ${spokenDuration(minutes)}` : 'add'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[13px] font-bold hover:bg-white/15">cancel</button>
        {minutes > 0 && !reason.trim() && <span className="text-white/55">Say why, then it can be added.</span>}
        {error && <span className="text-rose-300">{error}</span>}
      </div>
    </div>
  )
}
