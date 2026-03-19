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
  // ─═̷─═̷─🎮 QUAKE FPS CONTROLS ─═̷─═̷─🎮
  controlMode: 'orbit' | 'fps' | 'third-person' // Camera control mode
  mouseSensitivity: number    // FPS mouse sensitivity (0.1-2.0)
  moveSpeed: number           // FPS movement speed (1-20)
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
