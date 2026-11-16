// ░▒▓ CRAFT MODELS — who writes the primitives for text-to-3D (Craft) ▓▒░
// Claude Code first: Opus 5.5 and Fable 5.2 through the owner's own Claude Code login (craft-claude-code.ts,
// local only). Then OpenRouter, newest first (each checked to still answer with JSON, 2026-11-16).
// normalizeCraftModelId keeps its old meaning for the OpenRouter-only routes (terrain, vibecode, /api/craft):
// a Claude Code choice falls back to the OpenRouter default there. The picker uses normalizeCraftChoice.

export type CraftModelProvider = 'claude-code' | 'openrouter'

export interface CraftModelOption {
  id: string
  label: string
  provider: CraftModelProvider
  /** Claude Code: the model the CLI runs. */
  cliModel?: string
}

export const CRAFT_MODEL_OPTIONS: readonly CraftModelOption[] = [
  { id: 'cc-opus-5-5', label: 'Claude Code · Opus 5.5', provider: 'claude-code', cliModel: 'claude-opus-5-5' },
  { id: 'cc-fable-5-2', label: 'Claude Code · Fable 5.2', provider: 'claude-code', cliModel: 'claude-fable-5-2' },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'openrouter' },
  { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'openrouter' },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3', provider: 'openrouter' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', provider: 'openrouter' },
  { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', provider: 'openrouter' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'openrouter' },
  { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openrouter' },
  { id: 'openai/gpt-5.4', label: 'GPT-5.4', provider: 'openrouter' },
  { id: 'qwen/qwen3.5-397b-a17b', label: 'Qwen 3.5 397B A17B', provider: 'openrouter' },
  { id: 'minimax/minimax-m2.7', label: 'MiniMax M2.7', provider: 'openrouter' },
]

export type CraftModelId = string

/** What the craft picker starts on: Claude Code with Opus 5.5. */
export const DEFAULT_CRAFT_CHOICE = 'cc-opus-5-5'
/** The OpenRouter routes' default (and what a hosted visitor's Claude Code choice crafts with). */
export const DEFAULT_CRAFT_MODEL = 'google/gemini-3.1-flash-lite'

/** OpenRouter model ids (what the OpenRouter routes accept). */
export const ALLOWED_CRAFT_MODELS: readonly string[] = CRAFT_MODEL_OPTIONS.filter(option => option.provider === 'openrouter').map(option => option.id)

/** Earlier Claude Code ids: they meant Opus or Sonnet through the CLI. */
const LEGACY_CLAUDE_CODE = new Set(['cc-opus', 'cc-sonnet', 'opus', 'sonnet'])

const REMOVED_CRAFT_MODELS = new Set([
  'google/gemini-3.1-flash-lite-preview',
  'google/gemini-3.1-pro-preview',
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',
  'x-ai/grok-4.20-beta',
  'liquid/lfm-2-24b-a2b',
  'z-ai/glm-5',
  'nvidia/nemotron-3-super-120b-a12b:free',
])

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/** For the OpenRouter routes: an allowed OpenRouter id, else the OpenRouter default. */
export function normalizeCraftModelId(value: unknown): string {
  const requested = clean(value)
  if (!requested || REMOVED_CRAFT_MODELS.has(requested)) return DEFAULT_CRAFT_MODEL
  return ALLOWED_CRAFT_MODELS.includes(requested) ? requested : DEFAULT_CRAFT_MODEL
}

/** For the picker: any listed model (Claude Code included), earlier Claude Code ids as Opus 5.5, else the default. */
export function normalizeCraftChoice(value: unknown): string {
  const requested = clean(value)
  if (LEGACY_CLAUDE_CODE.has(requested)) return DEFAULT_CRAFT_CHOICE
  return CRAFT_MODEL_OPTIONS.some(option => option.id === requested) ? requested : DEFAULT_CRAFT_CHOICE
}

/** The CLI model when this choice crafts through Claude Code, else null. */
export function claudeCodeCraftModel(value: unknown): string | null {
  const requested = clean(value)
  if (LEGACY_CLAUDE_CODE.has(requested)) return 'claude-opus-5-5'
  return CRAFT_MODEL_OPTIONS.find(option => option.id === requested && option.provider === 'claude-code')?.cliModel || null
}
