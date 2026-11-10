// When a message in an agent's thread was written: "14:05" today, "yesterday 14:05", "Nov 9, 14:05".

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function hhmm(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatMessageTime(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const at = new Date(ts)
  const today = new Date(now)
  if (sameDay(at, today)) return hhmm(at)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (sameDay(at, yesterday)) return `yesterday ${hhmm(at)}`
  const year = at.getFullYear() !== today.getFullYear() ? ` ${at.getFullYear()}` : ''
  return `${MONTHS[at.getMonth()]} ${at.getDate()}${year}, ${hhmm(at)}`
}

/** Full date and time, for a tooltip. */
export function fullMessageTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  return new Date(ts).toLocaleString()
}
