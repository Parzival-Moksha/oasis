// ░▒▓ VILLAGE INTERRUPT — is there a running turn to interrupt? ▓▒░
// The engine reports "working" for more than a running turn (messages waiting in its queue after the
// turn ended) and "needs-decision" for a finished turn that ended on one. Interrupt only means
// something while a turn runs: working on it, or stopped mid-turn on an open permission / question.

export interface InterruptableAgent {
  status: string
  statusReason?: string | null
  /** Open permission / question / plan requests. */
  decisions?: ReadonlyArray<unknown> | null
}

/** Engine reasons that say "working" while no turn runs: only queued messages are left. */
const QUEUED_ONLY = /^\d+ queued message/

export function canInterrupt(agent: InterruptableAgent | null | undefined): boolean {
  if (!agent) return false
  if (agent.status === 'working') return !QUEUED_ONLY.test(agent.statusReason || '')
  // A decision that is still open holds the turn; one left over from a finished turn does not.
  if (agent.status === 'needs-decision') return Boolean(agent.decisions && agent.decisions.length > 0)
  return false
}
