export const DEFAULT_CRAFT_MODEL = 'google/gemini-3.1-flash-lite'

export const CRAFT_MODEL_OPTIONS = [
  { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'openai/gpt-5.4', label: 'GPT-5.4' },
  { id: 'qwen/qwen3.5-397b-a17b', label: 'Qwen 3.5 397B A17B' },
  { id: 'minimax/minimax-m2.7', label: 'Minimax M2.7' },
] as const

export type CraftModelId = typeof CRAFT_MODEL_OPTIONS[number]['id']

export const ALLOWED_CRAFT_MODELS: readonly string[] = CRAFT_MODEL_OPTIONS.map(option => option.id)

const REMOVED_CRAFT_MODELS = new Set([
  'google/gemini-3.1-flash-lite-preview',
  'google/gemini-3.1-pro-preview',
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',
  'x-ai/grok-4.20-beta',
  'liquid/lfm-2-24b-a2b',
  'z-ai/glm-5',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'cc-opus',
  'cc-sonnet',
  'opus',
  'sonnet',
])

export function normalizeCraftModelId(value: unknown): string {
  const requested = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!requested || REMOVED_CRAFT_MODELS.has(requested) || requested.startsWith('cc-')) {
    return DEFAULT_CRAFT_MODEL
  }
  return ALLOWED_CRAFT_MODELS.includes(requested) ? requested : DEFAULT_CRAFT_MODEL
}
