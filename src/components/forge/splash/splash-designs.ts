// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SPLASH DESIGNS — the 8 boot-screen variants. Each variant is mostly defined
// by:
//   1. A generated background image (rendered by scripts/generate-splash-screens.mjs)
//   2. A theme palette + overlay flavor that the SplashScreen layers on top
//   3. A short tagline that animates while the world loads
//
// Images live at /splash/{designId}.{modelSlug}.{ext}. If the chosen variant's
// image is missing, the fallback CSS gradient still produces a coherent screen.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export type SplashDesignId =
  | 'retrowave-rp1'
  | 'wizards-atrium'
  | 'agent-console'
  | 'carbon-silicon'
  | 'psychedelic-genesis'
  | 'cyber-datacenter'
  | 'halliday-workshop'
  | 'living-threejs'

export type SplashModelSlug = 'nano2' | 'gpt2'

export type SplashOverlayFlavor =
  /** Animated chrome grid + sun lines */
  | 'retrowave-grid'
  /** Floating ember particles, soft candle flicker vignette */
  | 'ember-particles'
  /** Scanlines + chromatic aberration + CRT vignette */
  | 'crt-scanlines'
  /** Gold radial bloom + drifting dust motes */
  | 'gold-bloom'
  /** Slow hue-rotating radial pulse from center */
  | 'psychedelic-pulse'
  /** Vertical neon rain streaks + bokeh glints */
  | 'neon-rain'
  /** Dust motes drifting in slatted-blind sunlight */
  | 'dusty-sunbeam'
  /** Subtle volumetric fog drifting upward + faint procedural vertex sparkles */
  | 'world-conjuring'

export type SplashBarStyle =
  /** Smooth neon fill bar with glow */
  | 'neon-fill'
  /** Gold liquid filling a curved ring (decorative SVG) */
  | 'mana-ring'
  /** Diegetic terminal: `[████░░░░] 47%  loading_assets.pak` */
  | 'terminal'
  /** Quill writing across a page underline */
  | 'quill-line'

export interface SplashDesign {
  id: SplashDesignId
  label: string
  /** ≤ 80 chars — shown under the chosen design name in the Experiments picker */
  blurb: string
  /** Primary accent for bar + glow + status text */
  accent: string
  /** Secondary accent (some designs use a duo) */
  accentAlt?: string
  /** CSS-only background gradient — used as fallback if the image doesn't load yet */
  fallbackGradient: string
  overlay: SplashOverlayFlavor
  bar: SplashBarStyle
  /** Status text shown above the bar — rotates as load progresses */
  statusLines: [string, string, string, string]
  /**
   * Apply `mix-blend-mode: screen` to the background image. Use this when the
   * generated image has a near-black background (retrowave, console, neon
   * scenes) so the dark frame vanishes over a CSS gradient instead of fighting
   * with it. Set false for designs whose backdrop is intentionally light or
   * fully composed (Halliday's bedroom, Carbon-Silicon key art).
   */
  screenBlend: boolean
}

export const SPLASH_DESIGNS: SplashDesign[] = [
  {
    id: 'retrowave-rp1',
    label: 'Retrowave RP1',
    blurb: 'Neon chrome 04515 sun-grid. Ready Player One in spirit.',
    accent: '#ff3df8',
    accentAlt: '#3cdcff',
    fallbackGradient:
      'radial-gradient(ellipse at 50% 60%, #2a0f5f 0%, #110627 45%, #050010 100%)',
    overlay: 'retrowave-grid',
    bar: 'neon-fill',
    statusLines: [
      'Booting OASIS terminal…',
      'Calibrating neon chrome…',
      'Spinning up the grid floor…',
      'Welcome to 04515.',
    ],
    screenBlend: true,
  },
  {
    id: 'wizards-atrium',
    label: "Wizard's Atrium",
    blurb: 'Spellbook glyphs glow gold. Halliday-as-archmage.',
    accent: '#f0c14a',
    accentAlt: '#ff7a4d',
    fallbackGradient:
      'radial-gradient(ellipse at 50% 55%, #3a1d09 0%, #1b0d04 50%, #050200 100%)',
    overlay: 'ember-particles',
    bar: 'quill-line',
    statusLines: [
      'Opening the spellbook…',
      'Inscribing the world sigil…',
      'Lighting the candles…',
      'The atrium awaits.',
    ],
    screenBlend: false,
  },
  {
    id: 'agent-console',
    label: 'Agent Console',
    blurb: 'Phosphor terminal. 04515 in ASCII. CRT scanlines.',
    accent: '#22ff99',
    accentAlt: '#00d4aa',
    fallbackGradient:
      'radial-gradient(ellipse at 50% 50%, #001a0d 0%, #000604 60%, #000 100%)',
    overlay: 'crt-scanlines',
    bar: 'terminal',
    statusLines: [
      '> mounting world registry…',
      '> hydrating spellbook…',
      '> opening realtime channel…',
      '> oasis@04515 ready.',
    ],
    screenBlend: true,
  },
  {
    id: 'carbon-silicon',
    label: 'Carbon ⇌ Silicon',
    blurb: 'Four mythic agents on the golden dais. Cover key art.',
    accent: '#f5b53d',
    accentAlt: '#c08329',
    fallbackGradient:
      'radial-gradient(ellipse at 50% 65%, #4d2c00 0%, #1c1004 55%, #050000 100%)',
    overlay: 'gold-bloom',
    bar: 'mana-ring',
    statusLines: [
      'Convening the four…',
      'Carving the keystone…',
      'Kindling the mana ring…',
      'The dais is set.',
    ],
    screenBlend: false,
  },
  {
    id: 'psychedelic-genesis',
    label: 'Psychedelic Genesis',
    blurb: 'Sri Yantra mandala, 04515 as the bullseye sigil.',
    accent: '#ff5ee0',
    accentAlt: '#6bd0ff',
    fallbackGradient:
      'radial-gradient(circle at 50% 50%, #2a0040 0%, #100020 60%, #03000a 100%)',
    overlay: 'psychedelic-pulse',
    bar: 'neon-fill',
    statusLines: [
      'Aligning the yantra…',
      'Folding sacred geometry…',
      'Tuning the mandala…',
      'Genesis complete.',
    ],
    screenBlend: true,
  },
  {
    id: 'cyber-datacenter',
    label: 'Cyber Datacenter',
    blurb: 'Server racks down a neon corridor. Node 01 online.',
    accent: '#3cdcff',
    accentAlt: '#ff3df8',
    fallbackGradient:
      'radial-gradient(ellipse at 50% 55%, #021627 0%, #02091a 50%, #000208 100%)',
    overlay: 'neon-rain',
    bar: 'neon-fill',
    statusLines: [
      'Spinning up Node 01…',
      'Routing through the racks…',
      'Stabilising the cooling loop…',
      'Datacenter is live.',
    ],
    screenBlend: true,
  },
  {
    id: 'halliday-workshop',
    label: "Halliday's Workshop",
    blurb: 'The CRT bedroom where it all began. Post-it 04515.',
    accent: '#ffb84d',
    accentAlt: '#7bdbff',
    fallbackGradient:
      'radial-gradient(ellipse at 50% 55%, #3a2200 0%, #1c1004 60%, #050200 100%)',
    overlay: 'dusty-sunbeam',
    bar: 'terminal',
    statusLines: [
      'Rewinding to 1985…',
      'Loading floppies…',
      'Compiling the dream…',
      'Boot disk ready.',
    ],
    screenBlend: false,
  },
  {
    id: 'living-threejs',
    label: 'Living Three.js',
    blurb: 'Low-poly world assembling itself through a portal arch.',
    accent: '#c44dff',
    accentAlt: '#4dd0ff',
    fallbackGradient:
      'radial-gradient(ellipse at 50% 70%, #2d0a4a 0%, #15042b 50%, #04000d 100%)',
    overlay: 'world-conjuring',
    bar: 'neon-fill',
    statusLines: [
      'Conjuring primitives…',
      'Stitching the mesh…',
      'Lifting the keystone…',
      'World is breathing.',
    ],
    screenBlend: false,
  },
]

export const SPLASH_MODELS: { slug: SplashModelSlug; label: string }[] = [
  { slug: 'nano2', label: 'Nano Banana 2' },
  { slug: 'gpt2', label: 'GPT Image 2' },
]

export const DEFAULT_SPLASH_DESIGN: SplashDesignId = 'retrowave-rp1'
export const DEFAULT_SPLASH_MODEL: SplashModelSlug = 'nano2'

/** Build the URL we'd expect for a given design × model combo. */
export function splashImageUrl(design: SplashDesignId, model: SplashModelSlug, ext: 'png' | 'webp' | 'jpg' = 'png'): string {
  return `/splash/${design}.${model}.${ext}`
}

/** All known variant URLs to try in order for a given design × model. */
export function splashImageCandidates(design: SplashDesignId, model: SplashModelSlug): string[] {
  return [
    splashImageUrl(design, model, 'png'),
    splashImageUrl(design, model, 'webp'),
    splashImageUrl(design, model, 'jpg'),
  ]
}

export function getDesign(id: SplashDesignId): SplashDesign {
  return SPLASH_DESIGNS.find(d => d.id === id) ?? SPLASH_DESIGNS[0]
}
