import type { ObjectBehavior } from './conjure/types'

export const SPELL_CAST_ANIMATION_ID = 'ual-spell-shoot'
export const SPELL_CAST_BEHAVIOR_CLIP = `lib:${SPELL_CAST_ANIMATION_ID}`
export const SPELL_CAST_DURATION_MS = 3000
export const SPELL_CAST_SOUND_URL = '/audio/kenney_voiceover-pack/Female/power_up.ogg'
export const MANA_RECHARGE_ANIMATION_ID = 'capoeira'

export function withSpellCastAnimation(behavior?: ObjectBehavior): ObjectBehavior {
  const existing = behavior || { movement: { type: 'static' as const }, visible: true }
  return {
    ...existing,
    animation: {
      clipName: SPELL_CAST_BEHAVIOR_CLIP,
      loop: 'repeat',
      speed: 1,
    },
  }
}

export function withoutSpellCastAnimation(behavior?: ObjectBehavior): ObjectBehavior | null {
  if (!behavior) return null
  if (behavior.animation?.clipName !== SPELL_CAST_BEHAVIOR_CLIP) return behavior
  const { animation: _animation, ...rest } = behavior
  return rest as ObjectBehavior
}
