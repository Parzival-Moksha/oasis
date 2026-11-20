// ░▒▓ VILLAGE COMPANION — who follows the owner, and the voice an agent's avatar speaks with ▓▒░
// Two things live here, both local to this tab:
//   1. The "Follow me" choice per agent (remembered per session in this browser; Anorak follows by default).
//      The walking itself is VillageStation's (VillageWorld.tsx) with the rules in lib/village/village-follow.ts.
//      "Come to me when you need me" (on for every agent): an agent that needs the owner walks up to them,
//      waits there in silence beside the others, and goes home once it was answered or looked at.
//   2. Speech: an agent's reply ends with <spoken>…</spoken> (lib/village/village-spoken.ts). When the owner
//      opens the agent (VillageVoice.tsx: E or F, once per reply), the line is fetched as an ElevenLabs clip
//      (/api/village/speak, cached
//      by text) and played from the avatar's head through three's PositionalAudio: louder when close, with the
//      mouth moving (the clip's character timings, read as the sounds they spell: lib/village/village-visemes.ts),
//      in the agent's own voice and at its own speed (lib/village/village-voices.ts: ten voices, 0.5x to 3x,
//      pitch kept; both set in the agent's settings menu and remembered per session).
//
// Frame-rate note (fps-decay mission): a PositionalAudio schedules Web Audio ramps every frame while it
// plays. It is only in the scene while a clip plays, and a clip only starts on a running AudioContext, so
// nothing can queue ramps on a suspended context the way the listener once did.

import { speakInBrowser, stopBrowserSpeech } from '../../lib/village/browser-speech'
import { detectSpokenLanguage } from '../../lib/village/spoken-language'
import * as THREE from 'three'
import { getAudioListener } from '../CameraController'
import { registerLipSync, unregisterLipSync, type LipSyncController } from '../../lib/lip-sync'
import type { ElevenLabsAlignment } from '../../lib/lip-sync-lab'
import { buildVisemeTimeline, createVisemeLipSync } from '../../lib/village/village-visemes'
import { faceHeightFrom } from '../../lib/village/village-layout'
import { parseFollowPrefs, wantsCome, wantsFollow, withComeChoice, withFollowChoice, type FollowPrefs, type VisitSpot } from '../../lib/village/village-follow'
import { SPOKEN_MAX_CHARS, cleanSpoken } from '../../lib/village/village-spoken'
import { fieldMap, voiceOps, voicesFromIdentity } from '../../lib/village/village-identity'
import { getVillageIdentity, isVillageIdentityOffline, isVillageIdentityReady, queueVillageIdentity, subscribeVillageIdentity } from '../../lib/village/village-identity-client'
import { dealVoice, parseVoicePrefs, playbackRateFor, speechSpeedPlan, speedOf, voiceChosenBy, voiceOf, withVoicePrefs, type VoicePrefs } from '../../lib/village/village-voices'

// ─── follow ─────────────────────────────────────────────────────────────────

const FOLLOW_KEY = 'oasis.village.follow'
let followPrefs: FollowPrefs | null = null
let followVersion = 0
const followListeners = new Set<() => void>()

/** The store on this PC (village-identity.ts), once it is loaded; null before that or without it. */
function storeFile() {
  return isVillageIdentityReady() && !isVillageIdentityOffline() ? getVillageIdentity() : null
}

function loadFollowPrefs(): FollowPrefs {
  if (followPrefs === null) {
    const file = storeFile()
    if (file) return (followPrefs = fieldMap(file, 'follow'))
    try {
      followPrefs = parseFollowPrefs(typeof window === 'undefined' ? null : window.localStorage.getItem(FOLLOW_KEY))
    } catch {
      followPrefs = {}
    }
  }
  return followPrefs
}

/** Does this agent follow the owner? `key`: its session id (or its agent id before it has one). */
export function isVillageFollowOn(key: string, name: string | null | undefined): boolean {
  return wantsFollow(loadFollowPrefs(), key, name)
}

export function setVillageFollow(key: string, name: string | null | undefined, on: boolean): void {
  followPrefs = withFollowChoice(loadFollowPrefs(), key, name, on)
  queueVillageIdentity([{ agent: key, set: { follow: key in followPrefs ? followPrefs[key] : null } }])
  try {
    window.localStorage.setItem(FOLLOW_KEY, JSON.stringify(followPrefs))
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  followVersion += 1
  followListeners.forEach(listener => listener())
}

export function subscribeVillageFollow(listener: () => void): () => void {
  followListeners.add(listener)
  return () => { followListeners.delete(listener) }
}

export function getVillageFollowVersion(): number {
  return followVersion
}

// ─── come to me when you need me (on for every agent; the agent's settings menu) ──

const COME_KEY = 'oasis.village.come'
let comePrefs: FollowPrefs | null = null

function loadComePrefs(): FollowPrefs {
  if (comePrefs === null) {
    const file = storeFile()
    if (file) return (comePrefs = fieldMap(file, 'come'))
    try {
      comePrefs = parseFollowPrefs(typeof window === 'undefined' ? null : window.localStorage.getItem(COME_KEY))
    } catch {
      comePrefs = {}
    }
  }
  return comePrefs
}

/** Does this agent walk up to the owner when it needs them? `key`: its session key. On unless switched off. */
export function isVillageComeOn(key: string): boolean {
  return wantsCome(loadComePrefs(), key)
}

/** Shares the Follow me listeners: both are read by the same components. */
export function setVillageCome(key: string, on: boolean): void {
  comePrefs = withComeChoice(loadComePrefs(), key, on)
  queueVillageIdentity([{ agent: key, set: { come: key in comePrefs ? comePrefs[key] : null } }])
  try {
    window.localStorage.setItem(COME_KEY, JSON.stringify(comePrefs))
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  followVersion += 1
  followListeners.forEach(listener => listener())
}

// Where the agents that are away from their desks stand or are headed (VillageStation writes it), so that
// the ones who come to the owner queue up side by side instead of on top of each other.
const awaySpots = new Map<string, VisitSpot>()
/** Agents that came to the owner and stand in front of them now. */
const arrivedAgents = new Set<string>()

export function setVillageAwaySpot(agentId: string, spot: VisitSpot | null): void {
  if (spot) awaySpots.set(agentId, spot)
  else awaySpots.delete(agentId)
}

/** Everyone else's spot, for pickVisitSpot. */
export function otherVillageAwaySpots(agentId: string): VisitSpot[] {
  const out: VisitSpot[] = []
  for (const [id, spot] of awaySpots) if (id !== agentId) out.push(spot)
  return out
}

// Which replies the owner has heard. Nobody speaks unasked (five agents walking up at once would all talk at
// him: his words, 2026-11-16). Each reply's spoken line waits until he opens that agent (E or F) and is said
// then, once; VillageVoice.tsx watches for that. Kept for this browser tab (a reload does not replay).
const HEARD_KEY = 'oasis.village.heard'
const HEARD_KEEP = 300
let heard: string[] | null = null

function loadHeard(): string[] {
  if (heard === null) {
    try {
      const parsed = JSON.parse((typeof window === 'undefined' ? null : window.sessionStorage.getItem(HEARD_KEY)) || '[]') as unknown
      heard = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
      heard = []
    }
  }
  return heard
}

const heardId = (agentKey: string, replyAt: number) => `${agentKey}:${replyAt}`

/** Has the owner heard this reply's line? `agentKey`: the agent's session key; `replyAt`: the reply's time. */
export function isVillageReplyHeard(agentKey: string, replyAt: number): boolean {
  return loadHeard().includes(heardId(agentKey, replyAt))
}

export function markVillageReplyHeard(agentKey: string, replyAt: number): void {
  const id = heardId(agentKey, replyAt)
  const list = loadHeard().filter(item => item !== id)
  list.push(id)
  heard = list.slice(-HEARD_KEEP)
  try {
    window.sessionStorage.setItem(HEARD_KEY, JSON.stringify(heard))
  } catch {
    // Storage blocked: remembered for this page only.
  }
}

/** The agent stands in front of the owner (true) or left again (false). It waits there in silence. */
export function setVillageArrived(agentId: string, arrived: boolean): void {
  if (arrived) arrivedAgents.add(agentId)
  else arrivedAgents.delete(agentId)
}

/**
 * Make a line's clip ahead of time (the owner is walking up to the agent: E or F is likely next), so it starts
 * the moment he opens it. Only where it could be played right now: a muted, hidden or silent tab makes no clip.
 */
export function warmVillageSpeech(text: string, settings: AgentVoiceSettings): void {
  const listener = getAudioListener()
  const clean = cleanSpoken(text, SPOKEN_MAX_CHARS)
  if (!clean || councilOnly || listener?.context.state !== 'running' || !isVillageVoiceOn() || document.visibilityState !== 'visible') return
  fetchClip(clean, settings.voice, speechSpeedPlan(settings.speed).modelSpeed).catch(() => {})
}

// ─── the avatar's head (VillageStation registers it; speech plays from there) ─

const heads = new Map<string, THREE.Object3D>()

export function registerVillageHead(agentId: string, head: THREE.Object3D | null): void {
  if (head) heads.set(agentId, head)
  else heads.delete(agentId)
}

/**
 * Where the voice comes from: the body's own head bone when it has one (VRM skeletons name it "…Head"),
 * so the sound sits on the head whatever the avatar's height and pose; else the spot VillageStation registered.
 */
function speechSource(agentId: string): THREE.Object3D | null {
  const spot = heads.get(agentId)
  if (!spot) return null
  let bone: THREE.Object3D | null = null
  spot.parent?.traverse(object => {
    if (!bone && (object as THREE.Bone).isBone && /head$/i.test(object.name)) bone = object
  })
  return bone || spot
}

/** Where an agent's other sounds come from (its incantation when it casts: village-cast.ts): the same spot as its voice. */
export function villageSoundSource(agentId: string): THREE.Object3D | null {
  return speechSource(agentId)
}

// How high each avatar's face is (the F view puts the camera there): measured from its own skeleton when asked.
const faceHeights = new Map<string, number>()
const _facePoint = new THREE.Vector3()
const _faceBox = new THREE.Box3()
const _meshBox = new THREE.Box3()

/**
 * Measure the avatar's eye height above its feet now: from its head joint and the top of its body
 * (village-layout.ts faceHeightFrom). Avatars differ a lot (a child-sized one, a tall unicorn), so the camera
 * of the F view cannot assume a height. Remembered until it is measured again.
 */
export function measureVillageFace(agentId: string): number {
  const body = measureVillageBody(agentId)
  if (!body) return faceHeights.get(agentId) ?? faceHeightFrom(null, null)
  faceHeights.set(agentId, body.face)
  return body.face
}

/**
 * The avatar's measures above its feet, from its own skeleton and meshes as they stand now: `top` of the body
 * (the name tag goes just above it), `face` (eye height, for the F view and its portrait), `rigged`: a skeleton
 * was found, so this is the body itself and not the stand-in shown while it loads. null: nothing is there yet.
 */
export function measureVillageBody(agentId: string): { top: number; face: number; rigged: boolean } | null {
  const spot = heads.get(agentId)
  const root = spot?.parent
  if (!root) return null
  root.updateWorldMatrix(true, true)
  const feet = root.getWorldPosition(_facePoint).y
  let joint: number | null = null
  _faceBox.makeEmpty()
  root.traverse(object => {
    if (joint === null && (object as THREE.Bone).isBone && /head$/i.test(object.name)) joint = object.getWorldPosition(_facePoint).y - feet
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    // The body itself, not the invisible boxes that take the clicks.
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (!materials.some(material => material && material.visible !== false)) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    if (mesh.geometry.boundingBox) _faceBox.union(_meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld))
  })
  if (_faceBox.isEmpty()) return null
  const top = _faceBox.max.y - feet
  return { top, face: faceHeightFrom(joint, top), rigged: joint !== null }
}

/** The avatar's eye height above its feet: as last measured, else measured now. */
export function getVillageFaceHeight(agentId: string): number {
  return faceHeights.get(agentId) ?? measureVillageFace(agentId)
}

/** The lip-sync registry key of a village agent's body (VRMCatalogRenderer `lipSyncId`). */
export function villageLipSyncId(agentId: string): string {
  return `village:${agentId}`
}

// ─── mute (the speaker next to the chime's bell) ────────────────────────────

const VOICE_KEY = 'oasis.village.voice'
let voiceOn: boolean | null = null
const voiceListeners = new Set<() => void>()

/** The HUD switch: off = no agent speaks on its own (and nothing is generated). Play buttons still work. */
export function isVillageVoiceOn(): boolean {
  if (voiceOn === null) {
    try {
      voiceOn = window.localStorage.getItem(VOICE_KEY) !== 'off'
    } catch {
      voiceOn = true
    }
  }
  return voiceOn
}

export function setVillageVoiceOn(on: boolean): void {
  voiceOn = on
  try {
    window.localStorage.setItem(VOICE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  if (!on) stopVillageSpeech()
  voiceListeners.forEach(listener => listener())
}

export function subscribeVillageVoice(listener: () => void): () => void {
  voiceListeners.add(listener)
  return () => { voiceListeners.delete(listener) }
}

// ─── each agent's voice and speed (its settings menu; remembered per session in this browser) ──

const VOICES_KEY = 'oasis.village.voices'
let voicePrefs: VoicePrefs | null = null
let voicePrefsVersion = 0
const voicePrefsListeners = new Set<() => void>()

function loadVoicePrefs(): VoicePrefs {
  if (voicePrefs === null) {
    const file = storeFile()
    if (file) return (voicePrefs = parseVoicePrefs(JSON.stringify(voicesFromIdentity(file))))
    try {
      voicePrefs = parseVoicePrefs(typeof window === 'undefined' ? null : window.localStorage.getItem(VOICES_KEY))
    } catch {
      voicePrefs = {}
    }
  }
  return voicePrefs
}

function saveVoicePrefs(next: VoicePrefs, announce: boolean): void {
  queueVillageIdentity(voiceOps(voicePrefs || {}, next))
  voicePrefs = next
  try {
    window.localStorage.setItem(VOICES_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  if (!announce) return
  voicePrefsVersion += 1
  voicePrefsListeners.forEach(listener => listener())
}

// Another tab or window changed a voice, a follow or a come-to-me (or the store just loaded): read them again.
subscribeVillageIdentity(() => {
  const file = storeFile()
  if (!file) return
  const voices = parseVoicePrefs(JSON.stringify(voicesFromIdentity(file)))
  if (JSON.stringify(voices) !== JSON.stringify(voicePrefs)) {
    voicePrefs = voices
    voicePrefsVersion += 1
    voicePrefsListeners.forEach(listener => listener())
  }
  const follow = fieldMap(file, 'follow')
  const come = fieldMap(file, 'come')
  if (JSON.stringify(follow) !== JSON.stringify(followPrefs) || JSON.stringify(come) !== JSON.stringify(comePrefs)) {
    followPrefs = follow
    comePrefs = come
    followVersion += 1
    followListeners.forEach(listener => listener())
  }
})

export interface AgentVoiceSettings {
  /** The agent's session key (villageAgentKey). */
  key: string
  /** A VILLAGE_VOICES key. */
  voice: string
  speed: number
}

/**
 * The voice and speed of an agent (`key`: its session id, or its agent id before it has one). The owner's pick
 * in the settings menu comes first, then the voice the agent chose for itself (`own`: the engine's
 * `voiceChoice`), then the one it was dealt. An agent without any is dealt a random one here, once, and keeps
 * it; Anorak has his own.
 */
export function getAgentVoiceSettings(key: string, name: string | null | undefined, own?: string | null): AgentVoiceSettings {
  const prefs = loadVoicePrefs()
  let voice = voiceOf(prefs, key, name, own)
  if (!voice) {
    voice = dealVoice(prefs)
    // Quietly: this can run while a component reads it, and nothing on screen changes by it.
    saveVoicePrefs(withVoicePrefs(prefs, key, { voice }), false)
  }
  return { key, voice, speed: speedOf(loadVoicePrefs(), key) }
}

export function setAgentVoice(key: string, voice: string): void {
  saveVoicePrefs(withVoicePrefs(loadVoicePrefs(), key, { voice, picked: true }), true)
}

/** Who decided this agent's voice: the owner (settings menu), the agent itself, or nobody (dealt, or Anorak's own). */
export function agentVoiceChosenBy(key: string, own?: string | null): 'owner' | 'agent' | 'nobody' {
  return voiceChosenBy(loadVoicePrefs(), key, own)
}

/** Take the owner's pick back: the agent's own choice (or the dealt voice) counts again. */
export function clearAgentVoicePick(key: string): void {
  saveVoicePrefs(withVoicePrefs(loadVoicePrefs(), key, { picked: false }), true)
}

/** Applies to the clip this agent is saying too (its rate changes at once; the next clip is made at the new speed). */
export function setAgentVoiceSpeed(key: string, speed: number): void {
  saveVoicePrefs(withVoicePrefs(loadVoicePrefs(), key, { speed }), true)
  if (playing && playing.key === key) playing.element.playbackRate = playbackRateFor(speedOf(loadVoicePrefs(), key), playing.modelSpeed)
}

export function subscribeVoiceSettings(listener: () => void): () => void {
  voicePrefsListeners.add(listener)
  return () => { voicePrefsListeners.delete(listener) }
}

export function getVoiceSettingsVersion(): number {
  return voicePrefsVersion
}

// ─── speech ─────────────────────────────────────────────────────────────────

export interface VillageSpeech {
  agentId: string
  /** The cleaned line being fetched or said. */
  text: string
  /** `paused`: the owner paused it in its player (the clip waits where it stopped). */
  phase: 'loading' | 'speaking' | 'paused'
}

interface Clip {
  id: string
  url: string
  alignment: ElevenLabsAlignment | null
  /** ElevenLabs' voice speed the clip was made with. */
  modelSpeed: number
}

interface Playback {
  /** Whose clip: its session key (a speed change for that agent reaches the playing clip). */
  key: string
  agentId: string
  /** The cleaned line, as in VillageSpeech. */
  text: string
  /** Character times from ElevenLabs (the player lights the word being said). */
  alignment: ElevenLabsAlignment | null
  /** The clip's length from its timings, until the element knows its own. */
  timelineSeconds: number
  audio: THREE.PositionalAudio
  element: HTMLAudioElement
  modelSpeed: number
  voice: string
  lipId: string
  lip: LipSyncController | null
  release: () => void
}

let speech: VillageSpeech | null = null
let speechToken = 0
let playing: Playback | null = null
let lastSpeech: { agentId: string; text: string; at: number; result: string; waitMs?: number } | null = null
const speechListeners = new Set<() => void>()
/** Clips asked for on this page: a replay does not ask the server again (the mp3 itself sits in the browser's cache). */
const clips = new Map<string, Promise<Clip>>()
/** The same clips once they arrived: their length is known without asking again (the player shows it). */
const readyClips = new Map<string, Clip>()

function setSpeech(next: VillageSpeech | null): void {
  speech = next
  speechListeners.forEach(listener => listener())
}

export function getVillageSpeech(): VillageSpeech | null {
  return speech
}

export function subscribeVillageSpeech(listener: () => void): () => void {
  speechListeners.add(listener)
  return () => { speechListeners.delete(listener) }
}

/** For window.__oasisVillageVoice.debug() (dev) and the playtest. */
export function getVillageSpeechDebug() {
  const listener = getAudioListener()
  return {
    on: isVillageVoiceOn(),
    audio: listener?.context.state || 'none',
    speech,
    last: lastSpeech,
    playing: playing ? { key: playing.key, voice: playing.voice, rate: playing.element.playbackRate, modelSpeed: playing.modelSpeed, time: playing.element.currentTime, duration: playing.element.duration, preservesPitch: (playing.element as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch !== false } : null,
    heads: [...heads.keys()],
    arrived: [...arrivedAgents],
  }
}

/** Called once each when whatever is being said has ended or was stopped (whenVillageSpeechEnds). */
let endWaiters: Array<() => void> = []

function flushEndWaiters(): void {
  const waiters = endWaiters
  endWaiters = []
  waiters.forEach(done => done())
}

/** Resolves when the clip that is playing (or being fetched) has ended or was stopped; at once when nothing is. */
export function whenVillageSpeechEnds(): Promise<void> {
  if (!speech && !playing) return Promise.resolve()
  return new Promise(resolve => { endWaiters.push(resolve) })
}

/** A Council is on (village-council.ts sets it): only the Council's own lines play, so nothing talks over a speaker. */
let councilOnly = false

export function setVillageSpeechCouncilOnly(on: boolean): void {
  councilOnly = on
}

/**
 * Is sound unlocked on this page? Tries to unlock it, but never waits long: without a click or key press the
 * browser leaves that request pending for good.
 */
export async function ensureVillageAudio(waitMs = 1500): Promise<boolean> {
  const context = getAudioListener()?.context
  if (!context) return false
  if (context.state === 'running') return true
  await Promise.race([context.resume().catch(() => {}), new Promise(resolve => window.setTimeout(resolve, waitMs))])
  return (context.state as AudioContextState) === 'running'
}

export interface PreparedSpeech {
  /** The line as it will be said (cleaned, 400 characters at most). */
  text: string
  /** The clip's own length. */
  clipSeconds: number
  /** How long it takes to say at the agent's speed. */
  seconds: number
  playbackRate: number
  voice: string
}

/**
 * Make the clip for a line without playing it, and say how long it will take: a scene (the Council) can be
 * timed before anyone opens their mouth, and the line then starts at once. Costs what saying it would.
 */
export async function prepareVillageSpeech(rawText: string, settings: AgentVoiceSettings): Promise<PreparedSpeech> {
  const text = cleanSpoken(rawText, SPOKEN_MAX_CHARS)
  if (!text) throw new Error('nothing to say')
  const plan = speechSpeedPlan(settings.speed)
  // Never wait for ever on a stalled request: a scene is waiting behind this.
  const clip = await Promise.race([
    fetchClip(text, settings.voice, plan.modelSpeed),
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('the voice clip took more than 40 s to make')), 40_000)),
  ])
  const clipSeconds = buildVisemeTimeline(clip.alignment).duration
  const playbackRate = playbackRateFor(settings.speed, clip.modelSpeed)
  return { text, clipSeconds, seconds: Math.round((clipSeconds / playbackRate) * 100) / 100, playbackRate, voice: settings.voice }
}

function endPlayback(): void {
  const current = playing
  if (!current) {
    flushEndWaiters()
    return
  }
  playing = null
  current.release()
  unregisterLipSync(current.lipId, current.lip || undefined)
  try {
    current.element.pause()
    current.element.removeAttribute('src')
    current.element.load()
  } catch { /* already gone */ }
  try {
    current.audio.disconnect()
  } catch { /* never connected */ }
  current.audio.removeFromParent()
  flushEndWaiters()
}

// ─── the player under a reply (CompanionToggles SpokenPlayer): pause, go on, seek, and where it is ───────

/** Pause the line being said; it waits where it stopped. False when nothing is playing. */
export function pauseVillageSpeech(): boolean {
  const current = playing
  if (!current || current.element.paused) return false
  current.element.pause()
  if (speech) setSpeech({ ...speech, phase: 'paused' })
  return true
}

/** Go on with a paused line. False when there is none, or sound is locked. */
export async function resumeVillageSpeech(): Promise<boolean> {
  const current = playing
  if (!current || !current.element.paused) return false
  const context = getAudioListener()?.context
  if (context && context.state !== 'running') {
    await Promise.race([context.resume().catch(() => {}), new Promise(resolve => window.setTimeout(resolve, 1500))])
    if ((context.state as AudioContextState) !== 'running') return false
  }
  try {
    await current.element.play()
  } catch {
    return false
  }
  if (playing !== current) return false
  if (speech) setSpeech({ ...speech, phase: 'speaking' })
  return true
}

/** Jump to `seconds` of the clip (its own seconds, whatever the speed), paused or playing. */
export function seekVillageSpeech(seconds: number): boolean {
  const current = playing
  if (!current || !Number.isFinite(seconds)) return false
  const length = Number.isFinite(current.element.duration) && current.element.duration > 0 ? current.element.duration : current.timelineSeconds
  current.element.currentTime = Math.max(0, Math.min(seconds, Math.max(0, length - 0.05)))
  return true
}

export interface VillageSpeechClock {
  agentId: string
  text: string
  /** Where the clip is, and how long it is, in its own seconds. */
  time: number
  duration: number
  /** How fast it plays (the agent's speed over the speed the clip was made at). */
  rate: number
  paused: boolean
  alignment: ElevenLabsAlignment | null
}

/** The line being said, where it is now (the player reads it every frame while it is that line's). */
export function getVillageSpeechClock(): VillageSpeechClock | null {
  const current = playing
  if (!current) return null
  const element = current.element
  return {
    agentId: current.agentId,
    text: current.text,
    time: element.currentTime,
    duration: Number.isFinite(element.duration) && element.duration > 0 ? element.duration : current.timelineSeconds,
    rate: element.playbackRate,
    paused: element.paused,
    alignment: current.alignment,
  }
}

/** A line's clip length and timings if it was made on this page already (heard once): null otherwise, nothing is asked. */
export function knownVillageClip(rawText: string, settings: AgentVoiceSettings): { seconds: number; alignment: ElevenLabsAlignment | null } | null {
  const text = cleanSpoken(rawText, SPOKEN_MAX_CHARS)
  const clip = readyClips.get(clipKey(text, settings.voice, speechSpeedPlan(settings.speed).modelSpeed))
  if (!clip) return null
  return { seconds: buildVisemeTimeline(clip.alignment).duration, alignment: clip.alignment }
}

/** Stop whatever is being said (or fetched). */
export function stopVillageSpeech(): void {
  speechToken += 1
  stopBrowserSpeech()
  endPlayback()
  if (speech) setSpeech(null)
}

/** What the page server answers without a key (village-speech-server.ts). Once seen, it is not asked again on this page. */
const NO_KEY = 'ELEVENLABS_API_KEY not configured'
let noServerVoice = false

const clipKey = (text: string, voice: string, modelSpeed: number) => `${voice}\n${modelSpeed}\n${text}`

function fetchClip(text: string, voice: string, modelSpeed: number): Promise<Clip> {
  if (noServerVoice) return Promise.reject(new Error(NO_KEY))
  const key = clipKey(text, voice, modelSpeed)
  let job = clips.get(key)
  if (!job) {
    job = fetch('/api/village/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, speed: modelSpeed }),
    }).then(async response => {
      const data = await response.json().catch(() => ({})) as Partial<Clip> & { error?: string }
      if (!response.ok || !data.id || !data.url) throw new Error(data.error || `speech failed (${response.status})`)
      const ready: Clip = { id: data.id, url: data.url, alignment: data.alignment || null, modelSpeed: typeof data.modelSpeed === 'number' ? data.modelSpeed : 1 }
      readyClips.set(key, ready)
      return ready
    })
    clips.set(key, job)
    job.catch(() => { clips.delete(key); readyClips.delete(key) })
  }
  return job
}

/**
 * Say `text` from the agent's avatar, in its voice and at its speed (getAgentVoiceSettings). A new line stops the one before it. Resolves true
 * once it plays. Needs sound to be allowed on the page (any click or key press does that); without it nothing
 * is fetched, so a silent tab costs nothing. `byHand`: the owner clicked play, so the click itself may
 * unlock sound; a reply that speaks on its own never waits for that (it would be said much later).
 *
 * The clip plays through an <audio> element feeding three's PositionalAudio: the element starts while the
 * file is still arriving, keeps the pitch when it plays faster or slower than the clip was made, and its
 * clock (in the clip's own seconds, whatever the rate) drives the mouth.
 */
export async function speakVillageAgent(agentId: string, rawText: string, settings: AgentVoiceSettings, byHand = false, fromCouncil = false, startAt = 0): Promise<boolean> {
  const { voice } = settings
  const text = cleanSpoken(rawText, SPOKEN_MAX_CHARS)
  // During a Council only its own lines play (a play button or "hear it" would cut the speaker off).
  if (councilOnly && !fromCouncil) {
    lastSpeech = { agentId, text, at: Date.now(), result: 'a Council is on: only its speakers talk' }
    return false
  }
  stopVillageSpeech()
  const token = speechToken
  const askedAt = performance.now()
  const fail = (result: string) => {
    lastSpeech = { agentId, text, at: Date.now(), result }
    if (token === speechToken) {
      setSpeech(null)
      flushEndWaiters()
    }
    return false
  }
  const listener = getAudioListener()
  if (!text || !listener) return fail(text ? 'no audio listener' : 'nothing to say')
  const context = listener.context
  if (context.state !== 'running') {
    if (!byHand) return fail('audio locked until a click or key press')
    // Not for ever: without a gesture the browser never settles this.
    await Promise.race([context.resume().catch(() => {}), new Promise(resolve => window.setTimeout(resolve, 1500))])
    if ((context.state as AudioContextState) !== 'running') return fail('audio locked until a click or key press')
  }
  if (token !== speechToken) return false
  setSpeech({ agentId, text, phase: 'loading' })
  const plan = speechSpeedPlan(settings.speed)
  let clip: Clip
  try {
    if (noServerVoice) throw new Error(NO_KEY)
    clip = await fetchClip(text, voice, plan.modelSpeed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // No ElevenLabs key on this machine: the browser's own voice says it (free, nothing leaves the machine).
    if (message.includes(NO_KEY)) {
      noServerVoice = true
      if (token !== speechToken) return false
      const said = speakInBrowser(text, {
        voiceKey: voice,
        rate: settings.speed,
        lang: detectSpokenLanguage(text),
        onEnd: () => {
          if (token !== speechToken) return
          setSpeech(null)
          flushEndWaiters()
        },
      })
      if (!said) return fail('no voice: no ElevenLabs key, and this browser has no speech of its own')
      lastSpeech = { agentId, text, at: Date.now(), waitMs: Math.round(performance.now() - askedAt), result: `the browser's voice (no ElevenLabs key)` }
      setSpeech({ agentId, text, phase: 'speaking' })
      return true
    }
    console.warn(`[village] speech failed: ${message}`)
    return fail('fetch failed')
  }
  if (token !== speechToken) return false
  if ((context.state as AudioContextState) !== 'running') return fail('audio suspended')

  // From the avatar's head. (Never on the listener itself: it hangs on the camera, whose matrix every label updates.)
  const head = speechSource(agentId)
  if (!head) return fail('no avatar in the scene')
  const element = new Audio()
  element.preload = 'auto'
  ;(element as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true
  element.src = clip.url
  // After src: setting the source resets the rate to the element's default.
  // The speed as it is set now (it may have been changed while the clip was being made).
  const speedNow = () => speedOf(loadVoicePrefs(), settings.key)
  element.defaultPlaybackRate = playbackRateFor(speedNow(), clip.modelSpeed)
  element.playbackRate = element.defaultPlaybackRate
  // The owner clicked further along the line's bar before it played.
  if (startAt > 0) element.currentTime = startAt
  const audio = new THREE.PositionalAudio(listener)
  audio.setMediaElementSource(element)
  // Full volume within 3 m, about half at 7 m, a murmur across the plaza.
  audio.setDistanceModel('inverse')
  audio.setRefDistance(3)
  audio.setRolloffFactor(1.3)
  audio.setVolume(1)

  // The mouth follows the element's clock (the clip's own seconds, whatever the rate), so it stays in step at any speed.
  const timeline = buildVisemeTimeline(clip.alignment)
  let lip: LipSyncController | null = null
  if (timeline.cues.length) {
    lip = createVisemeLipSync(timeline)
    lip.attachAudio(element)
  }
  const lipId = villageLipSyncId(agentId)
  // The clip must never outlive a running context: a suspended one (a device change, the OS) plays on in silence,
  // and an audio object left in the scene would queue Web Audio ramps every frame (the fps-decay mission).
  const stop = () => {
    if (playing?.audio !== audio) return
    endPlayback()
    if (token === speechToken) setSpeech(null)
  }
  const onState = () => { if ((context.state as AudioContextState) !== 'running') stop() }
  let timeout = 0
  const armTimeout = () => {
    window.clearTimeout(timeout)
    // Paused in its player: it waits, but not for ever (an audio object in the scene costs a little every
    // frame): after ten minutes it is done. The usual clock starts again when it plays.
    if (element.paused) {
      timeout = window.setTimeout(stop, 10 * 60 * 1000)
      return
    }
    const seconds = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : timeline.duration || 60
    const left = Math.max(0, seconds - element.currentTime) / Math.max(0.5, element.playbackRate)
    timeout = window.setTimeout(stop, (left + 2) * 1000)
  }
  element.addEventListener('ended', stop)
  element.addEventListener('error', stop)
  element.addEventListener('ratechange', armTimeout)
  element.addEventListener('durationchange', armTimeout)
  element.addEventListener('pause', armTimeout)
  element.addEventListener('play', armTimeout)
  element.addEventListener('seeked', armTimeout)
  context.addEventListener('statechange', onState)
  const release = () => {
    element.removeEventListener('ended', stop)
    element.removeEventListener('error', stop)
    element.removeEventListener('ratechange', armTimeout)
    element.removeEventListener('durationchange', armTimeout)
    element.removeEventListener('pause', armTimeout)
    element.removeEventListener('play', armTimeout)
    element.removeEventListener('seeked', armTimeout)
    context.removeEventListener('statechange', onState)
    window.clearTimeout(timeout)
  }
  // In the scene only from here on (it schedules audio work every frame it is there).
  head.add(audio)
  playing = { key: settings.key, agentId, text, alignment: clip.alignment, timelineSeconds: timeline.duration, audio, element, modelSpeed: clip.modelSpeed, voice, lipId, lip, release }
  armTimeout()
  try {
    await element.play()
  } catch (error) {
    if (playing?.audio === audio) endPlayback()
    if (token !== speechToken) return false
    // The file may have been pruned on the server: ask again next time.
    clips.delete(clipKey(text, voice, plan.modelSpeed))
    console.warn(`[village] speech failed: ${error instanceof Error ? error.message : String(error)}`)
    return fail('playback failed')
  }
  if (token !== speechToken || playing?.audio !== audio) return false
  if (lip) registerLipSync(lipId, lip)
  const seconds = Number.isFinite(element.duration) ? element.duration : timeline.duration
  lastSpeech = {
    agentId, text, at: Date.now(), waitMs: Math.round(performance.now() - askedAt),
    result: `playing ${seconds.toFixed(1)}s clip at ${element.playbackRate}x (${voice}, voice speed ${clip.modelSpeed}, setting ${speedNow()}x), ${timeline.cues.length} mouth cues`,
  }
  setSpeech({ agentId, text, phase: 'speaking' })
  return true
}
