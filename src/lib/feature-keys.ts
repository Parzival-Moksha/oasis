// Which generation features can work on this machine. Each of them calls a paid service with the user's own
// key, kept in the Oasis's .env file; without the key the feature is shown greyed out with one plain line
// instead of failing after a click, and a click opens the keychain at that key (the Character menu, Keys tab).
// Shared by the server (which keys are set) and the page (what to grey out).

export interface FeatureKeyRule {
  /** The feature's plain name. */
  name: string
  /** Any one of these in the environment is enough. */
  anyOf: string[]
  /** The service the key belongs to. */
  service: string
  /** The keychain's id for that key: "needs a key" opens the keychain there. */
  keychainKey: string
}

/** By spell id (src/lib/spellbook.ts). A spell not listed here needs no key. */
export const FEATURE_KEY_RULES: Record<string, FeatureKeyRule> = {
  'text-to-music': { name: 'Text to Music', anyOf: ['ELEVENLABS_API_KEY'], service: 'ElevenLabs', keychainKey: 'elevenlabs' },
  'text-to-video': { name: 'Text to Video', anyOf: ['FAL_KEY'], service: 'fal.ai', keychainKey: 'fal' },
  'text-to-3d': { name: 'Text to 3D', anyOf: ['MESHY_API_KEY', 'TRIPO_API_KEY'], service: 'Meshy or Tripo', keychainKey: 'meshy' },
  'text-to-pic': { name: 'Text to Pic', anyOf: ['OPENROUTER_API_KEY'], service: 'OpenRouter', keychainKey: 'openrouter' },
  'text-to-pic-building': { name: 'Text to Pic Building', anyOf: ['OPENROUTER_API_KEY'], service: 'OpenRouter', keychainKey: 'openrouter' },
}

/**
 * Keys the Oasis's own spells use that the Academy's content may not list: the keychain shows them as well
 * (keychain-server.ts), so every "needs a key" has a place to go. Same shape as a key in keys.json.
 */
export const OASIS_FEATURE_KEYS: Array<{ id: string; name: string; short: string; kind: 'api'; cost: string; link: string; note: string; env: string[] }> = [
  { id: 'openrouter', name: 'OpenRouter', short: 'OpenRouter', kind: 'api', cost: 'Prepaid credits, priced per model. You can cap each key.', link: 'https://openrouter.ai/settings/keys', note: 'One key for many models. The Oasis uses it for Text to Pic and Text to Pic Building.', env: ['OPENROUTER_API_KEY'] },
  { id: 'elevenlabs', name: 'ElevenLabs', short: 'ElevenLabs', kind: 'api', cost: 'Free plan, then from $6 a month', link: 'https://elevenlabs.io/app/settings/api-keys', note: 'Voices, speech to text and music. The Oasis uses it for Text to Music and the agents’ voices.', env: ['ELEVENLABS_API_KEY'] },
  { id: 'fal', name: 'fal.ai', short: 'fal', kind: 'api', cost: 'Pay as you go, prepaid credits', link: 'https://fal.ai/dashboard/keys', note: 'Video, pictures and sound from many models through one key. The Oasis uses it for Text to Video.', env: ['FAL_KEY'] },
  { id: 'meshy', name: 'Meshy', short: 'Meshy', kind: 'api', cost: 'Free trial credits, then a plan', link: 'https://www.meshy.ai/api', note: 'Text and pictures to 3D models. The Oasis uses it (or Tripo) for Text to 3D.', env: ['MESHY_API_KEY'] },
  { id: 'tripo', name: 'Tripo', short: 'Tripo', kind: 'api', cost: 'Free credits each month, then a plan', link: 'https://platform.tripo3d.ai/api-keys', note: 'Text and pictures to 3D models. The Oasis uses it (or Meshy) for Text to 3D.', env: ['TRIPO_API_KEY'] },
]

/** The Oasis spells a keychain key opens (by the keychain's id): "Text to Pic, Text to Pic Building". */
export function featuresForKey(keychainKey: string): string[] {
  const names = new Set<string>()
  for (const rule of Object.values(FEATURE_KEY_RULES)) {
    if (rule.keychainKey === keychainKey) names.add(rule.name)
  }
  // Text to 3D takes either key.
  if (keychainKey === 'tripo') names.add(FEATURE_KEY_RULES['text-to-3d'].name)
  return [...names]
}

export interface FeatureKeyState {
  ready: boolean
  /** One plain line for the person, when not ready. */
  line: string
  /** Where to add it: the keychain's id for the key. */
  keychainKey?: string
}

export function missingKeyLine(rule: FeatureKeyRule): string {
  return `${rule.name} needs your own ${rule.service} key. Click to add it in the keychain.`
}

/** The state of every keyed feature, given an environment. */
export function featureKeyStates(env: Record<string, string | undefined>): Record<string, FeatureKeyState> {
  const states: Record<string, FeatureKeyState> = {}
  for (const [id, rule] of Object.entries(FEATURE_KEY_RULES)) {
    const ready = rule.anyOf.some(key => Boolean((env[key] || '').trim()))
    states[id] = { ready, line: ready ? '' : missingKeyLine(rule), keychainKey: rule.keychainKey }
  }
  return states
}
