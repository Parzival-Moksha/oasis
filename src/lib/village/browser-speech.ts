// Spoken replies without any key: the browser's built-in voices (the Web Speech API, which uses the voices
// of the operating system). The village falls back to this when the page server has no ElevenLabs key.
// No file is made and nothing leaves the machine. The mouth does not follow these voices yet: the browser
// gives the page no audio to listen to.

export function browserSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

/** FNV-1a: the same agent voice key picks the same browser voice every time. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export interface BrowserVoiceLike { name: string; lang: string; localService?: boolean; default?: boolean }

/**
 * One of the browser's voices for an agent's voice key: among the voices of the page's language (else English,
 * else all), voices that run on the machine first, picked by the key so each agent keeps its own.
 */
export function pickBrowserVoice<T extends BrowserVoiceLike>(voices: T[], key: string, lang = 'en'): T | null {
  if (!voices.length) return null
  const base = lang.toLowerCase().split('-')[0]
  const inLang = (code: string) => voices.filter(v => v.lang.toLowerCase().startsWith(code))
  let pool = inLang(base)
  if (!pool.length) pool = inLang('en')
  if (!pool.length) pool = voices
  const local = pool.filter(v => v.localService !== false)
  if (local.length) pool = local
  const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name))
  return sorted[hash(key) % sorted.length]
}

let current: SpeechSynthesisUtterance | null = null

/** Stop the browser voice if it is talking. */
export function stopBrowserSpeech(): void {
  if (!browserSpeechAvailable()) return
  const was = current
  current = null
  if (was) {
    was.onend = null
    was.onerror = null
  }
  window.speechSynthesis.cancel()
}

/** Say `text` in the browser's voice for `voiceKey`. Returns false when the browser cannot. `onEnd` runs once, at the end or on failure. */
export function speakInBrowser(text: string, options: { voiceKey: string; rate?: number; onEnd?: () => void }): boolean {
  if (!browserSpeechAvailable() || !text.trim()) return false
  stopBrowserSpeech()
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = pickBrowserVoice(window.speechSynthesis.getVoices(), options.voiceKey, document.documentElement.lang || navigator.language || 'en')
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }
  utterance.rate = Math.min(2, Math.max(0.5, options.rate || 1))
  const done = () => {
    if (current !== utterance) return
    current = null
    options.onEnd?.()
  }
  utterance.onend = done
  utterance.onerror = done
  current = utterance
  window.speechSynthesis.speak(utterance)
  return true
}
