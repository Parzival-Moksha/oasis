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
  vignetteEnabled: boolean
  chromaticEnabled: boolean
  // Visual
  showOrbitTarget: boolean    // Show orbit pivot point as a sphere
  // Background
  skyBackground: string  // 'stars' | 'night001' | 'night004' | 'night007' | 'night008'
  // UI
  uiOpacity: number  // 0.1 to 1.0
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
  category: 'platforms' | 'enemies' | 'pickups' | 'character' | 'nature' | 'guns' | 'props' | 'medieval' | 'urban' | 'vehicles' | 'structures' | 'furniture' | 'scifi' | 'fantasy' | 'village' | 'avatar'
  defaultScale: number
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
