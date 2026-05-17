// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// FONTS — curated UI font catalog for the Oasis.
// ─═̷─═̷─🅰─═̷─═̷─ Every chapter wants its own typography ─═̷─═̷─🅰─═̷─═̷─
//
// Each entry maps a stable id to a CSS variable that's loaded in
// src/app/layout.tsx via next/font/google. Settings reference the id;
// the actual font-family value resolves via `var(--font-<id>)` at render
// time. Vibe + sample fields drive the picker preview.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export type FontId =
  | 'system'
  | 'cinzel'
  | 'cormorant'
  | 'space-grotesk'
  | 'jetbrains-mono'

export interface FontDefinition {
  id: FontId
  name: string
  vibe: string
  /** CSS font-family value, ready to drop into a style prop. */
  cssFamily: string
  /** A glyph string for the picker preview. */
  sample: string
}

export const FONT_DEFS: Record<FontId, FontDefinition> = {
  'system': {
    id: 'system',
    name: 'System',
    vibe: 'Whatever the OS does best',
    cssFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    sample: 'Aa · The Oasis',
  },
  'cinzel': {
    id: 'cinzel',
    name: 'Cinzel',
    vibe: 'Engraved roman caps — spellbook + sigils',
    cssFamily: 'var(--font-cinzel), Cinzel, serif',
    sample: 'Aa · THE OASIS',
  },
  'cormorant': {
    id: 'cormorant',
    name: 'Cormorant Garamond',
    vibe: 'Old-book serif — calm, literary',
    cssFamily: 'var(--font-cormorant), "Cormorant Garamond", serif',
    sample: 'Aa · The Oasis',
  },
  'space-grotesk': {
    id: 'space-grotesk',
    name: 'Space Grotesk',
    vibe: 'Modern geometric sans — interface',
    cssFamily: 'var(--font-space-grotesk), "Space Grotesk", sans-serif',
    sample: 'Aa · The Oasis',
  },
  'jetbrains-mono': {
    id: 'jetbrains-mono',
    name: 'JetBrains Mono',
    vibe: 'Code-ish monospace — terminals + HUD',
    cssFamily: 'var(--font-jetbrains-mono), "JetBrains Mono", ui-monospace, monospace',
    sample: 'Aa · The Oasis',
  },
}

export const FONT_IDS = Object.keys(FONT_DEFS) as FontId[]

export const DEFAULT_FONT: FontId = 'cinzel'

export function isFontId(value: string): value is FontId {
  return value in FONT_DEFS
}

export function resolveFontFamily(id: string | undefined | null): string {
  if (id && isFontId(id)) return FONT_DEFS[id].cssFamily
  return FONT_DEFS[DEFAULT_FONT].cssFamily
}
