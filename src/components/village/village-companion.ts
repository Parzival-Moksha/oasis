// ░▒▓ VILLAGE COMPANION — who follows the owner, and the voice an agent's avatar speaks with ▓▒░
// Two things live here, both local to this tab:
//   1. The "Follow me" choice per agent (remembered per session in this browser; Anorak follows by default).
//      The walking itself is VillageStation's (VillageWorld.tsx) with the rules in lib/village/village-follow.ts.
//   2. Speech: a voiced agent's reply ends with <spoken>…</spoken> (lib/village/village-spoken.ts). When its
//      turn ends, the line is fetched as an ElevenLabs clip (/api/village/speak, cached by text) and played from
//      the avatar's head through three's PositionalAudio: louder when close, with the mouth moving
//      (the clip's character timings drive the same lip-sync registry the world's NPCs use).
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
import { SPOKEN_MAX_CHARS, cleanSpoken } from '../../lib/village/village-spoken'

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
}

let speech: VillageSpeech | null = null
let speechToken = 0
let playing: { audio: THREE.PositionalAudio; lipId: string; lip: LipSyncController | null; release: () => void } | null = null
let lastSpeech: { agentId: string; text: string; at: number; result: string } | null = null
const speechListeners = new Set<() => void>()
/** Fetched clips (metadata) and decoded audio for this page: a replay neither asks the server nor decodes again. */
const clips = new Map<string, Promise<Clip>>()
const buffers = new Map<string, AudioBuffer>()
const BUFFER_KEEP = 6

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

/** For window.__oasisVillage.speech() (dev) and the playtest. */
export function getVillageSpeechDebug() {
  const listener = getAudioListener()
  return { on: isVillageVoiceOn(), audio: listener?.context.state || 'none', speech, last: lastSpeech, heads: [...heads.keys()] }
}

function endPlayback(): void {
  const current = playing
  if (!current) return
  playing = null
  current.release()
  unregisterLipSync(current.lipId, current.lip || undefined)
  try {
    if (current.audio.isPlaying) current.audio.stop()
  } catch { /* already stopped */ }
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

const clipKey = (text: string, voice: string) => `${voice}\n${text}`

function fetchClip(text: string, voice: string): Promise<Clip> {
  const key = clipKey(text, voice)
  let job = clips.get(key)
  if (!job) {
    job = fetch('/api/village/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    }).then(async response => {
      const data = await response.json().catch(() => ({})) as Partial<Clip> & { error?: string }
      if (!response.ok || !data.id || !data.url) throw new Error(data.error || `speech failed (${response.status})`)
      return { id: data.id, url: data.url, alignment: data.alignment || null }
    })
    clips.set(key, job)
    job.catch(() => { clips.delete(key) })
  }
  return job
}

async function loadBuffer(clip: Clip, context: AudioContext): Promise<AudioBuffer> {
  const known = buffers.get(clip.id)
  if (known) return known
  const response = await fetch(clip.url)
  if (!response.ok) throw new Error(`speech audio failed (${response.status})`)
  const buffer = await context.decodeAudioData(await response.arrayBuffer())
  buffers.set(clip.id, buffer)
  while (buffers.size > BUFFER_KEEP) buffers.delete(buffers.keys().next().value as string)
  return buffer
}

/**
 * Say `text` from the agent's avatar. A new line stops the one before it. Resolves true once it plays.
 * Needs sound to be allowed on the page (any click or key press does that); without it nothing is
 * fetched, so a silent tab costs nothing. `byHand`: the owner clicked play, so the click itself may
 * unlock sound; a reply that speaks on its own never waits for that (it would be said much later).
 */
export async function speakVillageAgent(agentId: string, rawText: string, voice: string, byHand = false): Promise<boolean> {
  const text = cleanSpoken(rawText, SPOKEN_MAX_CHARS)
  stopVillageSpeech()
  const token = speechToken
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
  let buffer: AudioBuffer
  let clip: Clip
  try {
    clip = await fetchClip(text, voice)
    if (token !== speechToken) return false
    buffer = await loadBuffer(clip, context)
  } catch (error) {
    // Forget the clip: the server may have pruned its file, and the next try should ask again.
    clips.delete(clipKey(text, voice))
    console.warn(`[village] speech failed: ${error instanceof Error ? error.message : String(error)}`)
    return fail('fetch failed')
  }
  if (token !== speechToken) return false
  if ((context.state as AudioContextState) !== 'running') return fail('audio suspended')

  // From the avatar's head. (Never on the listener itself: it hangs on the camera, whose matrix every label updates.)
  const head = speechSource(agentId)
  if (!head) return fail('no avatar in the scene')
  const audio = new THREE.PositionalAudio(listener)
  audio.setBuffer(buffer)
  // Full volume within 3 m, about half at 7 m, a murmur across the plaza.
  audio.setDistanceModel('inverse')
  audio.setRefDistance(3)
  audio.setRolloffFactor(1.3)
  audio.setVolume(1)
  head.add(audio)

  let startedAt = 0
  let live = true
  const timeline = buildCharacterMouthTimeline(clip.alignment)
  let lip: LipSyncController | null = null
  if (timeline.cues.length) {
    lip = createTimedLipSyncController(timeline)
    // The controller reads a media element's clock; this is the clip's, on the AudioContext.
    const clock = {
      get paused() { return !live },
      get ended() { return !live },
      get currentTime() { return context.currentTime - startedAt },
    }
    lip.attachAudio(clock as unknown as HTMLMediaElement)
  }
  const lipId = villageLipSyncId(agentId)
  const onEnded = audio.onEnded.bind(audio)
  audio.onEnded = () => {
    onEnded()
    live = false
    if (playing?.audio !== audio) return
    endPlayback()
    if (token === speechToken) setSpeech(null)
  }
  // The clip must never outlive a running context: a suspended one (a device change, the OS) fires no "ended",
  // and an audio object left playing would queue Web Audio ramps every frame (the fps-decay mission).
  const stop = () => {
    live = false
    if (playing?.audio !== audio) return
    endPlayback()
    if (token === speechToken) setSpeech(null)
  }
  const onState = () => { if ((context.state as AudioContextState) !== 'running') stop() }
  context.addEventListener('statechange', onState)
  const timeout = window.setTimeout(stop, (buffer.duration + 1.5) * 1000)
  const release = () => {
    context.removeEventListener('statechange', onState)
    window.clearTimeout(timeout)
  }
  playing = { audio, lipId, lip, release }
  if (lip) registerLipSync(lipId, lip)
  audio.play()
  startedAt = context.currentTime
  lastSpeech = { agentId, text, at: Date.now(), result: `playing ${buffer.duration.toFixed(1)}s, ${timeline.cues.length} mouth cues` }
  setSpeech({ agentId, text, phase: 'speaking' })
  return true
}
