'use client'

// ░▒▓ ADD TIME BY HAND — for a day the counter missed (it was broken, or the work was elsewhere) ▓▒░
// A small, plain form: the day, hours and minutes, and why. It posts to /api/village/work and the
// entry shows as "Added by hand: <reason>" everywhere. Self-contained; skin it from outside.

import { useState } from 'react'

export function ManualTimeForm({ today, onSaved }: { today: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(today)
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const field = 'rounded border border-white/15 bg-black/50 px-1.5 py-1 text-[12px] text-white outline-none focus:border-emerald-300/60'

  /** "2:30", "2h 30", "150" (minutes), "1.5h". */
  const minutes = (() => {
    const text = time.trim().toLowerCase()
    if (!text) return 0
    const clock = /^(\d{1,2}):(\d{1,2})$/.exec(text)
    if (clock) return Number(clock[1]) * 60 + Number(clock[2])
    const hours = /^(\d+(?:[.,]\d+)?)\s*h(?:\s*(\d{1,2}))?/.exec(text)
    if (hours) return Math.round(Number(hours[1].replace(',', '.')) * 60) + Number(hours[2] || 0)
    return /^\d+$/.test(text) ? Number(text) : 0
  })()

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/village/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manual: { date, minutes, reason } }) })
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || `HTTP ${response.status}`)
      setTime('')
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
      <button type="button" data-mindcraft="manual-open" onClick={() => setOpen(true)} className="self-start rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/80 hover:bg-white/15">
        + add time by hand
      </button>
    )
  }
  return (
    <div data-mindcraft="manual-form" className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2 text-[12px] text-white" onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }}>
      <input type="date" value={date} onChange={event => setDate(event.target.value)} className={field} />
      <input value={time} onChange={event => setTime(event.target.value)} placeholder="2:30 or 150 min" className={`${field} w-[120px]`} />
      <input value={reason} onChange={event => setReason(event.target.value)} placeholder="why (it is shown with the entry)" className={`${field} min-w-[200px] flex-1`} />
      <button type="button" disabled={busy || !minutes || !reason.trim()} onClick={() => { void save() }} className="rounded-md border border-emerald-300/45 bg-emerald-400/20 px-2.5 py-1 text-[11px] font-bold text-emerald-50 hover:bg-emerald-400/35 disabled:opacity-40">
        add {minutes ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : ''}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-bold hover:bg-white/15">cancel</button>
      {error && <span className="w-full text-rose-300">{error}</span>}
    </div>
  )
}
