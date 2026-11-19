'use client'

// Settings > Agents > Claude accounts: the accounts the village's agents run on (engine accounts.js), how full each
// is, which is out until when, and the village's default. Tokens are added in a terminal (scripts/add-account.mjs),
// never here: a token typed into a page could end up in its state or a log.

import { useOasisStore } from '@/store/oasisStore'
import { getAgentEngineClient } from '@/lib/agent-engine-client'
import { accountChoices, mainWindow, shownAccounts } from '@/lib/village/village-accounts'

const ADD = 'node C:\\af_oasis\\packages\\oasis-agent-engine\\scripts\\add-account.mjs'

export function AccountsSettings() {
  const view = useOasisStore(s => s.agentEngine.connection.server?.accounts || null)
  const now = Date.now()
  return (
    <section data-accounts-settings>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Claude accounts</div>
      {!view && <div className="text-[11px] text-amber-300 mb-2">The agent engine is older than accounts: restart it to see them.</div>}
      {view && (
        <>
          <div className="text-[10px] text-gray-500 mb-2">
            When one account runs out of usage, agents go on on the next by themselves, also at night. In auto they use
            the account whose week ends first, so neither account&apos;s tokens are left at a reset.
          </div>
          {shownAccounts(view).map(account => {
            const out = Boolean(account.exhaustedUntil && account.exhaustedUntil > now)
            const w = mainWindow(account)
            return (
              <div key={account.id} className="flex items-center justify-between gap-2 py-1 text-xs" data-account-row={account.id}>
                <span className="min-w-0 truncate text-gray-300" title={account.email || undefined}>
                  {account.cli ? 'CLI login' : account.label}
                  <span className="text-gray-500">{account.plan ? ` · ${account.plan}` : ''}</span>
                </span>
                <span className={out ? 'shrink-0 text-amber-300' : 'shrink-0 text-gray-400'}>
                  {out
                    ? `out until ${new Date(account.exhaustedUntil!).toString().slice(4, 21)}`
                    : w ? `${Math.round(w.utilization * 100)}% of its ${w.name === 'seven_day' ? 'week' : w.name.replace('_', '-')}` : 'no usage seen yet'}
                </span>
              </div>
            )
          })}
          <label className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-sm text-gray-300">Village default</span>
            <select
              value={view.villageDefault}
              onChange={event => { void getAgentEngineClient().setDefaultAccount(event.target.value).catch(() => {}) }}
              className="max-w-[180px] rounded border border-white/15 bg-black/40 px-1 py-0.5 text-xs text-white"
              data-accounts-default
            >
              {accountChoices(view).map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
          </label>
          <div className="text-[10px] text-gray-500">
            To add an account: sign in to claude.ai with it, run <code className="text-gray-400">claude setup-token</code> in
            PowerShell, then <code className="text-gray-400">{ADD}</code> and paste the token there. Each agent can be pinned to
            one in its session panel (account).
          </div>
        </>
      )}
    </section>
  )
}
