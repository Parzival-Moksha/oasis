// ░▒▓ VOICE TYPE FIELD — which text fields get the floating mic, and how dictation lands in them ▓▒░
// Pure helpers for VoiceTypeMic (src/components/forge/VoiceTypeMic.tsx), kept DOM-light so they test fast.

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'email'])

/** How far up from a field to look for a mic it already has (its own button next to it). */
const OWN_MIC_DEPTH = 3

export interface FieldLike {
  tagName: string
  type?: string
  readOnly?: boolean
  disabled?: boolean
  isContentEditable?: boolean
  getAttribute(name: string): string | null
  closest(selector: string): unknown
  parentElement: ParentLike | null
}

export interface ParentLike {
  parentElement: ParentLike | null
  querySelector(selector: string): unknown
}

/** Already has a mic: a [data-voice-mic] button, or one titled "Dictate…", close to the field. */
export const OWN_MIC_SELECTOR = '[data-voice-mic], button[title^="Dictate"], button[aria-label^="Dictate"]'

/** A plain, editable text field (input or textarea) that should get the floating mic. */
export function isVoiceTypeField(el: FieldLike | null | undefined): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') {
    if (!TEXT_INPUT_TYPES.has((el.type || '').toLowerCase())) return false
  } else if (tag !== 'TEXTAREA') {
    return false
  }
  if (el.readOnly || el.disabled) return false
  if (el.closest('[data-voice-mic="off"]')) return false
  let parent = el.parentElement
  for (let depth = 0; parent && depth < OWN_MIC_DEPTH; depth++, parent = parent.parentElement) {
    if (parent.querySelector(OWN_MIC_SELECTOR)) return false
  }
  return true
}

export interface DictationSplice {
  value: string
  /** Caret position right after the spoken words. */
  caret: number
}

/**
 * Put spoken words between what was before and after the caret when the mic started, with a
 * single space on each side where words would otherwise touch.
 */
export function spliceDictation(before: string, spoken: string, after: string): DictationSplice {
  const words = spoken.trim()
  if (!words) return { value: before + after, caret: before.length }
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^\s/.test(after) && !/^[.,!?;:)]/.test(after) ? ' ' : ''
  const head = before + lead + words
  return { value: head + trail + after, caret: head.length }
}

/** Respect a field's maxLength: cut the spoken part, never what was already typed. */
export function clampToMaxLength(before: string, spoken: string, after: string, maxLength: number | null | undefined): string {
  if (!maxLength || maxLength < 0) return spoken
  const room = maxLength - before.length - after.length - 2
  if (room <= 0) return ''
  return spoken.length > room ? spoken.slice(0, room) : spoken
}
