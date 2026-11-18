// ░▒▓ VILLAGE SCHEDULE — how the page words an agent's next wake-up (engine schedule.js keeps the schedule) ▓▒░
// Pure, tested in src/lib/__tests__/village-schedule.test.ts.

import type { EngineSchedule, EngineScheduleEvery } from '../agent-engine-types'

export const SCHEDULE_CHOICES: Array<{ every: EngineScheduleEvery; label: string }> = [
  { every: 'off', label: 'Off' },
  { every: 'hourly', label: 'Every hour' },
  { every: '3h', label: 'Every 3 hours' },
  { every: '6h', label: 'Every 6 hours' },
  { every: 'daily', label: 'Daily' },
  { every: 'weekly', label: 'Weekly' },
]

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad = (n: number) => String(n).padStart(2, '0')

/** "14:00", "tomorrow 09:00", "Wed 16:20", "25 Nov 16:20". */
export function formatWake(at: number, now = Date.now()): string {
  const d = new Date(at)
  const n = new Date(now)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(d) - day(n)) / 86_400_000)
  if (days === 0) return time
  if (days === 1) return `tomorrow ${time}`
  if (days > 1 && days < 7) return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${time}`
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })} ${time}`
}

/** The line in the Agents list: "wakes 14:00", or null when nothing wakes it. */
export function wakeLine(nextWake: { at: number; label: string } | null | undefined, now = Date.now()): string | null {
  if (!nextWake || !Number.isFinite(nextWake.at)) return null
  return nextWake.at <= now ? 'wakes now' : `wakes ${formatWake(nextWake.at, now)}`
}

/** Does the time input apply? The intervals take one too: the first slot of the day. */
export function scheduleTakesTime(every: EngineScheduleEvery): boolean {
  return every !== 'off'
}

export function scheduleSummary(schedule: EngineSchedule | null | undefined): string {
  if (!schedule || schedule.every === 'off') return 'off'
  const at = schedule.at || '00:00'
  switch (schedule.every) {
    case 'hourly': return at.endsWith(':00') ? 'every hour' : `every hour at :${at.slice(3)}`
    case '3h': return `every 3 hours${at !== '00:00' ? ` from ${at}` : ''}`
    case '6h': return `every 6 hours${at !== '00:00' ? ` from ${at}` : ''}`
    case 'daily': return `daily at ${at}`
    case 'weekly': return `${WEEKDAYS[schedule.day ?? 1]}s at ${at}`
    default: return 'off'
  }
}
