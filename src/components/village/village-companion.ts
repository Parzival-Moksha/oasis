// ░▒▓ VILLAGE COMPANION — who follows the owner, and the voice an agent's avatar speaks with ▓▒░
// Two things live here, both local to this tab:
//   1. The "Follow me" choice per agent (remembered per session in this browser; Anorak follows by default).
//      The walking itself is VillageStation's (VillageWorld.tsx) with the rules in lib/village/village-follow.ts.
//   2. Speech: a voiced agent's reply ends with <spoken>…</spoken> (lib/village/village-spoken.ts). As soon as
//      that line is complete (VillageVoice.tsx), it is fetched as an ElevenLabs clip (/api/village/speak, cached
//      by text) and played from the avatar's head through three's PositionalAudio: louder when close, with the
//      mouth moving (the clip's character timings drive the same lip-sync registry the world's NPCs use), at
//      the speed the owner set (0.8x to 1.6x, pitch kept).
//
// Frame-rate note (fps-decay mission): a PositionalAudio schedules Web Audio ramps every frame while it
// plays. It is only in the scene while a clip plays, and a clip only starts on a running AudioContext, so
// nothing can queue ramps on a suspended context the way the listener once did.

import * as THREE from 'three'
import { getAudioListener } from '../CameraController'
import { registerLipSync, unregisterLipSync, type LipSyncController } from '../../lib/lip-sync'
import { buildCharacterMouthTimeline, type ElevenLabsAlignment } from '../../lib/lip-sync-lab'
import { createTimedLipSyncController } from '../../lib/hosted-welcome-lipsync'
import { parseFollowPrefs, wantsFollow, withFollowChoice, type FollowPrefs } from '../../lib/village/village-follow'
import { SPEECH_SPEED, SPOKEN_MAX_CHARS, clampSpeechSpeed, cleanSpoken, playbackRateFor, speechSpeedPlan } from '../../lib/village/village-spoken'

// ─── follow ─────────────────────────────────────────────────────────────────

const FOLLOW_KEY = 'oasis.village.follow'
let followPrefs: FollowPrefs | null = null
let followVersion = 0
const followListeners = new Set<() => void>()

function loadFollowPrefs(): FollowPrefs {
  if (followPrefs === null) {
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

// ─── how fast it talks (the "1.2×" next to the Voice switch) ────────────────

const SPEED_KEY = 'oasis.village.voiceSpeed'
let speechSpeed: number | null = null
const speedListeners = new Set<() => void>()

/** The owner's speed for every spoken reply (0.8 to 1.6, 1.2 unless they chose another), remembered in this browser. */
export function getVillageSpeechSpeed(): number {
  if (speechSpeed === null) {
    try {
      const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(SPEED_KEY)
      speechSpeed = raw ? clampSpeechSpeed(raw) : SPEECH_SPEED.default
    } catch {
      speechSpeed = SPEECH_SPEED.default
    }
  }
  return speechSpeed
}

/** Applies to the clip that is playing too (its rate changes at once; the next clip is made at the new speed). */
export function setVillageSpeechSpeed(value: number): void {
  speechSpeed = clampSpeechSpeed(value)
  try {
    window.localStorage.setItem(SPEED_KEY, String(speechSpeed))
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  if (playing) playing.element.playbackRate = playbackRateFor(speechSpeed, playing.modelSpeed)
  speedListeners.forEach(listener => listener())
}

export function subscribeVillageSpeechSpeed(listener: () => void): () => void {
  speedListeners.add(listener)
  return () => { speedListeners.delete(listener) }
}

// ─── speech ─────────────────────────────────────────────────────────────────

export interface VillageSpeech {
  agentId: string
  /** The cleaned line being fetched or said. */
  text: string
  phase: 'loading' | 'speaking'
}

interface Clip {
  id: string
  url: string
  alignment: ElevenLabsAlignment | null
  /** ElevenLabs' voice speed the clip was made with. */
  modelSpeed: number
}

interface Playback {
  audio: THREE.PositionalAudio
  element: HTMLAudioElement
  modelSpeed: number
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
    speed: getVillageSpeechSpeed(),
    speech,
    last: lastSpeech,
    playing: playing ? { rate: playing.element.playbackRate, modelSpeed: playing.modelSpeed, time: playing.element.currentTime, duration: playing.element.duration, preservesPitch: (playing.element as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch !== false } : null,
    heads: [...heads.keys()],
  }
}

function endPlayback(): void {
  const current = playing
  if (!current) return
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
}

/** Stop whatever is being said (or fetched). */
export function stopVillageSpeech(): void {
  speechToken += 1
  endPlayback()
  if (speech) setSpeech(null)
}

const clipKey = (text: string, voice: string, modelSpeed: number) => `${voice}\n${modelSpeed}\n${text}`

function fetchClip(text: string, voice: string, modelSpeed: number): Promise<Clip> {
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
      return { id: data.id, url: data.url, alignment: data.alignment || null, modelSpeed: typeof data.modelSpeed === 'number' ? data.modelSpeed : 1 }
    })
    clips.set(key, job)
    job.catch(() => { clips.delete(key) })
  }
  return job
}

/**
 * Say `text` from the agent's avatar, at the owner's speed. A new line stops the one before it. Resolves true
 * once it plays. Needs sound to be allowed on the page (any click or key press does that); without it nothing
 * is fetched, so a silent tab costs nothing. `byHand`: the owner clicked play, so the click itself may
 * unlock sound; a reply that speaks on its own never waits for that (it would be said much later).
 *
 * The clip plays through an <audio> element feeding three's PositionalAudio: the element starts while the
 * file is still arriving, keeps the pitch when it plays faster or slower than the clip was made, and its
 * clock (in the clip's own seconds, whatever the rate) drives the mouth.
 */
export async function speakVillageAgent(agentId: string, rawText: string, voice: string, byHand = false): Promise<boolean> {
  const text = cleanSpoken(rawText, SPOKEN_MAX_CHARS)
  stopVillageSpeech()
  const token = speechToken
  const askedAt = performance.now()
  const fail = (result: string) => {
    lastSpeech = { agentId, text, at: Date.now(), result }
    if (token === speechToken) setSpeech(null)
    return false
  }
  const listener = getAudioListener()
  if (!text || !listener) return fail(text ? 'no audio listener' : 'nothing to say')
  const context = listener.context
  if (context.state !== 'running') {
    if (!byHand) return fail('audio locked until a click or key press')
    try { await context.resume() } catch { /* stays suspended until a gesture */ }
    if ((context.state as AudioContextState) !== 'running') return fail('audio locked until a click or key press')
  }
  if (token !== speechToken) return false
  setSpeech({ agentId, text, phase: 'loading' })
  const plan = speechSpeedPlan(getVillageSpeechSpeed())
  let clip: Clip
  try {
    clip = await fetchClip(text, voice, plan.modelSpeed)
  } catch (error) {
    console.warn(`[village] speech failed: ${error instanceof Error ? error.message : String(error)}`)
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
  element.defaultPlaybackRate = playbackRateFor(getVillageSpeechSpeed(), clip.modelSpeed)
  element.playbackRate = element.defaultPlaybackRate
  const audio = new THREE.PositionalAudio(listener)
  audio.setMediaElementSource(element)
  // Full volume within 3 m, about half at 7 m, a murmur across the plaza.
  audio.setDistanceModel('inverse')
  audio.setRefDistance(3)
  audio.setRolloffFactor(1.3)
  audio.setVolume(1)

  const timeline = buildCharacterMouthTimeline(clip.alignment)
  let lip: LipSyncController | null = null
  if (timeline.cues.length) {
    lip = createTimedLipSyncController(timeline)
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
    const seconds = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : timeline.duration || 60
    const left = Math.max(0, seconds - element.currentTime) / Math.max(0.5, element.playbackRate)
    timeout = window.setTimeout(stop, (left + 2) * 1000)
  }
  element.addEventListener('ended', stop)
  element.addEventListener('error', stop)
  element.addEventListener('ratechange', armTimeout)
  element.addEventListener('durationchange', armTimeout)
  context.addEventListener('statechange', onState)
  const release = () => {
    element.removeEventListener('ended', stop)
    element.removeEventListener('error', stop)
    element.removeEventListener('ratechange', armTimeout)
    element.removeEventListener('durationchange', armTimeout)
    context.removeEventListener('statechange', onState)
    window.clearTimeout(timeout)
  }
  // In the scene only from here on (it schedules audio work every frame it is there).
  head.add(audio)
  playing = { audio, element, modelSpeed: clip.modelSpeed, lipId, lip, release }
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
    result: `playing ${seconds.toFixed(1)}s clip at ${element.playbackRate}x (voice speed ${clip.modelSpeed}, setting ${getVillageSpeechSpeed()}x), ${timeline.cues.length} mouth cues`,
  }
  setSpeech({ agentId, text, phase: 'speaking' })
  return true
}
