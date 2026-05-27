// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Scene Types
// Type definitions for the 3D visualization
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

export interface OasisSettings {
  // Post-processing
  bloomEnabled: boolean
  bloomIntensity: number
  vignetteEnabled: boolean
  chromaticEnabled: boolean
  // Visual
  showOrbitTarget: boolean    // Show orbit pivot point as a sphere
  // Background
  skyBackground: string  // 'stars' | 'night001' | 'night004' | 'night007' | 'night008'
  // UI
  uiOpacity: number  // 0.1 to 1.0
  // Agents
  agentActionMode: 'embodied' | 'instant'
  agentWalkSpeed: number
  agentConjureDurationMs: number
  agentScreenshotSettleMs: number
  // ─═̷─═̷─⚡ FPS COUNTER ─═̷─═̷─⚡
  fpsCounterEnabled: boolean
  fpsCounterFontSize: number  // 10-24px
  // ─═̷─═̷─🪟 WINDOW OPACITY ─═̷─═̷─🪟
  // ─═̷─═̷─🎮 CAMERA MODES ─═̷─═̷─🎮
  controlMode: 'orbit' | 'noclip' | 'third-person'
  mouseSensitivity: number
  moveSpeed: number
  // ─═̷─═̷─📐 FIELD OF VIEW ─═̷─═̷─📐
  fov: number                 // Camera FOV in degrees (30-120, default 75)
  // ─═̷─═̷─🔲 VISUAL ─═̷─═̷─🔲
  showGrid: boolean           // Toggle the infinite helper grid
  rp1Mode: boolean            // Ready Player 1 — exploration-only, hide all editing UI
  // ─═̷─═̷─⚔ BOLT LAB ─═̷─═̷─⚔
  // Visual design selectors per combat spell. Letters map to design names in
  // the BoltLayer registry (e.g. firebolt A = "Comet Tail", B = "Solar Flare",
  // C = "Phoenix Feather"; lightning D = "Thunderbolt"). Players can swap at
  // runtime via the Lab section in Settings.
  fireboltDesign: 'A' | 'B' | 'C'
  lightningBoltDesign: 'A' | 'B' | 'C' | 'D'
  iceBoltDesign: 'A' | 'B' | 'C'
  // ─═̷─═̷─🔊 SOUND LAB ─═̷─═̷─🔊
  // Volume mixers (0-1). spatialAudioEnabled toggles Three.js PositionalAudio
  // for spell effects — when on, bolts emit 3D sound that falls off with
  // distance from the camera/listener.
  masterVolume: number
  sfxVolume: number
  musicVolume: number
  ambientVolume: number
  spatialAudioEnabled: boolean
  // ─═̷─ Per-spell sound selection. Key = spell ID (from src/lib/spellbook.ts),
  // value = the sound `id` from public/audio/spells/manifest.json. Missing
  // entries are merged with DEFAULT_SPELL_SOUNDS at settings load time.
  // Lets the player customize "what does Firebolt sound like?" etc. ─═̷─
  spellSounds: Partial<Record<string, string>>
  // ─═̷─═̷─🅰 FONTS ─═̷─═̷─🅰
  // Picks the active UI font from src/lib/fonts.ts. Applied via
  // resolveFontFamily(settings.uiFont) on opt-in panels (spellbook is the
  // canary). Empty string means "fall back to DEFAULT_FONT".
  uiFont: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSETS
// ═══════════════════════════════════════════════════════════════════════════════

export interface AssetDefinition {
  id: string
  name: string
  path: string
  /** Free-form category string. Common values: platforms, enemies, pickups,
   *  character, nature, guns, props, medieval, urban, vehicles, structures,
   *  furniture, scifi, fantasy, village, avatar; new packs add their own
   *  (e.g. highlands-fantasy, scifi-megakit, fantasy-props, stylized-nature). */
  category: string
  defaultScale: number
  /** Short human label for UI / agent picking; populated by the caption pipeline. */
  shortLabel?: string
  /** One-sentence description; populated by vision captioning. */
  description?: string
  /** Bounding box in meters at defaultScale (computed during import). */
  bbox?: [number, number, number]
  /** Thumbnail URL — auto-generated to /thumbs/<id>.jpg. */
  thumbnail?: string
  /** Free-form tags for search (e.g. ['wood','door','round','medieval']). Populated
   *  by the registration script from filename tokens + category + synonyms. */
  tags?: string[]
}

export interface PlacedAsset {
  id: string
  assetId: string
  assetPath: string  // Direct path for dynamic assets
  assetName: string  // Display name
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
}

export type PlacementMode = 'neutral' | 'place' | 'delete' | 'transform'

// ▓▓▓▓【0̸4̸5̸1̸5̸】▓▓▓▓ॐ▓▓▓▓【T̸Y̸P̸E̸S̸】▓▓▓▓
