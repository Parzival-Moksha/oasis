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

/** "5h 70%", "week 8%", "5h unknown": one window, as the CLI last reported it; unknown when no figure was sent. */
export function windowText(account: EngineAccount, name: 'five_hour' | 'seven_day'): string {
  const w = account.windows?.[name]
  const short = name === 'five_hour' ? '5h' : 'week'
  return `${short} ${w && typeof w.utilization === 'number' ? `${Math.round(w.utilization * 100)}%` : 'unknown'}`
}

/** The tooltip line for one window: the figure, when the CLI said it, and when the window resets. */
function windowTitle(account: EngineAccount, name: 'five_hour' | 'seven_day'): string {
  const w = account.windows?.[name]
  const what = name === 'five_hour' ? '5-hour window' : 'weekly window'
  if (!w) return `${what}: unknown (no turn on this account reported it yet)`
  const figure = typeof w.utilization === 'number' ? `${Math.round(w.utilization * 100)}% used` : 'usage unknown (the CLI sent no figure)'
  return `${what}: ${figure}, as of ${clock(w.at)}${w.resetsAt ? `, resets ${new Date(w.resetsAt).toString().slice(0, 21)}` : ''}`
}

/** One piece per account for the Agents list: "Yahoo 5h 70% · week 8%", "Gmail out until 08:00". */
export function accountPieces(view: EngineAccountsView | null | undefined, now = Date.now()): Array<{ id: string; text: string; out: boolean; title: string }> {
  const list = shownAccounts(view)
  // Only the CLI login and nothing out: one account, nothing to compare.
  if (list.length <= 1 && !list.some(a => a.exhaustedUntil && a.exhaustedUntil > now)) return []
  return list.map(account => {
    const out = Boolean(account.exhaustedUntil && account.exhaustedUntil > now)
    const text = out ? `${shortLabel(account)} out until ${clock(account.exhaustedUntil!)}` : `${shortLabel(account)} ${windowText(account, 'five_hour')} · ${windowText(account, 'seven_day')}`
    const head = `${account.label}${account.email ? ` (${account.email})` : ''}${account.plan ? `, ${account.plan}` : ''}`
    const title = [head, ...(out ? [`out of usage (${account.why || 'limit'}) until ${new Date(account.exhaustedUntil!).toString().slice(0, 21)}`] : []), windowTitle(account, 'five_hour'), windowTitle(account, 'seven_day')].join('\n')
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
