// ░▒▓ SPOKEN LANGUAGE — which language a spoken line is in, when the village's default voice model can't say it ▓▒░
// The owner and a friend talked to Anorak in Hungarian (2026-11-20): its lines came out with an English accent,
// because the default model (eleven_multilingual_v2) has no Hungarian and reads it by English rules. So each line is
// looked at here, cheaply and on this machine: a language the default model knows (English and its other 28) gives
// null and nothing changes; one it doesn't (Hungarian, Vietnamese) gives its ISO 639-1 code, and the line goes to a
// model that speaks it, with that code (village-speech-server.ts). The browser's own voices use it too
// (browser-speech.ts). Pure: no I/O.

/** ElevenLabs eleven_multilingual_v2's 29 languages (docs, 2026-11-20). */
export const MULTILINGUAL_V2_LANGUAGES = new Set([
  'en', 'ja', 'zh', 'de', 'hi', 'fr', 'ko', 'pt', 'it', 'es', 'id', 'nl', 'tr', 'fil', 'pl', 'sv', 'bg', 'ro', 'ar', 'cs',
  'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'ru',
])

// Short, frequent Hungarian words, none of them an English word.
const HUNGARIAN_WORDS = new Set([
  'és', 'hogy', 'nem', 'egy', 'az', 'ez', 'van', 'meg', 'de', 'mit', 'már', 'csak', 'még', 'vagy', 'kell', 'lesz',
  'nincs', 'igen', 'szia', 'sziasztok', 'köszönöm', 'köszi', 'most', 'itt', 'ott', 'jó', 'mert', 'amit', 'ami', 'ha',
  'ezt', 'azt', 'nagyon', 'majd', 'akkor', 'vagyok', 'vagyunk', 'tudod', 'tudom', 'kérlek', 'mi', 'te', 'én', 'ő',
  'nekem', 'neked', 'magyar', 'magyarul', 'szép', 'rendben', 'persze', 'úgy', 'így', 'hol', 'mikor', 'miért', 'hogyan',
  'lett', 'volt', 'vannak', 'minden', 'semmi', 'valami', 'kész', 'jól', 'talán', 'utána', 'előtt', 'után', 'között',
])
// ő and ű are Hungarian's own letters; the others are shared with other languages but still count a little.
const HUNGARIAN_OWN = /[őűŐŰ]/
const HUNGARIAN_ACCENTS = /[áéíóöúüÁÉÍÓÖÚÜ]/
// Vietnamese: letters no other common language uses (ư, ơ, đ, and the dot-below and hook-above vowels).
const VIETNAMESE_OWN = /[ươđƯƠĐạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/g

/**
 * The line's language when the default voice model can't say it, else null (English, the model's other languages,
 * or too little to tell). Cheap: letters and a word list, no model.
 */
export function detectSpokenLanguage(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}]+/gu) || [])
  if (!words.length) return null
  if ((text.match(VIETNAMESE_OWN) || []).length >= 2) return 'vi'
  let own = 0
  let score = 0
  for (const word of words) {
    if (HUNGARIAN_OWN.test(word)) { own += 1; score += 2; continue }
    if (HUNGARIAN_WORDS.has(word)) { score += 1; continue }
    if (HUNGARIAN_ACCENTS.test(word)) score += 0.5
  }
  // Two own-letter words, or enough of the line looking Hungarian (a stray "és" in English isn't enough).
  if (own >= 2 || (score >= 2 && score >= words.length * 0.3)) return 'hu'
  return null
}

/** Whether the default model (eleven_multilingual_v2) says `language` itself. */
export function defaultModelSpeaks(language: string | null): boolean {
  return !language || MULTILINGUAL_V2_LANGUAGES.has(language)
}
