// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TEXT 3D OBJECT — extruded, shiny, conjured words floating in space
// ─═̷─═̷─ॐ─═̷─═̷─ Speak it, and let it stand in 3-space ─═̷─═̷─ॐ─═̷─═̷─
// Renderer uses drei <Text3D> with a typeface .json font (helvetiker bundled).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

// Font set: helvetiker_regular is vendored locally; the others stream from
// unpkg @ the project's three.js version. They're plain JSON, so cached
// aggressively after first load. Bundling locally is a future ergonomics
// pass — for now, more variety with no repo bloat.
const THREE_FONT_BASE = 'https://unpkg.com/three@0.162.0/examples/fonts'

export const TEXT3D_FONT_OPTIONS = [
  { id: 'helvetiker_regular',   label: 'Helvetiker',         url: '/fonts/helvetiker_regular.typeface.json' },
  { id: 'helvetiker_bold',      label: 'Helvetiker Bold',    url: `${THREE_FONT_BASE}/helvetiker_bold.typeface.json` },
  { id: 'optimer_regular',      label: 'Optimer',            url: `${THREE_FONT_BASE}/optimer_regular.typeface.json` },
  { id: 'optimer_bold',         label: 'Optimer Bold',       url: `${THREE_FONT_BASE}/optimer_bold.typeface.json` },
  { id: 'gentilis_regular',     label: 'Gentilis',           url: `${THREE_FONT_BASE}/gentilis_regular.typeface.json` },
  { id: 'gentilis_bold',        label: 'Gentilis Bold',      url: `${THREE_FONT_BASE}/gentilis_bold.typeface.json` },
  { id: 'droid_sans_regular',   label: 'Droid Sans',         url: `${THREE_FONT_BASE}/droid/droid_sans_regular.typeface.json` },
  { id: 'droid_sans_bold',      label: 'Droid Sans Bold',    url: `${THREE_FONT_BASE}/droid/droid_sans_bold.typeface.json` },
  { id: 'droid_serif_regular',  label: 'Droid Serif',        url: `${THREE_FONT_BASE}/droid/droid_serif_regular.typeface.json` },
  { id: 'droid_serif_bold',     label: 'Droid Serif Bold',   url: `${THREE_FONT_BASE}/droid/droid_serif_bold.typeface.json` },
] as const

export type Text3DFontId = typeof TEXT3D_FONT_OPTIONS[number]['id']

export const TEXT3D_DEFAULT_SIZE     = 0.5
export const TEXT3D_DEFAULT_DEPTH    = 0.12
export const TEXT3D_DEFAULT_COLOR    = '#ffd166'
export const TEXT3D_DEFAULT_SHININESS = 0.8
export const TEXT3D_MAX_LENGTH       = 240

export interface Text3DObject {
  id: string
  type: 'text_3d'
  text: string
  fontId: Text3DFontId
  size: number
  depth: number
  color: string
  toneBias?: number
  shininess: number
  position: [number, number, number]
  rotation: [number, number, number]
  authorId?: string
  createdAt: number
}

export function makeText3DId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `text3d-${crypto.randomUUID().slice(0, 12)}`
  }
  return `text3d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function fontUrlFor(fontId: Text3DFontId): string {
  const found = TEXT3D_FONT_OPTIONS.find(f => f.id === fontId)
  return found?.url ?? TEXT3D_FONT_OPTIONS[0].url
}

export function clampText3DInput(text: string): string {
  return text.replace(/\r/g, '').slice(0, TEXT3D_MAX_LENGTH)
}
