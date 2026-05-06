// Derives a short identifier from a generation prompt for the gallery UI
// and for agents that need to refer to a saved image without quoting the
// full prompt. Cuts at a word boundary when one is reasonably close, and
// otherwise hard-cuts at the limit minus one (room for the ellipsis).

export const GENERATED_IMAGE_TITLE_MAX = 50

export function deriveImageTitle(prompt: string, max: number = GENERATED_IMAGE_TITLE_MAX): string {
  const collapsed = prompt.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  const cut = collapsed.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const safe = lastSpace > Math.floor(max * 0.6) ? cut.slice(0, lastSpace) : cut
  return `${safe}…`
}
