// ░▒▓ THE COUNCIL (stage) — agents in a circle around the fire; one steps forward, speaks, steps back ▓▒░
// The scene for the weekly meeting (docs/missions/council.md). A moderator drives it with the engine's
// `council` command (packages/oasis-agent-engine/src/stage.js, scripts/council.mjs); the engine hands each
// request to this page, which does the walking (VillageStation, village-follow.ts stepStage) and the talking
// (village-companion.ts), and answers when the step is done.
//
//   start    the agents walk to their places on the circle and turn to the centre
//   prepare  make the clip of a line and say how long it will take; nothing plays
//   forward  an agent steps toward the fire and turns to the owner (to the fire if the owner is not there)
//   speak    it says a line (given, or the spoken line of its next reply) in its own voice; done when the clip ends
//   back     it steps back to its place and turns to the fire again
//   turn     forward + speak + back
//   stop     the voice stops at once; whoever stands in front steps back
//   end      the Council is over: everyone goes back to what they were doing (desk, or following the owner)
//
// One request runs at a time, in the order they arrive, so there is one voice at a time. While a Council is
// on, no agent speaks on its own and nobody walks up to the owner (VillageVoice.tsx, VillageWorld.tsx): the
// members' spoken lines are kept here for `speak next`.

import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { COUNCIL, councilAngle, councilFront, councilPlaces, councilRadius, type CouncilPlace, type CouncilPoint } from '../../lib/village/village-council'
import { useOasisStore } from '../../store/oasisStore'
import { getVillageDesk } from './village-actions'
import { STAGE, isStageWorldName, stageRoute, type StageObstacle } from '../../lib/village/village-stage'
import { ensureVillageAudio, getAgentVoiceSettings, prepareVillageSpeech, setVillageSpeechCouncilOnly, speakVillageAgent, stopVillageSpeech, whenVillageSpeechEnds, type AgentVoiceSettings } from './village-companion'

export interface CouncilRequest {
  action: string
  agentIds?: string[]
  agentId?: string
  text?: string
  next?: boolean
  waitMs?: number
  /** [x, z] of the fire; default: a circle in front of the owner, with the owner on it. */
  center?: [number, number]
  radius?: number
  step?: number
}

/** Where a staged agent has to stand and look. `seq` changes with every new mark. */
export interface CouncilGoal {
  x: number
  z: number
  faceX: number
  faceZ: number
  /** A calm walk (a step forward or back) rather than the pace of gathering. */
  calm: boolean
  seq: number
}

interface Council {
  center: CouncilPoint
  radius: number
  step: number
  members: string[]
  places: Map<string, CouncilPlace>
  /** Who stands in front right now. */
  front: string | null
}

let council: Council | null = null
let version = 0
const listeners = new Set<() => void>()
const goals = new Map<string, CouncilGoal>()
let goalSeq = 0
const settledWaiters = new Map<string, { seq: number; resolve: (ok: boolean) => void; timer: number }>()
/** The members' spoken lines that came in and were not said yet (VillageVoice hands them over). */
const lines = new Map<string, { text: string; at: number }>()
const lineWaiters = new Map<string, (text: string | null) => void>()
/** Bumped by stop and end: whatever is running notices and gives up. */
let run = 0
let chain: Promise<unknown> = Promise.resolve()
let last: { action: string; at: number; ok: boolean; note?: string } | null = null

const MOVE_TIMEOUT_MS = 40_000

// ─── a stage world (lib/village/village-stage.ts): only the cast is there ─────────────────────────

/** Where each cast member of a stage world appears and goes back to (its home there). Empty outside a Council. */
const stageCast = new Map<string, { x: number; z: number; yaw: number }>()
/** Its way in and out: through a gap between the seats when a seat stands behind its place (`door`). */
const stageDoors = new Map<string, { x: number; z: number }>()
let castLeaving: number | null = null

/**
 * What stands around the fire in this world: every crafted object and catalog piece from just outside the circle
 * to where the cast appears (logs, stones). The cast walks in and out between them, not through them.
 */
function stageObstacles(center: CouncilPoint, radius: number): StageObstacle[] {
  const state = useOasisStore.getState()
  const out: StageObstacle[] = []
  const near = (x: number, z: number) => {
    const r = Math.hypot(x - center.x, z - center.z)
    return r > radius + 0.2 && r < radius + STAGE.arriveDistance - 0.2
  }
  for (const scene of state.craftedScenes || []) {
    const at = (state.transforms?.[scene.id]?.position as [number, number, number] | undefined) || scene.position || [0, 0, 0]
    for (const object of scene.objects || []) {
      const x = at[0] + (object.position?.[0] || 0)
      const z = at[2] + (object.position?.[2] || 0)
      if (!near(x, z)) continue
      const size = Array.isArray(object.scale) ? Math.max(...object.scale.map(Number).filter(Number.isFinite)) : Number(object.scale) || 1
      out.push({ x, z, reach: Math.max(0.15, size / 2) })
    }
  }
  for (const piece of state.placedCatalogAssets || []) {
    const at = (state.transforms?.[piece.id]?.position as [number, number, number] | undefined) || piece.position
    if (at && near(at[0], at[2])) out.push({ x: at[0], z: at[2], reach: 0.6 })
  }
  return out
}

/** Is the world the owner is in a stage ("The Council")? */
export function isStageWorldNow(): boolean {
  const state = useOasisStore.getState()
  const id = state.viewingWorldId || state.activeWorldId
  return isStageWorldName(state.worldRegistry.find(world => world.id === id)?.name)
}

/** The cast VillageWorld shows in a stage world (bumps the Council's version when it changes). */
export function getStageCast(): ReadonlyMap<string, { x: number; z: number; yaw: number }> {
  return stageCast
}

function clearStageCast(): void {
  if (castLeaving !== null) {
    window.clearTimeout(castLeaving)
    castLeaving = null
  }
  if (!stageCast.size) return
  stageCast.clear()
  stageDoors.clear()
  notify()
}

/**
 * The owner went to another world: a Council there is over (its circle belongs to the world it was set in), and
 * a stage's cast is gone. The home world shows everyone at their place, as before.
 */
export function noteVillageWorldChanged(): void {
  if (council) endVillageCouncil('the owner went to another world')
  clearStageCast()
}
/** A Council nobody moves on for this long is over (its director forgot `end`, or is gone): everyone goes back. */
const IDLE_END_MS = 20 * 60_000
/** When the last step came, and the engine process the Council started under (hello's server.restart.startedAt). */
let lastStepAt = 0
let engineAtStart: number | null = null
let idleTimer: number | null = null

function armIdleEnd(): void {
  if (idleTimer !== null) window.clearInterval(idleTimer)
  idleTimer = window.setInterval(() => {
    if (!council) return
    if (Date.now() - lastStepAt > IDLE_END_MS) endVillageCouncil('no step for 20 minutes')
  }, 60_000)
}

function engineStartedAt(): number | null {
  const at = (useOasisStore.getState().agentEngine.connection.server as { restart?: { startedAt?: unknown } } | null | undefined)?.restart?.startedAt
  return typeof at === 'number' ? at : null
}

/**
 * The engine (re)connected. If it is not the engine the Council started under (it restarted, or it does not say),
 * the scene's director went with it and nobody will send `end`: the Council is over, everyone goes back to what
 * they were doing (an agent with Follow on follows again). The same engine after a blip keeps the scene.
 */
export function noteVillageEngineConnected(): void {
  if (!council) return
  const now = engineStartedAt()
  if (now !== null && engineAtStart !== null && now === engineAtStart) return
  endVillageCouncil('the agent engine restarted')
}

/** Ends the Council from the page itself (not asked by the engine), saying why in its status. */
export function endVillageCouncil(why: string): void {
  if (!council) return
  end()
  last = { action: 'end', at: Date.now(), ok: true, note: why }
}

function notify(): void {
  version += 1
  listeners.forEach(listener => listener())
}

export function subscribeCouncil(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getCouncilVersion(): number {
  return version
}

/** A Council is on (nobody speaks on their own meanwhile). */
export function isCouncilOn(): boolean {
  return council !== null
}

export function isCouncilMember(agentId: string): boolean {
  return council !== null && council.places.has(agentId)
}

/** Where this agent has to be right now (VillageStation reads it every frame while it is on the stage). */
export function getCouncilGoal(agentId: string): CouncilGoal | null {
  return goals.get(agentId) || null
}

/** VillageStation: the agent stands on its mark, facing where it should. */
export function reportCouncilSettled(agentId: string, seq: number): void {
  const waiter = settledWaiters.get(agentId)
  if (!waiter || waiter.seq !== seq) return
  window.clearTimeout(waiter.timer)
  settledWaiters.delete(agentId)
  waiter.resolve(true)
}

/** VillageVoice: a member's reply has a spoken line. It is kept for `speak next` instead of being said at once. */
export function offerCouncilLine(agentId: string, text: string): void {
  const waiter = lineWaiters.get(agentId)
  if (waiter) {
    lineWaiters.delete(agentId)
    waiter(text)
    return
  }
  lines.set(agentId, { text, at: Date.now() })
}

function moveTo(agentId: string, mark: CouncilPoint, face: CouncilPoint, calm: boolean): Promise<boolean> {
  const earlier = settledWaiters.get(agentId)
  if (earlier) {
    window.clearTimeout(earlier.timer)
    earlier.resolve(false)
  }
  goalSeq += 1
  const seq = goalSeq
  goals.set(agentId, { x: mark.x, z: mark.z, faceX: face.x, faceZ: face.z, calm, seq })
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      if (settledWaiters.get(agentId)?.seq === seq) settledWaiters.delete(agentId)
      resolve(false)
    }, MOVE_TIMEOUT_MS)
    settledWaiters.set(agentId, { seq, resolve, timer })
  })
}

function agentOf(agentId: string) {
  return useOasisStore.getState().agentEngine.agents[agentId] || null
}

function voiceOfAgent(agentId: string): AgentVoiceSettings {
  const agent = agentOf(agentId)
  return getAgentVoiceSettings(agent?.sessionId || agentId, agent?.name, agent?.voiceChoice)
}

function owner(): CouncilPoint & { forwardX: number; forwardZ: number } | null {
  const pose = getPlayerAvatarPose()
  return pose ? { x: pose.position[0], z: pose.position[2], forwardX: pose.forward[0], forwardZ: pose.forward[2] } : null
}

class CouncilError extends Error {}

function member(req: CouncilRequest): { id: string; place: CouncilPlace; council: Council } {
  if (!council) throw new CouncilError('no Council is on (start one first)')
  const id = req.agentId || ''
  const place = council.places.get(id)
  if (!place) throw new CouncilError(`${agentOf(id)?.name || id || 'that agent'} is not in this Council`)
  return { id, place, council }
}

async function start(req: CouncilRequest): Promise<Record<string, unknown>> {
  const ids = req.agentIds || []
  if (!ids.length) throw new CouncilError('no agents given')
  // A stage world has nobody in it until now: the cast is brought in below.
  const stage = isStageWorldNow()
  for (const id of ids) {
    if (!agentOf(id)) throw new CouncilError(`this page does not know agent ${id}`)
    if (!stage && !getVillageDesk(id)) throw new CouncilError(`${agentOf(id)?.name || id} has no body in this world yet`)
  }
  stopVillageSpeech()
  const me = owner()
  const withOwner = Boolean(me)
  const radius = councilRadius(ids.length, withOwner, req.radius)
  let center: CouncilPoint
  if (req.center) center = { x: req.center[0], z: req.center[1] }
  else if (me) {
    // In front of the owner, so that they stand on the circle looking at the fire.
    const length = Math.hypot(me.forwardX, me.forwardZ) || 1
    center = { x: me.x + (me.forwardX / length) * radius, z: me.z + (me.forwardZ / length) * radius }
  } else {
    const desk = getVillageDesk(ids[0])
    center = { x: desk ? desk.anchor[0] : 0, z: desk ? desk.anchor[2] + radius + 2 : radius + 2 }
  }
  // The owner's place stays free when they are at the circle (within twice its radius of the fire). On a stage
  // the owner is always one of the circle: their place is on their side of the fire, wherever they stand (coming
  // through the portal they land almost 10 m out).
  const ownerAngle = me && (stage || Math.hypot(me.x - center.x, me.z - center.z) <= radius * 2) ? councilAngle(center, me) : null
  const spots = councilPlaces(ids.length, center, radius, ownerAngle)
  const places = new Map<string, CouncilPlace>()
  ids.forEach((id, index) => places.set(id, spots[index]))
  if (stage) {
    // Only the cast: each one appears out of the dark behind its place (VillageWorld shows them), then walks in.
    if (castLeaving !== null) {
      window.clearTimeout(castLeaving)
      castLeaving = null
    }
    stageCast.clear()
    stageDoors.clear()
    const obstacles = stageObstacles(center, radius)
    ids.forEach((id, index) => {
      const route = stageRoute(spots[index], center, obstacles)
      stageCast.set(id, route.arrival)
      if (route.door) stageDoors.set(id, route.door)
    })
    notify()
    const asked = Date.now()
    while (ids.some(id => !getVillageDesk(id)) && Date.now() - asked < 8000) await new Promise(resolve => window.setTimeout(resolve, 100))
    const missing = ids.filter(id => !getVillageDesk(id)).map(id => agentOf(id)?.name || id)
    if (missing.length) {
      clearStageCast()
      throw new CouncilError(`could not bring ${missing.join(', ')} to this stage`)
    }
  }
  for (const id of council ? council.members : []) if (!places.has(id)) goals.delete(id)
  council = { center, radius, step: req.step && req.step > 0 ? req.step : COUNCIL.step, members: [...ids], places, front: null }
  engineAtStart = engineStartedAt()
  lastStepAt = Date.now()
  armIdleEnd()
  // From now on only the Council's own lines play (village-companion.ts).
  setVillageSpeechCouncilOnly(true)
  lines.clear()
  const mine = run
  // Everyone walks to their place at once (on a stage, round a seat through its door first).
  const arrivals = ids.map(async id => {
    const place = places.get(id) as CouncilPlace
    const door = stageDoors.get(id)
    if (door && !(await moveTo(id, door, place, false))) return false
    if (mine !== run) return false
    return moveTo(id, place, center, false)
  })
  notify()
  const settled = await Promise.all(arrivals)
  if (mine !== run) return { stopped: true }
  const late = ids.filter((_, index) => !settled[index]).map(id => agentOf(id)?.name || id)
  return {
    center: [round(center.x), round(center.z)],
    radius: round(radius),
    ownerInCircle: ownerAngle !== null,
    places: ids.map(id => ({ agentId: id, name: agentOf(id)?.name || id, x: round((places.get(id) as CouncilPlace).x), z: round((places.get(id) as CouncilPlace).z) })),
    ...(late.length ? { notInPlace: late } : {}),
  }
}

const round = (value: number) => Math.round(value * 100) / 100

async function forward(req: CouncilRequest): Promise<Record<string, unknown>> {
  const { id, place, council: c } = member(req)
  const mine = run
  // One in front at a time: whoever is there steps back first.
  if (c.front && c.front !== id) await back({ action: 'back', agentId: c.front })
  if (mine !== run) return { stopped: true }
  const mark = councilFront(place, c.center, c.step)
  // It speaks to the owner when they are at the fire, else across it.
  const me = owner()
  const face = me && Math.hypot(me.x - c.center.x, me.z - c.center.z) <= c.radius * 3 ? me : c.center
  c.front = id
  const ok = await moveTo(id, mark, face, true)
  if (mine !== run) return { stopped: true }
  if (!ok) throw new CouncilError(`${agentOf(id)?.name || id} did not get to the front in time`)
  return { agentId: id, front: true }
}

async function back(req: CouncilRequest): Promise<Record<string, unknown>> {
  const { id, place, council: c } = member(req)
  const mine = run
  const ok = await moveTo(id, place, c.center, true)
  if (c.front === id) c.front = null
  if (mine !== run) return { stopped: true }
  if (!ok) throw new CouncilError(`${agentOf(id)?.name || id} did not get back to its place in time`)
  return { agentId: id, front: false }
}

function nextLine(agentId: string, waitMs: number): Promise<string | null> {
  const kept = lines.get(agentId)
  lines.delete(agentId)
  // A kept line counts unless the agent is working on a new reply right now: then that one is meant.
  if (kept && agentOf(agentId)?.status !== 'working') return Promise.resolve(kept.text)
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      if (lineWaiters.get(agentId) === done) lineWaiters.delete(agentId)
      resolve(null)
    }, waitMs)
    const done = (text: string | null) => {
      window.clearTimeout(timer)
      resolve(text)
    }
    lineWaiters.get(agentId)?.(null)
    lineWaiters.set(agentId, done)
  })
}

async function speak(req: CouncilRequest, play: boolean): Promise<Record<string, unknown>> {
  const { id } = member(req)
  const mine = run
  let text = req.text || ''
  if (!text && req.next) {
    const line = await nextLine(id, req.waitMs || 120_000)
    if (mine !== run) return { stopped: true }
    if (!line) throw new CouncilError(`${agentOf(id)?.name || id} did not say anything in time (no reply with a spoken line; is its Voice switch on?)`)
    text = line
  }
  if (!text) throw new CouncilError('nothing to say: give text, or next')
  const settings = voiceOfAgent(id)
  // The clip first: its length is known before a word is said.
  const prepared = await prepareVillageSpeech(text, settings)
  if (mine !== run) return { stopped: true }
  const info = { agentId: id, text: prepared.text, seconds: prepared.seconds, voice: prepared.voice, speed: settings.speed }
  if (!play) return info
  lines.delete(id)
  if (!(await ensureVillageAudio())) throw new CouncilError('sound is locked on the Oasis page: click once in it (or press a key), then try again')
  if (mine !== run) return { ...info, stopped: true }
  const startedAt = performance.now()
  const playing = await speakVillageAgent(id, prepared.text, settings, true, true)
  if (mine !== run) return { ...info, stopped: true }
  if (!playing) throw new CouncilError('the voice could not play (is the avatar in the scene?)')
  await whenVillageSpeechEnds()
  const took = round((performance.now() - startedAt) / 1000)
  if (mine !== run) return { ...info, took, stopped: true }
  // Ended well before its length: something cut it off (the voices were muted, the page lost its sound).
  return took < prepared.seconds - 1 ? { ...info, took, cut: true } : { ...info, took }
}

async function turn(req: CouncilRequest): Promise<Record<string, unknown>> {
  const mine = run
  let said: Record<string, unknown>
  try {
    await forward(req)
    if (mine !== run) return { stopped: true }
    said = await speak(req, true)
  } finally {
    // Whatever happened to the line, nobody is left standing in front.
    if (mine === run && council?.places.has(req.agentId || '')) await back({ action: 'back', agentId: req.agentId })
  }
  return said
}

/** The voice stops now; whoever stands in front steps back. Runs at once, not in the queue. */
function stop(): Record<string, unknown> {
  run += 1
  stopVillageSpeech()
  for (const [id, waiter] of lineWaiters) {
    lineWaiters.delete(id)
    waiter(null)
  }
  const c = council
  const stepping = c?.front || null
  if (c && stepping) {
    const place = c.places.get(stepping)
    c.front = null
    if (place) void moveTo(stepping, place, c.center, true)
  }
  return { stopped: true, steppedBack: stepping }
}

function end(): Record<string, unknown> {
  const was = council
  stop()
  council = null
  // A stage's cast walks back out into the dark, then it is gone.
  if (stageCast.size) {
    if (castLeaving !== null) window.clearTimeout(castLeaving)
    castLeaving = window.setTimeout(() => {
      castLeaving = null
      stageCast.clear()
      notify()
    }, STAGE.leaveMs)
  }
  if (idleTimer !== null) {
    window.clearInterval(idleTimer)
    idleTimer = null
  }
  setVillageSpeechCouncilOnly(false)
  for (const waiter of settledWaiters.values()) {
    window.clearTimeout(waiter.timer)
    waiter.resolve(false)
  }
  settledWaiters.clear()
  goals.clear()
  lines.clear()
  notify()
  return { ended: Boolean(was) }
}

/**
 * The end of a Council on a stage: everyone walks back out the way they came in (through its door, if it had one,
 * then into the dark) and is gone; then the Council is over. Answers at once; nobody speaks meanwhile.
 */
function leaveStage(): Record<string, unknown> {
  const c = council
  if (!c) return end()
  stop()
  const mine = run
  void Promise.all(c.members.map(async id => {
    const home = stageCast.get(id)
    const door = stageDoors.get(id)
    if (door && !(await moveTo(id, door, c.center, false))) return
    if (mine !== run || !home) return
    // Facing away from the fire as it goes.
    await moveTo(id, home, { x: home.x * 2 - c.center.x, z: home.z * 2 - c.center.z }, false)
  })).then(() => {
    if (mine !== run || council !== c) return
    end()
    // They are out in the dark already: gone now, not after the usual walk home.
    clearStageCast()
  })
  return { ended: true, leaving: true }
}

export function getCouncilStatus(): Record<string, unknown> {
  return {
    on: council !== null,
    ...(council ? {
      center: [round(council.center.x), round(council.center.z)],
      radius: round(council.radius),
      members: council.members.map(id => ({ agentId: id, name: agentOf(id)?.name || id, front: council?.front === id, lineWaiting: lines.has(id) })),
      front: council.front,
    } : {}),
    last,
  }
}

/**
 * Do one step of the scene. Resolves when it is done; rejects with what went wrong (the engine passes it on).
 * Steps queue up; `stop`, `end` and `status` act at once.
 */
export function runCouncilRequest(req: CouncilRequest): Promise<Record<string, unknown>> {
  const action = String(req?.action || '')
  if (action === 'status') return Promise.resolve(getCouncilStatus())
  if (action === 'stop') return Promise.resolve(stop())
  if (action === 'end') return Promise.resolve(stageCast.size && council ? leaveStage() : end())
  const queuedIn = run
  lastStepAt = Date.now()
  const job = chain.then(async () => {
    // A stop (or the end) came while this step waited its turn: it is not done any more.
    if (queuedIn !== run) return { stopped: true }
    try {
      let result: Record<string, unknown>
      if (action === 'start') result = await start(req)
      else if (action === 'forward') result = await forward(req)
      else if (action === 'back') result = await back(req)
      else if (action === 'speak') result = await speak(req, true)
      else if (action === 'prepare') result = await speak(req, false)
      else if (action === 'turn') result = await turn(req)
      else throw new CouncilError(`unknown action "${action}"`)
      last = { action, at: Date.now(), ok: true }
      lastStepAt = Date.now()
      return result
    } catch (error) {
      last = { action, at: Date.now(), ok: false, note: error instanceof Error ? error.message : String(error) }
      throw error
    }
  })
  chain = job.catch(() => {})
  return job
}
