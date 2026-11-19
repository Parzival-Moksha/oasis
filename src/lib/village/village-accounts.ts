// ░▒▓ VILLAGE ACCOUNTS — how the page words the Claude accounts the agents run on (engine accounts.js) ▓▒░
// Pure, tested in src/lib/__tests__/village-accounts.test.ts. Never a token: the engine never sends one.

import type { EngineAccount, EngineAccountsView } from '../agent-engine-types'

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

/** The accounts worth showing: the CLI login is left out when it is the same account as a token one. */
export function shownAccounts(view: EngineAccountsView | null | undefined): EngineAccount[] {
  return (view?.accounts || []).filter(account => !account.sameAs)
}

/** A short name for the HUD: the label's first word ("Gmail Ultra" -> "Gmail"), the CLI login as "CLI". */
export function shortLabel(account: EngineAccount): string {
  if (account.cli) return 'CLI'
  return account.label.split(/\s+/)[0].slice(0, 12) || account.id
}

/** The most telling window: the weekly one when known, else the 5-hour one, else whatever it has. */
export function mainWindow(account: EngineAccount): { name: string; utilization: number } | null {
  const order = ['seven_day', 'five_hour', ...Object.keys(account.windows || {})]
  for (const name of order) {
    const w = account.windows?.[name]
    if (w && typeof w.utilization === 'number') return { name, utilization: w.utilization }
  }
  return null
}

/** One piece per account for the HUD's engine pill: "Gmail 92%", "Yahoo out until 13:20". */
export function accountPieces(view: EngineAccountsView | null | undefined, now = Date.now()): Array<{ id: string; text: string; out: boolean; title: string }> {
  const list = shownAccounts(view)
  // Only the CLI login and nothing known about it: the pill's old "7-day" figure says the same.
  if (list.length <= 1 && !list.some(a => a.exhaustedUntil && a.exhaustedUntil > now)) return []
  return list.map(account => {
    const out = Boolean(account.exhaustedUntil && account.exhaustedUntil > now)
    const w = mainWindow(account)
    const text = out ? `${shortLabel(account)} out until ${clock(account.exhaustedUntil!)}` : `${shortLabel(account)} ${w ? `${Math.round(w.utilization * 100)}%` : '–'}`
    const title = `${account.label}${account.email ? ` (${account.email})` : ''}${account.plan ? `, ${account.plan}` : ''}: ${out ? `out of usage (${account.why || 'limit'}) until ${new Date(account.exhaustedUntil!).toString().slice(0, 21)}` : w ? `${Math.round(w.utilization * 100)}% of its ${w.name === 'seven_day' ? 'week' : w.name.replace('_', '-')} used` : 'no usage known yet'}`
    return { id: account.id, text, out, title }
  })
}

/** The choices for an agent's or the village's account: "auto" first. */
export function accountChoices(view: EngineAccountsView | null | undefined): Array<{ value: string; label: string }> {
  return [
    { value: 'auto', label: 'auto (the one whose week ends first)' },
    ...shownAccounts(view).map(account => ({ value: account.id, label: account.cli ? `CLI login${account.plan ? ` (${account.plan})` : ''}` : account.label })),
  ]
}
