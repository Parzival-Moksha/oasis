// ░▒▓ MISSION DISPATCH — a note left on a mission card reaches an agent, and agents earn XP on their missions ▓▒░
// Pure. The owner (2026-11-16): "Missions should all wait for my interactions, and as soon as I have
// interacted with the mission, like I left a voice note, someone should start working on it… we
// already have a mission agent who could dispatch it to the relevant agent or do it himself."

export interface DispatchAgentLike {
  id: string
  name: string
  owned: boolean
  alive?: boolean
}

/** The mission agent: Morrow, the Mindcraft master (its desk may still say "Mission Wall"). */
export const MISSION_MASTER_PATTERN = /\b(morrow|mission wall|mindcraft)\b/i

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Is this agent named in a mission's `who` line? Whole words, any case ("Anorak" in "owner + Anorak Pro"). */
export function isNamedIn(who: string, agentName: string): boolean {
  const name = agentName.trim()
  return name.length > 1 && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, 'iu').test(who)
}

/**
 * Who gets a note left on a mission card: the mission agent when it is in the village (it does the
 * work or passes it on), else an agent the mission's `who` names. Owned agents only; a live one wins.
 */
export function findMissionAgent<T extends DispatchAgentLike>(agents: Iterable<T>, who: string): { agent: T; as: 'master' | 'named' } | null {
  const owned = [...agents].filter(agent => agent && agent.owned)
  const pick = (list: T[]) => list.find(agent => agent.alive !== false) || list[0] || null
  const master = pick(owned.filter(agent => MISSION_MASTER_PATTERN.test(agent.name || '')))
  if (master) return { agent: master, as: 'master' }
  const named = pick(owned.filter(agent => isNamedIn(who, agent.name || '')))
  return named ? { agent: named, as: 'named' } : null
}

/** The message the agent receives. */
export function formatMissionNote(input: { file: string; title: string; who: string; text: string; dir?: string; villageAgents?: string[] }): string {
  // The folder is this machine's (GET /api/village/settings); without it the agent gets the file's name.
  const dir = (input.dir || '').replace(/[\\/]+$/, '')
  const path = dir ? `${dir}${dir.includes('/') && !dir.includes('\\') ? '/' : '\\'}${input.file}` : input.file
  const others = (input.villageAgents || []).filter(Boolean)
  return [
    `[Mindcraft] The owner left a note on the mission "${input.title}" (${path}):`,
    '',
    input.text.trim(),
    '',
    `The mission's who: ${input.who || 'nobody yet'}.${others.length ? ` Agents in the village now: ${others.join(', ')}.` : ''}`,
    'Do it yourself, or send it to the right village agent. Then write one line in the mission\'s log saying who has it and what happens next (with your guess of the owner\'s reply), and set its state to doing if work starts.',
  ].join('\n')
}

/**
 * The mission an agent's working minutes count on: the highest-priority open mission whose `who`
 * names it. Agent XP = minutes × that mission's priority; no mission, no XP.
 */
export function missionForAgent<T extends { who: string; column: string; priority: number | null }>(missions: T[], agentName: string): T | null {
  let best: T | null = null
  for (const mission of missions) {
    if (mission.column === 'done' || !isNamedIn(mission.who, agentName)) continue
    if (!best || (mission.priority || 0) > (best.priority || 0) || ((mission.priority || 0) === (best.priority || 0) && mission.column === 'doing' && best.column !== 'doing')) best = mission
  }
  return best
}
