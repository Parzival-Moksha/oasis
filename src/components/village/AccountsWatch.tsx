'use client'

// A notice when a Claude account runs out of usage or comes back, and when every account is out (engine accounts.js),
// the way the engine's restart line shows once (ConnectionWarning). The agents go on by themselves either way; this
// only says so. The Agents list shows each account's usage all the time.

import { useEffect, useRef } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { shownAccounts } from '../../lib/village/village-accounts'
import { showNotice } from '../forge/GlobalNotice'

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

export function AccountsWatch() {
  const view = useOasisStore(s => s.agentEngine.connection.server?.accounts || null)
  const seen = useRef<Map<string, number | null> | null>(null)
  useEffect(() => {
    if (!view) return
    const now = Date.now()
    const outNow = new Map(shownAccounts(view).map(a => [a.id, a.exhaustedUntil && a.exhaustedUntil > now ? a.exhaustedUntil : null]))
    const before = seen.current
    seen.current = outNow
    if (!before) return // the first view after a (re)load: nothing changed under the owner's eyes
    for (const account of shownAccounts(view)) {
      const was = before.get(account.id) ?? null
      const is = outNow.get(account.id) ?? null
      const name = account.cli ? 'The CLI login' : account.label
      if (!was && is) showNotice(view.allExhausted ? `Every Claude account is out of usage. The agents wait and go on by themselves at ${clock(view.firstReset || is)} at the latest; the engine checks every 10 minutes, and when you write to one, in case an account comes back sooner.` : `${name} is out of usage until ${clock(is)}: the agents go on on another account.`, 'warn')
      else if (was && !is) showNotice(`${name} is back: the agents use it again.`, 'info')
    }
  }, [view])
  return null
}
