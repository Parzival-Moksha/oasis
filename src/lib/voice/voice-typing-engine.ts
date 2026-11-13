// ░▒▓ VOICE TYPING ENGINE — who turns live speech into text: ElevenLabs (default) or Moonshine on this computer ▓▒░
// Settings → Sound → Voice typing. Saved per browser. The agent engine does the work either way (/listen): it streams
// to ElevenLabs Scribe Realtime with its key, or runs Moonshine locally on the CPU. An engine without an ElevenLabs
// key, or one from before this switch, types with Moonshine.

export type VoiceTypingEngine = 'elevenlabs' | 'local'

export const DEFAULT_VOICE_TYPING_ENGINE: VoiceTypingEngine = 'elevenlabs'
const STORAGE_KEY = 'oasis.voiceTyping.engine.v1'

const listeners = new Set<() => void>()

export function parseVoiceTypingEngine(value: unknown): VoiceTypingEngine {
  return value === 'local' || value === 'elevenlabs' ? value : DEFAULT_VOICE_TYPING_ENGINE
}

export function getVoiceTypingEngine(): VoiceTypingEngine {
  if (typeof window === 'undefined') return DEFAULT_VOICE_TYPING_ENGINE
  try {
    return parseVoiceTypingEngine(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_VOICE_TYPING_ENGINE
  }
}

export function setVoiceTypingEngine(engine: VoiceTypingEngine): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, engine)
  } catch { /* private mode: this tab only */ }
  listeners.forEach(listener => listener())
}

export function subscribeVoiceTypingEngine(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener() }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
