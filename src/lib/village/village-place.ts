// ░▒▓ VILLAGE PLACE — where an agent's place is, in words it can read ▓▒░
// Pure, no three.js. The Oasis page reports this line to the agent engine for each agent
// (VillagePresence.tsx); it goes into the agent's card (engine character.js) and from there into the short
// who-you-are note the agent gets. Words, not pictures: a line costs a few dozen tokens once, where a
// picture would cost a few hundred in every turn. Pictures are there on request (scripts/me.mjs around).

import type { Vec3 } from './village-layout'

export interface PlaceThing {
  name: string
  position: Vec3
}

export interface PlaceInput {
  /** Where the agent's avatar stands at its desk, and which way the desk faces (0 = +Z). */
  anchor: Vec3
  rotationY: number
  /** The plaza's centre, when the village has one in this world. */
  plaza?: Vec3 | null
  /** Things in the world: placed objects, crafted scenes, and so on. */
  things: PlaceThing[]
  /** Other agents' desks. */
  neighbours: PlaceThing[]
  /** It has a home here instead of a desk (village-homes.ts), and the ground around it to build on. */
  home?: { buildRadius: number; objects: number; lights: number } | null
}

const NEAR_THINGS = 30
const NEAR_NEIGHBOURS = 8
const MAX_THINGS = 6
const MAX_NEIGHBOURS = 4

const DIRECTIONS = ['ahead', 'ahead to the right', 'to the right', 'behind to the right', 'behind', 'behind to the left', 'to the left', 'ahead to the left']

/** Which way `to` lies from `from`, relative to a facing (0 = +Z, like a station's rotationY). */
export function relativeDirection(from: Vec3, rotationY: number, to: Vec3): string {
  const angle = Math.atan2(to[0] - from[0], to[2] - from[2]) - rotationY
  // Seen from above, a positive turn from +Z toward +X is the avatar's left (its right hand is -X when it faces +Z).
  const turn = Math.atan2(Math.sin(angle), Math.cos(angle))
  const sector = Math.round(-turn / (Math.PI / 4))
  return DIRECTIONS[((sector % 8) + 8) % 8]
}

function flat(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

const tidy = (name: string) => name.replace(/[_-]+/g, ' ').replace(/\.(glb|gltf|vrm)$/i, '').replace(/\s+/g, ' ').trim()

/** "Torii gate (9 m ahead)"; several of one kind in the same direction become "3 pine trees (about 6 m to the left)". */
function listThings(input: PlaceInput, things: PlaceThing[], radius: number, max: number): string[] {
  const near = things
    .map(thing => ({ name: tidy(thing.name), distance: flat(input.anchor, thing.position), direction: relativeDirection(input.anchor, input.rotationY, thing.position) }))
    .filter(thing => thing.name && Number.isFinite(thing.distance) && thing.distance <= radius && thing.distance > 0.4)
    .sort((a, b) => a.distance - b.distance)
  const groups = new Map<string, { name: string; direction: string; distance: number; count: number }>()
  for (const thing of near) {
    const key = `${thing.name.toLowerCase()}|${thing.direction}`
    const group = groups.get(key)
    if (group) group.count += 1
    else groups.set(key, { name: thing.name, direction: thing.direction, distance: thing.distance, count: 1 })
  }
  return [...groups.values()].slice(0, max).map(group => {
    const metres = `${Math.max(1, Math.round(group.distance))} m`
    return group.count > 1 ? `${group.count} × ${group.name} (from ${metres} ${group.direction})` : `${group.name} (${metres} ${group.direction})`
  })
}

/**
 * One line: where the desk is, who sits next to it, what is around.
 * "Your desk is 7 m from the plaza's centre, which is ahead of you. Next to you: Rick (3 m to the left). Around you: Torii gate (9 m ahead), …"
 */
export function describePlace(input: PlaceInput): string {
  const parts: string[] = []
  const home = input.home
  if (home) {
    const where = input.plaza
      ? ` ${Math.round(flat(input.anchor, input.plaza))} m from the centre of the village plaza, which is ${relativeDirection(input.anchor, input.rotationY, input.plaza)}`
      : ''
    parts.push(`You have no desk: you live at your own home here,${where} (x ${input.anchor[0].toFixed(1)}, z ${input.anchor[2].toFixed(1)}). The ground within ${home.buildRadius} m of it is yours to build on with the free world tools, at most ${home.objects} objects and ${home.lights} lights of your own (the Oasis must stay fast). To move: node me.mjs home here | <x> <z> | clear.`)
  } else if (input.plaza) {
    const distance = Math.round(flat(input.anchor, input.plaza))
    parts.push(`Your desk is ${distance} m from the centre of the village plaza, which is ${relativeDirection(input.anchor, input.rotationY, input.plaza)}.`)
  } else {
    parts.push('You have a desk in the village.')
  }
  const neighbours = listThings(input, input.neighbours, NEAR_NEIGHBOURS, MAX_NEIGHBOURS)
  if (neighbours.length) parts.push(`Next to you: ${neighbours.join(', ')}.`)
  const things = listThings(input, input.things, NEAR_THINGS, MAX_THINGS)
  parts.push(things.length ? `Around you: ${things.join(', ')}.` : 'Nothing is built near you yet.')
  return parts.join(' ')
}
