// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// AUDIO MANAGER — Sound effects for the Oasis
// ─═̷─═̷─ॐ─═̷─═̷─ Every action has a voice ─═̷─═̷─ॐ─═̷─═̷─
//
// Event-driven: subscribes to EventBus commands + custom triggers.
// Per-event sound selection: each event has multiple sound options.
// User picks their preferred sound per event in Settings.
// Volume + mute controls. Persisted to localStorage.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { create } from 'zustand'
import { eventBus, type OasisCommand } from './event-bus'

// ═══════════════════════════════════════════════════════════════════════════
// SOUND EVENTS — every triggerable sound in the system
// ═══════════════════════════════════════════════════════════════════════════

export type SoundEvent =
  | 'select'        // Object selected
  | 'deselect'      // Object deselected
  | 'place'         // Object placed in world
  | 'delete'        // Object deleted
  | 'panelOpen'     // Any panel opens
  | 'panelClose'    // Any panel closes
  | 'buttonClick'   // UI button clicked
  | 'buttonHover'   // UI button hovered
  | 'modeSwitch'    // Camera mode changed
  | 'conjureStart'  // Conjuration started
  | 'conjureDone'   // Conjuration completed
  | 'anorakDone'    // Anorak finished response
  | 'notification'  // DevCraft timer, mission complete
  | 'undo'          // Undo action
  | 'redo'          // Redo action
  | 'agentFocus'    // Enter zoomon mode
  | 'agentUnfocus'  // Exit zoomon mode
  | 'tilePaint'     // Ground tile painted
  | 'error'         // Error occurred
  | 'footstep'      // Avatar footstep (TPS mode)

// ═══════════════════════════════════════════════════════════════════════════
// SOUND OPTIONS — available sounds per event
// Each event has multiple choices. User picks one in Settings.
// ═══════════════════════════════════════════════════════════════════════════

const UI = '/audio/kenney-ui/Audio'
const RPG = '/audio/kenney-rpg/Audio'

export interface SoundOption {
  id: string
  label: string
  path: string
}

export const SOUND_OPTIONS: Record<SoundEvent, SoundOption[]> = {
  select:       [{ id: 'click1', label: 'Click 1', path: `${UI}/click1.ogg` }, { id: 'click2', label: 'Click 2', path: `${UI}/click2.ogg` }, { id: 'click3', label: 'Click 3', path: `${UI}/click3.ogg` }, { id: 'click4', label: 'Click 4', path: `${UI}/click4.ogg` }, { id: 'click5', label: 'Click 5', path: `${UI}/click5.ogg` }],
  deselect:     [{ id: 'release1', label: 'Release', path: `${UI}/mouserelease1.ogg` }, { id: 'click3', label: 'Soft Click', path: `${UI}/click3.ogg` }],
  place:        [{ id: 'place1', label: 'Book Place 1', path: `${RPG}/bookPlace1.ogg` }, { id: 'place2', label: 'Book Place 2', path: `${RPG}/bookPlace2.ogg` }, { id: 'place3', label: 'Book Place 3', path: `${RPG}/bookPlace3.ogg` }],
  delete:       [{ id: 'chop', label: 'Chop', path: `${RPG}/chop.ogg` }, { id: 'knife', label: 'Knife Slice', path: `${RPG}/knifeSlice.ogg` }],
  panelOpen:    [{ id: 'open1', label: 'Book Open', path: `${RPG}/bookOpen.ogg` }, { id: 'door1', label: 'Door Open', path: `${RPG}/doorOpen_1.ogg` }, { id: 'creak1', label: 'Creak', path: `${RPG}/creak1.ogg` }],
  panelClose:   [{ id: 'close1', label: 'Book Close', path: `${RPG}/bookClose.ogg` }, { id: 'door1', label: 'Door Close', path: `${RPG}/doorClose_1.ogg` }],
  buttonClick:  [{ id: 'switch1', label: 'Switch 1', path: `${UI}/switch1.ogg` }, { id: 'switch2', label: 'Switch 2', path: `${UI}/switch2.ogg` }, { id: 'switch3', label: 'Switch 3', path: `${UI}/switch3.ogg` }, { id: 'switch4', label: 'Switch 4', path: `${UI}/switch4.ogg` }, { id: 'switch5', label: 'Switch 5', path: `${UI}/switch5.ogg` }],
  buttonHover:  [{ id: 'roll1', label: 'Rollover 1', path: `${UI}/rollover1.ogg` }, { id: 'roll2', label: 'Rollover 2', path: `${UI}/rollover2.ogg` }, { id: 'roll3', label: 'Rollover 3', path: `${UI}/rollover3.ogg` }],
  modeSwitch:   [{ id: 'sw6', label: 'Switch 6', path: `${UI}/switch6.ogg` }, { id: 'sw7', label: 'Switch 7', path: `${UI}/switch7.ogg` }, { id: 'sw8', label: 'Switch 8', path: `${UI}/switch8.ogg` }, { id: 'sw9', label: 'Switch 9', path: `${UI}/switch9.ogg` }],
  conjureStart: [{ id: 'draw1', label: 'Draw Knife 1', path: `${RPG}/drawKnife1.ogg` }, { id: 'draw2', label: 'Draw Knife 2', path: `${RPG}/drawKnife2.ogg` }, { id: 'belt', label: 'Belt Handle', path: `${RPG}/beltHandle1.ogg` }],
  conjureDone:  [{ id: 'latch', label: 'Metal Latch', path: `${RPG}/metalLatch.ogg` }, { id: 'coins', label: 'Coins', path: `${RPG}/handleCoins.ogg` }],
  anorakDone:   [{ id: 'coins', label: 'Coins', path: `${RPG}/handleCoins.ogg` }, { id: 'latch', label: 'Metal Latch', path: `${RPG}/metalLatch.ogg` }, { id: 'book', label: 'Book Close', path: `${RPG}/bookClose.ogg` }],
  notification: [{ id: 'metal', label: 'Metal Click', path: `${RPG}/metalClick.ogg` }, { id: 'coins2', label: 'Coins 2', path: `${RPG}/handleCoins2.ogg` }, { id: 'sw10', label: 'Switch 10', path: `${UI}/switch10.ogg` }],
  undo:         [{ id: 'sw11', label: 'Switch 11', path: `${UI}/switch11.ogg` }, { id: 'sw12', label: 'Switch 12', path: `${UI}/switch12.ogg` }],
  redo:         [{ id: 'sw13', label: 'Switch 13', path: `${UI}/switch13.ogg` }, { id: 'sw14', label: 'Switch 14', path: `${UI}/switch14.ogg` }],
  agentFocus:   [{ id: 'open1', label: 'Door Open', path: `${RPG}/doorOpen_1.ogg` }, { id: 'open2', label: 'Door Open 2', path: `${RPG}/doorOpen_2.ogg` }],
  agentUnfocus: [{ id: 'close1', label: 'Door Close', path: `${RPG}/doorClose_1.ogg` }, { id: 'close2', label: 'Door Close 2', path: `${RPG}/doorClose_2.ogg` }],
  tilePaint:    [{ id: 'cloth1', label: 'Cloth 1', path: `${RPG}/cloth1.ogg` }, { id: 'cloth2', label: 'Cloth 2', path: `${RPG}/cloth2.ogg` }, { id: 'cloth3', label: 'Cloth 3', path: `${RPG}/cloth3.ogg` }],
  error:        [{ id: 'pot1', label: 'Metal Pot 1', path: `${RPG}/metalPot1.ogg` }, { id: 'pot2', label: 'Metal Pot 2', path: `${RPG}/metalPot2.ogg` }],
  footstep:     [{ id: 'step0', label: 'Step 0', path: `${RPG}/footstep00.ogg` }, { id: 'step1', label: 'Step 1', path: `${RPG}/footstep01.ogg` }, { id: 'step2', label: 'Step 2', path: `${RPG}/footstep02.ogg` }, { id: 'step3', label: 'Step 3', path: `${RPG}/footstep03.ogg` }, { id: 'step4', label: 'Step 4', path: `${RPG}/footstep04.ogg` }],
}

// Default sound selection per event (first option)
const DEFAULT_SELECTIONS: Record<SoundEvent, string> = Object.fromEntries(
  Object.entries(SOUND_OPTIONS).map(([event, options]) => [event, options[0].id])
) as Record<SoundEvent, string>

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO CACHE — pre-loaded HTMLAudioElement pool
// ═══════════════════════════════════════════════════════════════════════════

const audioCache = new Map<string, HTMLAudioElement>()

function getAudio(path: string): HTMLAudioElement {
  let audio = audioCache.get(path)
  if (!audio) {
    audio = new Audio(path)
    audio.preload = 'auto'
    audioCache.set(path, audio)
  }
  return audio
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE — audio settings + playback
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'oasis-audio-settings'

interface AudioManagerState {
  /** Master volume 0-1 */
  volume: number
  /** Mute all sounds */
  muted: boolean
  /** Per-event sound selection (sound option ID) */
  selections: Record<SoundEvent, string>

  /** Play a sound event */
  play: (event: SoundEvent) => void
  /** Play a random footstep (for continuous walking) */
  playFootstep: () => void
  /** Set volume */
  setVolume: (v: number) => void
  /** Toggle mute */
  toggleMute: () => void
  /** Change the selected sound for an event */
  selectSound: (event: SoundEvent, optionId: string) => void
  /** Preview a specific sound option */
  preview: (event: SoundEvent, optionId: string) => void
}

function loadSettings(): { volume: number; muted: boolean; selections: Record<SoundEvent, string> } {
  if (typeof window === 'undefined') return { volume: 0.5, muted: false, selections: { ...DEFAULT_SELECTIONS } }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return {
        volume: parsed.volume ?? 0.5,
        muted: parsed.muted ?? false,
        selections: { ...DEFAULT_SELECTIONS, ...parsed.selections },
      }
    }
  } catch {}
  return { volume: 0.5, muted: false, selections: { ...DEFAULT_SELECTIONS } }
}

function saveSettings(state: { volume: number; muted: boolean; selections: Record<SoundEvent, string> }) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      volume: state.volume,
      muted: state.muted,
      selections: state.selections,
    }))
  } catch {}
}

// Footstep alternation — cycle through available footstep sounds
let footstepIndex = 0

export const useAudioManager = create<AudioManagerState>((set, get) => {
  const initial = loadSettings()

  return {
    ...initial,

    play: (event) => {
      const { muted, volume, selections } = get()
      if (muted || volume === 0) return

      const optionId = selections[event]
      const options = SOUND_OPTIONS[event]
      const option = options.find(o => o.id === optionId) || options[0]
      if (!option) return

      const audio = getAudio(option.path)
      audio.volume = volume
      audio.currentTime = 0
      audio.play().catch(() => {})  // ignore autoplay policy errors
    },

    playFootstep: () => {
      const { muted, volume } = get()
      if (muted || volume === 0) return

      const steps = SOUND_OPTIONS.footstep
      const step = steps[footstepIndex % steps.length]
      footstepIndex++

      const audio = getAudio(step.path)
      audio.volume = volume * 0.4  // footsteps quieter than UI sounds
      audio.currentTime = 0
      audio.play().catch(() => {})
    },

    setVolume: (v) => {
      set({ volume: Math.max(0, Math.min(1, v)) })
      saveSettings(get())
    },

    toggleMute: () => {
      set(s => ({ muted: !s.muted }))
      saveSettings(get())
    },

    selectSound: (event, optionId) => {
      set(s => ({
        selections: { ...s.selections, [event]: optionId }
      }))
      saveSettings(get())
    },

    preview: (event, optionId) => {
      const options = SOUND_OPTIONS[event]
      const option = options.find(o => o.id === optionId)
      if (!option) return
      const audio = getAudio(option.path)
      audio.volume = get().volume
      audio.currentTime = 0
      audio.play().catch(() => {})
    },
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// EVENTBUS SUBSCRIBER — auto-play sounds when commands dispatch
// ═══════════════════════════════════════════════════════════════════════════

const COMMAND_TO_SOUND: Partial<Record<OasisCommand['type'], SoundEvent>> = {
  SELECT_OBJECT: 'select',
  DELETE_OBJECT: 'delete',
  FOCUS_AGENT_WINDOW: 'agentFocus',
  UNFOCUS_AGENT_WINDOW: 'agentUnfocus',
  UNDO: 'undo',
  REDO: 'redo',
  ENTER_PLACEMENT: 'conjureStart',
  CANCEL_PLACEMENT: 'deselect',
  SAVE_WORLD: undefined,  // too frequent, skip
  SPAWN_VFX: 'place',
}

let audioSubscribed = false

export function registerAudioSubscriber(): () => void {
  if (audioSubscribed) return () => {}
  audioSubscribed = true

  const unsub = eventBus.subscribe((cmd) => {
    const soundEvent = COMMAND_TO_SOUND[cmd.type]
    if (soundEvent) {
      useAudioManager.getState().play(soundEvent)
    }

    // Special: deselect sound when SELECT_OBJECT with null
    if (cmd.type === 'SELECT_OBJECT' && !cmd.payload.id) {
      useAudioManager.getState().play('deselect')
    }
  })

  return () => {
    unsub()
    audioSubscribed = false
  }
}
