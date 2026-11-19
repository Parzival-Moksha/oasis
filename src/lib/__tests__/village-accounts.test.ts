// How the page words the Claude accounts (village-accounts.ts).
import { describe, expect, it } from 'vitest'
import { accountChoices, accountPieces, shownAccounts } from '../village/village-accounts'
import type { EngineAccount, EngineAccountsView } from '../agent-engine-types'

const NOW = new Date(2026, 10, 19, 12, 0).getTime()
const acct = (o: Partial<EngineAccount>): EngineAccount => ({ id: 'x', label: 'X', email: null, plan: null, priority: 1, cli: false, sameAs: null, exhaustedUntil: null, why: null, windows: {}, ...o })
const view = (accounts: EngineAccount[]): EngineAccountsView => ({ villageDefault: 'auto', firstReset: null, allExhausted: false, accounts })

describe('village accounts wording', () => {
  it('leaves the CLI login out when it is the same account as a token one', () => {
    const v = view([acct({ id: 'gmail', label: 'Gmail Ultra' }), acct({ id: 'cli', label: 'CLI login', cli: true, sameAs: 'gmail' })])
    expect(shownAccounts(v).map(a => a.id)).toEqual(['gmail'])
    expect(accountChoices(v).map(c => c.value)).toEqual(['auto', 'gmail'])
  })

  it('one short piece per account: the week first, out with its time', () => {
    const v = view([
      acct({ id: 'gmail', label: 'Gmail Ultra', windows: { seven_day: { utilization: 0.92, resetsAt: null, status: 'allowed_warning', at: NOW }, five_hour: { utilization: null, resetsAt: null, status: 'allowed', at: NOW } } }),
      acct({ id: 'yahoo', label: 'Yahoo Max', exhaustedUntil: new Date(2026, 10, 19, 13, 20).getTime(), why: 'five_hour limit' }),
      acct({ id: 'cli', label: 'CLI login', cli: true }),
    ])
    expect(accountPieces(v, NOW).map(p => [p.text, p.out])).toEqual([['Gmail 5h unknown · week 92%', false], ['Yahoo out until 13:20', true], ['CLI 5h unknown · week unknown', false]])
    expect(accountPieces(v, NOW)[0].title).toContain('5-hour window: usage unknown (the CLI sent no figure)')
    expect(accountPieces(v, NOW)[1].title).toContain('five_hour limit')
  })

  it('says nothing while the CLI login is the only account and nothing is out', () => {
    expect(accountPieces(view([acct({ id: 'cli', cli: true, windows: { seven_day: { utilization: 0.5, resetsAt: null, status: null, at: NOW } } })]), NOW)).toEqual([])
    expect(accountPieces(null, NOW)).toEqual([])
  })
})
