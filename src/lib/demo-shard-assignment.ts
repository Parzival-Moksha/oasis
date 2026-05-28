export interface DemoShardCandidate {
  id: string
  players: number
  createdAt: Date
  name?: string
  shortCode?: string | null
}

export type DemoShardAssignmentChoice =
  | { type: 'existing'; candidate: DemoShardCandidate }
  | { type: 'create' }
  | { type: 'full' }

function leastFilled(items: DemoShardCandidate[]): DemoShardCandidate | null {
  return items
    .slice()
    .sort((a, b) => a.players - b.players || a.createdAt.getTime() - b.createdAt.getTime())[0] || null
}

export function chooseDemoShardAssignment(
  candidates: DemoShardCandidate[],
  options: { targetCap: number; hardCap: number; maxShards: number },
): DemoShardAssignmentChoice {
  const underTarget = leastFilled(candidates.filter(world => world.players < options.targetCap))
  if (underTarget) return { type: 'existing', candidate: underTarget }

  if (candidates.length < options.maxShards) return { type: 'create' }

  const underHard = leastFilled(candidates.filter(world => world.players < options.hardCap))
  if (underHard) return { type: 'existing', candidate: underHard }

  return { type: 'full' }
}
