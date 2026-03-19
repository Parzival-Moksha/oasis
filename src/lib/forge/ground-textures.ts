// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// GROUND TEXTURES — The skin of the world
// ─═̷─═̷─🌍─═̷─═̷─ Flat plane + PBR textures from open-source libraries ─═̷─═̷─🌍─═̷─═̷─
// CC0 textures from Poly Haven (polyhaven.com) via CDN
// Each ground type: diffuse, normal, roughness maps at 1K resolution
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export interface GroundPreset {
  id: string
  name: string
  icon: string
  color: string           // fallback color before textures load
  /** Poly Haven asset name — used to build CDN URLs */
  assetName: string
  /** Texture tiling: how many repeats across the ground */
  tileRepeat: number
  /** Direct URL for user-generated textures (bypasses assetName→CDN path) */
  customTextureUrl?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOCAL TEXTURE PATHS — 1K diffuse JPGs in /public/ground/
// Extracted from Poly Haven downloads + compressed. No CDN dependency.
// ═══════════════════════════════════════════════════════════════════════════════

export function getTextureUrls(assetName: string) {
  return {
    diffuse: `/ground/${assetName}_diff_1k.jpg`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUND PRESETS — Curated selection of beautiful grounds
// ═══════════════════════════════════════════════════════════════════════════════

export const GROUND_PRESETS: GroundPreset[] = [
  {
    id: 'none',
    name: 'None',
    icon: '⬛',
    color: '#111111',
    assetName: '',
    tileRepeat: 1,
  },
  {
    id: 'grass',
    name: 'Grass',
    icon: '🌿',
    color: '#2d5a1e',
    assetName: 'aerial_grass_rock',
    tileRepeat: 8,
  },
  {
    id: 'dirt',
    name: 'Dirt Path',
    icon: '🟤',
    color: '#6b4e31',
    assetName: 'brown_mud_leaves_01',
    tileRepeat: 6,
  },
  {
    id: 'sand',
    name: 'Sand',
    icon: '🏖️',
    color: '#c2b280',
    assetName: 'coast_sand_rocks_02',
    tileRepeat: 6,
  },
  {
    id: 'stone',
    name: 'Stone Floor',
    icon: '🪨',
    color: '#666666',
    assetName: 'rock_pitted_mossy',
    tileRepeat: 4,
  },
  {
    id: 'snow',
    name: 'Snow',
    icon: '❄️',
    color: '#e8e8f0',
    assetName: 'snow_field_aerial',
    tileRepeat: 6,
  },
  {
    id: 'cobble',
    name: 'Cobblestone',
    icon: '🧱',
    color: '#888888',
    assetName: 'cobblestone_floor_13',
    tileRepeat: 4,
  },
  {
    id: 'forest',
    name: 'Forest Floor',
    icon: '🌲',
    color: '#3a2f1e',
    assetName: 'forest_ground_04',
    tileRepeat: 6,
  },
  {
    id: 'lava',
    name: 'Rock Face',
    icon: '🌋',
    color: '#4a4a4a',
    assetName: 'rock_face',
    tileRepeat: 4,
  },
  {
    id: 'concrete',
    name: 'Concrete',
    icon: '🏗️',
    color: '#aaaaaa',
    assetName: 'concrete_floor_02',
    tileRepeat: 4,
  },
  {
    id: 'marble',
    name: 'Marble',
    icon: '🏛️',
    color: '#e0d8cc',
    assetName: 'marble_01',
    tileRepeat: 3,
  },
  {
    id: 'metal',
    name: 'Metal Grid',
    icon: '⚙️',
    color: '#555555',
    assetName: 'metal_plate',
    tileRepeat: 8,
  },
  // ─═̷─═̷─ New batch — Feb 2026 ─═̷─═̷─
  {
    id: 'beach',
    name: 'Beach',
    icon: '🏝️',
    color: '#d4c5a0',
    assetName: 'aerial_beach_01',
    tileRepeat: 6,
  },
  {
    id: 'rocks',
    name: 'Aerial Rocks',
    icon: '🪨',
    color: '#7a7a6a',
    assetName: 'aerial_rocks_04',
    tileRepeat: 4,
  },
  {
    id: 'leaves',
    name: 'Forest Leaves',
    icon: '🍂',
    color: '#5a4a2e',
    assetName: 'forest_leaves_02',
    tileRepeat: 6,
  },
  {
    id: 'leaves2',
    name: 'Autumn Leaves',
    icon: '🍁',
    color: '#6b4f28',
    assetName: 'forest_leaves_03',
    tileRepeat: 6,
  },
  {
    id: 'pebbles',
    name: 'River Pebbles',
    icon: '🫧',
    color: '#8a7d6b',
    assetName: 'ganges_river_pebbles',
    tileRepeat: 5,
  },
  {
    id: 'gravel',
    name: 'Gravelly Sand',
    icon: '🏜️',
    color: '#b8a882',
    assetName: 'gravelly_sand',
    tileRepeat: 6,
  },
  {
    id: 'rocky',
    name: 'Rocky Terrain',
    icon: '⛰️',
    color: '#6b6b5b',
    assetName: 'rocky_terrain_02',
    tileRepeat: 4,
  },
  {
    id: 'snow2',
    name: 'Fresh Snow',
    icon: '☃️',
    color: '#f0f0f8',
    assetName: 'snow_03',
    tileRepeat: 6,
  },
]

// ▓▓▓▓【G̸R̸O̸U̸N̸D̸】▓▓▓▓ॐ▓▓▓▓【T̸E̸X̸T̸U̸R̸E̸】▓▓▓▓
