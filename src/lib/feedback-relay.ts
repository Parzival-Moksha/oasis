// ░▒▓ FEEDBACK RELAY — Help → Feedback also reaches the village's Debugger agent ▓▒░
//
// The feedback is always saved to analytics first. When the agent engine is connected and an
// owned agent whose name looks like "Debugger" is in the village, the same words go to it as a
// message, so a bug dropped in Help gets picked up without anyone writing a prompt.

export interface RelayAgentLike {
  id: string
  name: string
  owned: boolean
  alive?: boolean
}

export const DEBUGGER_NAME_PATTERN = /debugger/i

/** The owned agent to send feedback to: name matches /debugger/i; a live one wins over a stopped one. */
export function findDebuggerAgent<T extends RelayAgentLike>(agents: Iterable<T>): T | null {
  let fallback: T | null = null
  for (const agent of agents) {
    if (!agent || !agent.owned || !DEBUGGER_NAME_PATTERN.test(agent.name || '')) continue
    if (agent.alive !== false) return agent
    fallback ??= agent
  }
  return fallback
}

export function formatFeedbackMessage(input: { worldId: string | null | undefined; path: string | null | undefined; text: string }): string {
  const world = input.worldId?.trim() || 'none'
  const path = input.path?.trim() || '/'
  return `New Oasis feedback (world ${world}, ${path}): ${input.text.trim()}`
}

export type FeedbackRelayResult = 'sent' | 'no-debugger' | 'offline' | 'failed'

export interface FeedbackRelayDeps {
  agents: Iterable<RelayAgentLike>
  isOpen: boolean
  send: (agentId: string, text: string) => Promise<unknown>
}

/** Never throws: feedback is already saved, the relay is a bonus. */
export async function relayFeedbackToDebugger(
  feedback: { worldId: string | null | undefined; path: string | null | undefined; text: string },
  deps: FeedbackRelayDeps,
): Promise<FeedbackRelayResult> {
  if (!deps.isOpen) return 'offline'
  const agent = findDebuggerAgent(deps.agents)
  if (!agent) return 'no-debugger'
  try {
    await deps.send(agent.id, formatFeedbackMessage(feedback))
    return 'sent'
  } catch {
    return 'failed'
  }
}
