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
  streamOpacity: number  // 0.1-1.0 — ThoughtStream (stashed for Merlin)
  // ─═̷─═̷─🎮 CAMERA MODES ─═̷─═̷─🎮
  controlMode: 'orbit' | 'noclip' | 'third-person'
  mouseSensitivity: number
  moveSpeed: number
  // ─═̷─═̷─📐 FIELD OF VIEW ─═̷─═̷─📐
  fov: number                 // Camera FOV in degrees (30-120, default 75)
  // ─═̷─═̷─🔲 VISUAL ─═̷─═̷─🔲
  showGrid: boolean           // Toggle the infinite helper grid
  rp1Mode: boolean            // Ready Player 1 — exploration-only, hide all editing UI
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
