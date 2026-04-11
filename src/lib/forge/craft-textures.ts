// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CRAFT TEXTURE LIBRARY — preset-based textures for crafted primitives
// ─═̷─═̷─ॐ─═̷─═̷─ Stone, wood, metal, grass — all through a preset ID ─═̷─═̷─ॐ─═̷─═̷─
//
// Agents (Merlin, Hermes, craft UI) reference textures by preset ID.
// No raw URLs — safe for remote agents, consistent tiling behavior.
//
// Auto-tiling: if no explicit textureRepeat, repeat is computed from
// the object's world-space dimensions and the preset's naturalSizeMeters.
// A 10m wall with stone (naturalSize 2m) → repeat 5.
//
// Textures sourced from:
//   /public/ground/  — 19 Poly Haven CC0 1K diffuse textures
//   /public/models/kenney-medieval/Textures/  — 10 low-poly 64px
//   /public/models/kenney-urban/Textures/  — 22 low-poly 64px
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export interface CraftTexturePreset {
  id: string
  name: string
  texturePath: string
  fallbackColor: string
  /** World units per texture tile. Auto-repeat = maxDim / naturalSizeMeters. */
  naturalSizeMeters: number
  category: 'stone' | 'wood' | 'metal' | 'nature' | 'urban' | 'snow' | 'lowpoly'
  /** Informational: '1k' = 1024×1024, '64' = 64×64 */
  resolution: '1k' | '64'
}

// ═══════════════════════════════════════════════════════════════════════════
// HIGH-RES PRESETS — Poly Haven 1K diffuse textures (/public/ground/)
// ═══════════════════════════════════════════════════════════════════════════

const HIRES_PRESETS: CraftTexturePreset[] = [
  { id: 'stone',        name: 'Mossy Stone',     texturePath: '/ground/rock_pitted_mossy_diff_1k.jpg',     fallbackColor: '#666666', naturalSizeMeters: 2,   category: 'stone',  resolution: '1k' },
  { id: 'cobblestone',  name: 'Cobblestone',     texturePath: '/ground/cobblestone_floor_13_diff_1k.jpg',  fallbackColor: '#888888', naturalSizeMeters: 1,   category: 'stone',  resolution: '1k' },
  { id: 'marble',       name: 'Marble',          texturePath: '/ground/marble_01_diff_1k.jpg',            fallbackColor: '#e0d8cc', naturalSizeMeters: 2,   category: 'stone',  resolution: '1k' },
  { id: 'concrete',     name: 'Concrete',        texturePath: '/ground/concrete_floor_02_diff_1k.jpg',    fallbackColor: '#aaaaaa', naturalSizeMeters: 2,   category: 'urban',  resolution: '1k' },
  { id: 'rock',         name: 'Rock Face',       texturePath: '/ground/rock_face_diff_1k.jpg',            fallbackColor: '#4a4a4a', naturalSizeMeters: 2,   category: 'stone',  resolution: '1k' },
  { id: 'grass',        name: 'Grass & Rock',    texturePath: '/ground/aerial_grass_rock_diff_1k.jpg',    fallbackColor: '#2d5a1e', naturalSizeMeters: 2,   category: 'nature', resolution: '1k' },
  { id: 'sand',         name: 'Coastal Sand',    texturePath: '/ground/coast_sand_rocks_02_diff_1k.jpg',  fallbackColor: '#c2b280', naturalSizeMeters: 2,   category: 'nature', resolution: '1k' },
  { id: 'dirt',         name: 'Mud & Leaves',    texturePath: '/ground/brown_mud_leaves_01_diff_1k.jpg',  fallbackColor: '#6b4e31', naturalSizeMeters: 1.5, category: 'nature', resolution: '1k' },
  { id: 'snow',         name: 'Snow Field',      texturePath: '/ground/snow_field_aerial_diff_1k.jpg',    fallbackColor: '#e8e8f0', naturalSizeMeters: 2,   category: 'snow',   resolution: '1k' },
  { id: 'metal',        name: 'Metal Plate',     texturePath: '/ground/metal_plate_diff_1k.jpg',          fallbackColor: '#555555', naturalSizeMeters: 1,   category: 'metal',  resolution: '1k' },
  { id: 'gravel',       name: 'Gravelly Sand',   texturePath: '/ground/gravelly_sand_diff_1k.jpg',        fallbackColor: '#b8a882', naturalSizeMeters: 1.5, category: 'nature', resolution: '1k' },
  { id: 'forest-floor', name: 'Forest Floor',    texturePath: '/ground/forest_ground_04_diff_1k.jpg',     fallbackColor: '#3a2f1e', naturalSizeMeters: 2,   category: 'nature', resolution: '1k' },
]

// ═══════════════════════════════════════════════════════════════════════════
// LOW-POLY PRESETS — Kenney 64px textures (charming stylized look)
// ═══════════════════════════════════════════════════════════════════════════

const LOWPOLY_PRESETS: CraftTexturePreset[] = [
  { id: 'kn-planks',      name: 'Wood Planks',      texturePath: '/models/kenney-medieval/Textures/planks.png',               fallbackColor: '#8B4513', naturalSizeMeters: 1,   category: 'wood',    resolution: '64' },
  { id: 'kn-cobblestone', name: 'Cobblestone (LP)',  texturePath: '/models/kenney-medieval/Textures/cobblestone.png',          fallbackColor: '#888888', naturalSizeMeters: 1,   category: 'lowpoly', resolution: '64' },
  { id: 'kn-roof',        name: 'Roof Tiles',       texturePath: '/models/kenney-medieval/Textures/roof.png',                 fallbackColor: '#8B3A3A', naturalSizeMeters: 1,   category: 'lowpoly', resolution: '64' },
  { id: 'kn-barrel',      name: 'Barrel',           texturePath: '/models/kenney-medieval/Textures/barrel.png',               fallbackColor: '#6b4e31', naturalSizeMeters: 0.5, category: 'wood',    resolution: '64' },
  { id: 'kn-fence',       name: 'Fence',            texturePath: '/models/kenney-medieval/Textures/fence.png',                fallbackColor: '#8B6914', naturalSizeMeters: 1,   category: 'wood',    resolution: '64' },
  { id: 'kn-wall',        name: 'Wall',             texturePath: '/models/kenney-urban/Textures/wall.png',                    fallbackColor: '#aaaaaa', naturalSizeMeters: 2,   category: 'lowpoly', resolution: '64' },
  { id: 'kn-asphalt',     name: 'Asphalt',          texturePath: '/models/kenney-urban/Textures/asphalt.png',                 fallbackColor: '#444444', naturalSizeMeters: 2,   category: 'urban',   resolution: '64' },
  { id: 'kn-concrete',    name: 'Concrete (LP)',     texturePath: '/models/kenney-urban/Textures/concrete.png',               fallbackColor: '#999999', naturalSizeMeters: 2,   category: 'lowpoly', resolution: '64' },
  { id: 'kn-dirt',        name: 'Dirt (LP)',         texturePath: '/models/kenney-urban/Textures/dirt.png',                    fallbackColor: '#6b4e31', naturalSizeMeters: 1.5, category: 'lowpoly', resolution: '64' },
  { id: 'kn-grass',       name: 'Grass (LP)',        texturePath: '/models/kenney-urban/Textures/grass.png',                  fallbackColor: '#2d5a1e', naturalSizeMeters: 1,   category: 'lowpoly', resolution: '64' },
  { id: 'kn-metal',       name: 'Metal (LP)',        texturePath: '/models/kenney-urban/Textures/metal.png',                  fallbackColor: '#777777', naturalSizeMeters: 1,   category: 'metal',   resolution: '64' },
  { id: 'kn-rock',        name: 'Rock (LP)',         texturePath: '/models/kenney-urban/Textures/rock.png',                   fallbackColor: '#666666', naturalSizeMeters: 1,   category: 'lowpoly', resolution: '64' },
]

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const CRAFT_TEXTURE_PRESETS: CraftTexturePreset[] = [...HIRES_PRESETS, ...LOWPOLY_PRESETS]

export const CRAFT_TEXTURE_MAP = new Map(CRAFT_TEXTURE_PRESETS.map(p => [p.id, p]))

export function getCraftTexturePreset(id: string): CraftTexturePreset | undefined {
  return CRAFT_TEXTURE_MAP.get(id)
}

/** Shader + text types cannot receive textures. */
const NON_TEXTURABLE_TYPES = new Set([
  'flame', 'flag', 'crystal', 'water', 'particle_emitter', 'glow_orb', 'aurora', 'text',
])

export function canHaveTexture(primitiveType: string): boolean {
  return !NON_TEXTURABLE_TYPES.has(primitiveType)
}

/**
 * Auto-calculate texture repeat from object scale + preset's naturalSizeMeters.
 * A 10m wall with stone (naturalSize 2m) → repeat 5.
 * A 1m crate with planks (naturalSize 1m) → repeat 1.
 */
export function computeAutoTiling(
  scale: [number, number, number],
  naturalSizeMeters: number,
): number {
  const maxDim = Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]))
  return Math.max(1, Math.round(maxDim / naturalSizeMeters))
}
