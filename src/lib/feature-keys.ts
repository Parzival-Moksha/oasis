// Which generation features can work on this machine. Each of them calls a paid service with the user's own
// key, kept in the Oasis's .env file; without the key the feature is shown greyed out with one plain line
// instead of failing after a click. Shared by the server (which keys are set) and the page (what to grey out).

export interface FeatureKeyRule {
  /** The feature's plain name. */
  name: string
  /** Any one of these in the environment is enough. */
  anyOf: string[]
  /** The service the key belongs to. */
  service: string
}

/** By spell id (src/lib/spellbook.ts). A spell not listed here needs no key. */
export const FEATURE_KEY_RULES: Record<string, FeatureKeyRule> = {
  'text-to-music': { name: 'Text to Music', anyOf: ['ELEVENLABS_API_KEY'], service: 'ElevenLabs' },
  'text-to-video': { name: 'Text to Video', anyOf: ['FAL_KEY'], service: 'fal.ai' },
  'text-to-3d': { name: 'Text to 3D', anyOf: ['MESHY_API_KEY', 'TRIPO_API_KEY'], service: 'Meshy or Tripo' },
  'text-to-pic': { name: 'Text to Pic', anyOf: ['OPENROUTER_API_KEY'], service: 'OpenRouter' },
  'text-to-pic-building': { name: 'Text to Pic Building', anyOf: ['OPENROUTER_API_KEY'], service: 'OpenRouter' },
}

export interface FeatureKeyState {
  ready: boolean
  /** One plain line for the person, when not ready. */
  line: string
}

export function missingKeyLine(rule: FeatureKeyRule): string {
  const keys = rule.anyOf.join(' or ')
  return `${rule.name} needs your own ${rule.service} key. Add ${keys} to the .env file in the Oasis folder, then start the Oasis again.`
}

/** The state of every keyed feature, given an environment. */
export function featureKeyStates(env: Record<string, string | undefined>): Record<string, FeatureKeyState> {
  const states: Record<string, FeatureKeyState> = {}
  for (const [id, rule] of Object.entries(FEATURE_KEY_RULES)) {
    const ready = rule.anyOf.some(key => Boolean((env[key] || '').trim()))
    states[id] = { ready, line: ready ? '' : missingKeyLine(rule) }
  }
  return states
}
