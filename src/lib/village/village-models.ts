// ░▒▓ VILLAGE MODELS — what the model menus offer (agent panel, summon picker) ▓▒░
// Each agent learns its model list from the Claude Code CLI once, when its process starts, so an
// agent that has run since before a release (Fable 5.2, 2026-11-09) never lists the new model. The
// menus show every agent's list merged, newest models included as soon as any agent has seen them,
// and "Other model id…" takes any id the CLI accepts.

export interface ModelOption {
  value: string
  displayName?: string | null
}

export const CUSTOM_MODEL_VALUE = '__custom'

export const FALLBACK_MODEL_OPTIONS: ModelOption[] = [
  { value: 'default', displayName: 'Default' },
  { value: 'opus', displayName: 'Opus' },
  { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'haiku', displayName: 'Haiku' },
]

/**
 * Every list merged, without duplicates: the longest list sets the order (it is usually the newest),
 * models only the others know come after it. A display name wins over a bare id.
 */
export function mergeModelLists(lists: Array<ModelOption[] | null | undefined>): ModelOption[] {
  const usable = lists.filter((list): list is ModelOption[] => Array.isArray(list) && list.length > 0)
  if (!usable.length) return FALLBACK_MODEL_OPTIONS.slice()
  const ordered = usable.slice().sort((a, b) => b.length - a.length)
  const byValue = new Map<string, ModelOption>()
  for (const list of ordered) {
    for (const model of list) {
      if (!model || typeof model.value !== 'string' || !model.value) continue
      const known = byValue.get(model.value)
      if (!known) byValue.set(model.value, { value: model.value, ...(model.displayName ? { displayName: model.displayName } : {}) })
      else if (!known.displayName && model.displayName) known.displayName = model.displayName
    }
  }
  return [...byValue.values()]
}

/** A typed model id, trimmed; null when it can't be one (empty, spaces inside, absurdly long). */
export function cleanModelId(input: string | null | undefined): string | null {
  const id = (input || '').trim()
  if (!id || id.length > 100 || /\s/.test(id)) return null
  return id
}
