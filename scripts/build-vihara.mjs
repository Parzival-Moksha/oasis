// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// VIHARA — The Floating Monastery
// Claude builds a world. First test of Merlin capability.
// ─═̷─═̷─ॐ─═̷─═̷─ 2026-03-09 ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import https from 'https'

const now = new Date().toISOString()
const ts = Date.now()
const worldId = `world-${ts}-vhara`
const userId = '116841151327289989984'
import { config } from 'dotenv'
config()
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing SUPABASE env vars in .env'); process.exit(1) }

// ─── helper: unique incrementing ID for placements
let _seq = ts
function mkId(catalogId) {
  _seq++
  return `catalog-${catalogId}-${_seq}`
}

function p(catalogId, name, glbPath, pos, scale, rot) {
  return { id: mkId(catalogId), catalogId, name, glbPath, position: pos, scale, rotation: rot }
}

const PI2 = Math.PI / 2
const PI = Math.PI

// ═══════════════════════════════════════════════════════
// CATALOG PLACEMENTS
// ═══════════════════════════════════════════════════════

const placements = [
  // ─── 4 corner towers ───
  p('km_tower', 'Tower NW', '/models/kenney-medieval/tower.glb', [-9, 0, -9], 3, [0, 0, 0]),
  p('km_tower', 'Tower NE', '/models/kenney-medieval/tower.glb', [ 9, 0, -9], 3, [0, 0, 0]),
  p('km_tower', 'Tower SW', '/models/kenney-medieval/tower.glb', [-9, 0,  9], 3, [0, 0, 0]),
  p('km_tower', 'Tower SE', '/models/kenney-medieval/tower.glb', [ 9, 0,  9], 3, [0, 0, 0]),

  // ─── North wall (z=-8), 8 panels ───
  p('km_wall', 'Wall N1', '/models/kenney-medieval/wall.glb', [-7, -0.5, -8], 2, [0, 0, 0]),
  p('km_wall', 'Wall N2', '/models/kenney-medieval/wall.glb', [-5, -0.5, -8], 2, [0, 0, 0]),
  p('km_wall', 'Wall N3', '/models/kenney-medieval/wall.glb', [-3, -0.5, -8], 2, [0, 0, 0]),
  p('km_wall', 'Wall N4', '/models/kenney-medieval/wall.glb', [-1, -0.5, -8], 2, [0, 0, 0]),
  p('km_wall', 'Wall N5', '/models/kenney-medieval/wall.glb', [ 1, -0.5, -8], 2, [0, 0, 0]),
  p('km_wall', 'Wall N6', '/models/kenney-medieval/wall.glb', [ 3, -0.5, -8], 2, [0, 0, 0]),
  p('km_wall', 'Wall N7', '/models/kenney-medieval/wall.glb', [ 5, -0.5, -8], 2, [0, 0, 0]),
  p('km_wall', 'Wall N8', '/models/kenney-medieval/wall.glb', [ 7, -0.5, -8], 2, [0, 0, 0]),

  // ─── South wall (z=8) — entrance gap in middle (skip -1, 0, 1) ───
  p('km_wall', 'Wall S1', '/models/kenney-medieval/wall.glb', [-7, -0.5, 8], 2, [0, 0, 0]),
  p('km_wall', 'Wall S2', '/models/kenney-medieval/wall.glb', [-5, -0.5, 8], 2, [0, 0, 0]),
  p('km_wall', 'Wall S3', '/models/kenney-medieval/wall.glb', [-3, -0.5, 8], 2, [0, 0, 0]),
  p('km_wall', 'Wall S4', '/models/kenney-medieval/wall.glb', [ 3, -0.5, 8], 2, [0, 0, 0]),
  p('km_wall', 'Wall S5', '/models/kenney-medieval/wall.glb', [ 5, -0.5, 8], 2, [0, 0, 0]),
  p('km_wall', 'Wall S6', '/models/kenney-medieval/wall.glb', [ 7, -0.5, 8], 2, [0, 0, 0]),

  // ─── East wall (x=8), rotated 90° ───
  p('km_wall', 'Wall E1', '/models/kenney-medieval/wall.glb', [8, -0.5, -7], 2, [0, PI2, 0]),
  p('km_wall', 'Wall E2', '/models/kenney-medieval/wall.glb', [8, -0.5, -5], 2, [0, PI2, 0]),
  p('km_wall', 'Wall E3', '/models/kenney-medieval/wall.glb', [8, -0.5, -3], 2, [0, PI2, 0]),
  p('km_wall', 'Wall E4', '/models/kenney-medieval/wall.glb', [8, -0.5, -1], 2, [0, PI2, 0]),
  p('km_wall', 'Wall E5', '/models/kenney-medieval/wall.glb', [8, -0.5,  1], 2, [0, PI2, 0]),
  p('km_wall', 'Wall E6', '/models/kenney-medieval/wall.glb', [8, -0.5,  3], 2, [0, PI2, 0]),
  p('km_wall', 'Wall E7', '/models/kenney-medieval/wall.glb', [8, -0.5,  5], 2, [0, PI2, 0]),
  p('km_wall', 'Wall E8', '/models/kenney-medieval/wall.glb', [8, -0.5,  7], 2, [0, PI2, 0]),

  // ─── West wall (x=-8), rotated 90° ───
  p('km_wall', 'Wall W1', '/models/kenney-medieval/wall.glb', [-8, -0.5, -7], 2, [0, PI2, 0]),
  p('km_wall', 'Wall W2', '/models/kenney-medieval/wall.glb', [-8, -0.5, -5], 2, [0, PI2, 0]),
  p('km_wall', 'Wall W3', '/models/kenney-medieval/wall.glb', [-8, -0.5, -3], 2, [0, PI2, 0]),
  p('km_wall', 'Wall W4', '/models/kenney-medieval/wall.glb', [-8, -0.5, -1], 2, [0, PI2, 0]),
  p('km_wall', 'Wall W5', '/models/kenney-medieval/wall.glb', [-8, -0.5,  1], 2, [0, PI2, 0]),
  p('km_wall', 'Wall W6', '/models/kenney-medieval/wall.glb', [-8, -0.5,  3], 2, [0, PI2, 0]),
  p('km_wall', 'Wall W7', '/models/kenney-medieval/wall.glb', [-8, -0.5,  5], 2, [0, PI2, 0]),
  p('km_wall', 'Wall W8', '/models/kenney-medieval/wall.glb', [-8, -0.5,  7], 2, [0, PI2, 0]),

  // ─── 4 inner sanctum columns ───
  p('km_column', 'Column NW', '/models/kenney-medieval/column.glb', [-4, 0, -4], 2.5, [0, 0, 0]),
  p('km_column', 'Column NE', '/models/kenney-medieval/column.glb', [ 4, 0, -4], 2.5, [0, 0, 0]),
  p('km_column', 'Column SW', '/models/kenney-medieval/column.glb', [-4, 0,  4], 2.5, [0, 0, 0]),
  p('km_column', 'Column SE', '/models/kenney-medieval/column.glb', [ 4, 0,  4], 2.5, [0, 0, 0]),

  // ─── Entrance stairs (south) ───
  p('km_stairs_stone', 'Stair L', '/models/kenney-medieval/stairs-stone.glb', [-2, 0,  7], 2, [0, PI, 0]),
  p('km_stairs_stone', 'Stair C', '/models/kenney-medieval/stairs-stone.glb', [ 0, 0,  7], 2, [0, PI, 0]),
  p('km_stairs_stone', 'Stair R', '/models/kenney-medieval/stairs-stone.glb', [ 2, 0,  7], 2, [0, PI, 0]),

  // ─── Trees (outside corners) ───
  p('km_tree_large', 'Tree NW', '/models/kenney-medieval/tree-large.glb', [-13, 0, -13], 3.5, [0, 0.3, 0]),
  p('km_tree_large', 'Tree NE', '/models/kenney-medieval/tree-large.glb', [ 13, 0, -13], 3.5, [0, 1.1, 0]),
  p('km_tree_large', 'Tree SW', '/models/kenney-medieval/tree-large.glb', [-13, 0,  13], 3.5, [0, 2.0, 0]),
  p('km_tree_large', 'Tree SE', '/models/kenney-medieval/tree-large.glb', [ 13, 0,  13], 3.5, [0, 2.9, 0]),

  // ─── Park trees (midpoints outside) ───
  p('ku_tree_park', 'Park Tree N',  '/models/kenney-urban/tree-park-large.glb', [  0, 0, -13], 3, [0, 0.0, 0]),
  p('ku_tree_park', 'Park Tree S',  '/models/kenney-urban/tree-park-large.glb', [  0, 0,  13], 3, [0, 0.7, 0]),
  p('ku_tree_park', 'Park Tree E',  '/models/kenney-urban/tree-park-large.glb', [ 13, 0,   0], 3, [0, 1.4, 0]),
  p('ku_tree_park', 'Park Tree W',  '/models/kenney-urban/tree-park-large.glb', [-13, 0,   0], 3, [0, 2.1, 0]),

  // ─── Shrubs (inside courtyard corners) ───
  p('km_tree_shrub', 'Shrub NW', '/models/kenney-medieval/tree-shrub.glb', [-7, 0, -7], 2.0, [0, 0.0, 0]),
  p('km_tree_shrub', 'Shrub NE', '/models/kenney-medieval/tree-shrub.glb', [ 7, 0, -7], 2.0, [0, 1.0, 0]),
  p('km_tree_shrub', 'Shrub SW', '/models/kenney-medieval/tree-shrub.glb', [-7, 0,  7], 2.0, [0, 2.0, 0]),
  p('km_tree_shrub', 'Shrub SE', '/models/kenney-medieval/tree-shrub.glb', [ 7, 0,  7], 2.0, [0, 3.0, 0]),
  p('km_tree_shrub', 'Shrub N1', '/models/kenney-medieval/tree-shrub.glb', [-3, 0, -7], 1.5, [0, 0.5, 0]),
  p('km_tree_shrub', 'Shrub N2', '/models/kenney-medieval/tree-shrub.glb', [ 3, 0, -7], 1.5, [0, 1.5, 0]),

  // ─── Meditation pond ───
  p('km_water', 'Pond', '/models/kenney-medieval/water.glb', [0, -0.05, -3], 3.5, [0, 0, 0]),

  // ─── Fantasy lanterns (elevated at columns) ───
  p('qf_lantern_wall', 'Lantern NW', '/models/quaternius-fantasy/Lantern_Wall.gltf', [-4, 3.5, -4], 1.5, [0, 0,         0]),
  p('qf_lantern_wall', 'Lantern NE', '/models/quaternius-fantasy/Lantern_Wall.gltf', [ 4, 3.5, -4], 1.5, [0, PI,        0]),
  p('qf_lantern_wall', 'Lantern SW', '/models/quaternius-fantasy/Lantern_Wall.gltf', [-4, 3.5,  4], 1.5, [0, PI * 1.5,  0]),
  p('qf_lantern_wall', 'Lantern SE', '/models/quaternius-fantasy/Lantern_Wall.gltf', [ 4, 3.5,  4], 1.5, [0, PI * 0.5,  0]),

  // ─── Candlestick stands flanking stupa ───
  p('qf_candlestick_stand', 'Candle W', '/models/quaternius-fantasy/CandleStick_Stand.gltf', [-2.2, 0, 0.5], 2, [0, 0, 0]),
  p('qf_candlestick_stand', 'Candle E', '/models/quaternius-fantasy/CandleStick_Stand.gltf', [ 2.2, 0, 0.5], 2, [0, 0, 0]),

  // ─── Incense brazier ───
  p('qf_cauldron', 'Brazier', '/models/quaternius-fantasy/Cauldron.gltf', [0, 0, 3.0], 2, [0, 0, 0]),

  // ─── Meditation benches near columns ───
  p('kf_bench_cushion', 'Cushion NW', '/models/kenney-furniture/benchCushion.glb', [-5.5, 0, -2], 1.5, [0,  PI2, 0]),
  p('kf_bench_cushion', 'Cushion NE', '/models/kenney-furniture/benchCushion.glb', [ 5.5, 0, -2], 1.5, [0, -PI2, 0]),
  p('kf_bench_cushion', 'Cushion S1', '/models/kenney-furniture/benchCushion.glb', [-2,   0,  5.5], 1.5, [0, 0, 0]),
  p('kf_bench_cushion', 'Cushion S2', '/models/kenney-furniture/benchCushion.glb', [ 2,   0,  5.5], 1.5, [0, 0, 0]),

  // ─── Altar rug ───
  p('kf_rug_round', 'Altar Rug', '/models/kenney-furniture/rugRound.glb', [0, 0.01, 0], 3, [0, 0, 0]),

  // ─── VRM monk NPCs (patrol) ───
  p('av_orion', 'Orion the Monk',      '/avatars/gallery/Orion.vrm',  [ 3, 0,  3], 1, [0, 0, 0]),
  p('av_mushy', 'Mushy the Pilgrim',   '/avatars/gallery/Mushy.vrm',  [-5, 0, -2], 1, [0, 0, 0]),

  // ─── GLTF character at entrance ───
  p('char_leela', 'Leela the Guardian', '/models/characters/Leela.gltf', [0, 0, 6.5], 1.5, [0, PI, 0]),
]

// ─── Behaviors for NPC monks
const orionId = placements[placements.length - 3].id
const mushyId  = placements[placements.length - 2].id

const behaviors = {
  [orionId]: {
    movement: { type: 'patrol', radius: 3.5, speed: 1.2, startAngle: 0 },
    visible: true,
    label: 'Orion the Wandering Monk',
  },
  [mushyId]: {
    movement: { type: 'patrol', radius: 6.5, speed: 0.9, startAngle: 2.1 },
    visible: true,
    label: 'Mushy the Pilgrim',
  },
}

// ═══════════════════════════════════════════════════════
// CRAFTED SCENE — Bodhi Stupa (procedural geometry)
// ═══════════════════════════════════════════════════════

const stupa = {
  id: `stupa-${ts}`,
  name: 'Bodhi Stupa',
  prompt: 'Buddhist stupa with golden spire, prayer flags, and glowing OM symbol',
  position: [0, 0, 0],
  createdAt: now,
  objects: [
    // Base platform — sandstone
    { type: 'box', position: [0, 0.10, 0], scale: [5.5, 0.20, 5.5], color: '#6B5E4A', roughness: 0.9, metalness: 0.0 },
    // Second tier
    { type: 'box', position: [0, 0.40, 0], scale: [4.0, 0.40, 4.0], color: '#7A6B52', roughness: 0.8, metalness: 0.0 },
    // Third tier
    { type: 'box', position: [0, 0.75, 0], scale: [2.8, 0.35, 2.8], color: '#8B7355', roughness: 0.7, metalness: 0.0 },
    // Main cylindrical body (golden)
    { type: 'cylinder', position: [0, 1.85, 0], scale: [1.1, 2.20, 1.1], color: '#C4962A', roughness: 0.3, metalness: 0.3 },
    // Shoulder ring
    { type: 'box', position: [0, 3.05, 0], scale: [1.7, 0.25, 1.7], color: '#D4A52A', roughness: 0.2, metalness: 0.4 },
    // Dome (golden sphere)
    { type: 'sphere', position: [0, 3.70, 0], scale: [1.0, 1.0, 1.0], color: '#D4A52A', roughness: 0.1, metalness: 0.6, emissive: '#5C3A00', emissiveIntensity: 0.4 },
    // Harmika (top cube, solid gold)
    { type: 'box', position: [0, 4.75, 0], scale: [0.45, 0.28, 0.45], color: '#FFD700', roughness: 0.05, metalness: 0.95, emissive: '#AA7700', emissiveIntensity: 0.6 },
    // Yashti spire
    { type: 'cylinder', position: [0, 5.70, 0], scale: [0.07, 1.90, 0.07], color: '#FFD700', roughness: 0.05, metalness: 1.0, emissive: '#AA7700', emissiveIntensity: 0.8 },
    // Top orb (glowing)
    { type: 'sphere', position: [0, 6.70, 0], scale: [0.22, 0.22, 0.22], color: '#FFD700', emissive: '#FFD700', emissiveIntensity: 3.0, roughness: 0, metalness: 1 },
    // OM floating above (text primitive)
    { type: 'text', position: [0, 7.80, 0], scale: [1, 1, 1], color: '#FFD700', text: 'ॐ', fontSize: 1.5, emissive: '#FF8800', emissiveIntensity: 2.5 },
    // Base glow ring
    { type: 'torus', position: [0, 0.22, 0], scale: [2.8, 0.06, 2.8], color: '#FFD700', emissive: '#CC8800', emissiveIntensity: 0.6, roughness: 0.2 },
    // Mid glow ring
    { type: 'torus', position: [0, 3.70, 0], scale: [1.2, 0.05, 1.2], color: '#FFD700', emissive: '#FF9900', emissiveIntensity: 1.0 },
    // Prayer flag N (red — fire, wisdom)
    { type: 'box', position: [ 0, 2.5, -2.5], scale: [0.06, 2.0, 0.12], color: '#CC2200', opacity: 0.85 },
    // Prayer flag E (white — air, compassion)
    { type: 'box', position: [ 2.5, 2.5,  0], scale: [0.12, 2.0, 0.06], color: '#EEEEEE', opacity: 0.85 },
    // Prayer flag S (yellow — earth, equanimity)
    { type: 'box', position: [ 0, 2.5,  2.5], scale: [0.06, 2.0, 0.12], color: '#FFCC00', opacity: 0.85 },
    // Prayer flag W (green — water, healing)
    { type: 'box', position: [-2.5, 2.5,  0], scale: [0.12, 2.0, 0.06], color: '#007733', opacity: 0.85 },
    // Orbital meditation orb (orbits stupa slowly)
    { type: 'sphere', position: [4, 2, 0], scale: [0.38, 0.38, 0.38], color: '#8844FF', emissive: '#6622FF', emissiveIntensity: 3.5,
      animation: { type: 'orbit', radius: 4, speed: 0.35, axis: 'xz' } },
    // Inner pulsing spirit orb
    { type: 'sphere', position: [0, 4, 0], scale: [0.5, 0.5, 0.5], color: '#FFFFFF', emissive: '#FFD700', emissiveIntensity: 1.5,
      opacity: 0.3, animation: { type: 'pulse', speed: 0.7 } },
  ]
}

// ═══════════════════════════════════════════════════════
// LIGHTS
// ═══════════════════════════════════════════════════════

const lights = [
  // IBL environment (dimmed — it's night)
  { id: 'light-env-1',       type: 'environment',  color: '#ffffff', intensity: 0.5,  position: [0, 0, 0] },
  // Hemisphere: deep indigo sky / warm earth
  { id: 'light-hemi-1',      type: 'hemisphere',   color: '#0D0D2B', intensity: 0.45, position: [0, 10, 0], groundColor: '#1A1200' },
  // Directional moonlight (cool blue-grey)
  { id: 'light-moon',        type: 'directional',  color: '#8899CC', intensity: 8.0,  position: [20, 30, -15], target: [0, 0, 0], castShadow: true },
  // Golden point light from stupa top
  { id: 'light-stupa',       type: 'point',        color: '#FF8C00', intensity: 90,   position: [0, 5, 0] },
  // Warm corner accent lights (lantern warmth)
  { id: 'light-ne',          type: 'point',        color: '#FF7722', intensity: 30,   position: [ 5, 3, -5] },
  { id: 'light-sw',          type: 'point',        color: '#FF7722', intensity: 30,   position: [-5, 3,  5] },
]

// ═══════════════════════════════════════════════════════
// WORLD STATE
// ═══════════════════════════════════════════════════════

const worldState = {
  version: 1,
  terrain: null,
  groundPresetId: 'grass',
  groundTiles: {},
  craftedScenes: [stupa],
  conjuredAssetIds: [],
  catalogPlacements: placements,
  transforms: {},
  behaviors,
  lights,
  skyBackgroundId: 'night007',
  savedAt: now,
}

const row = {
  id: worldId,
  user_id: userId,
  name: 'Vihara',
  icon: '⛩️',
  data: worldState,
  visibility: 'public',
  creator_name: 'LEVimmortal',
  creator_avatar: null,
  object_count: placements.length + 1,
  created_at: now,
  updated_at: now,
}

// ═══════════════════════════════════════════════════════
// POST TO SUPABASE
// ═══════════════════════════════════════════════════════

const body = JSON.stringify(row)

const url = new URL(`${SUPABASE_URL}/rest/v1/worlds`)
const options = {
  method: 'POST',
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  },
}

const req = https.request(url, options, (res) => {
  let data = ''
  res.on('data', d => { data += d })
  res.on('end', () => {
    console.log('STATUS:', res.statusCode)
    if (res.statusCode === 201) {
      console.log('✅ VIHARA CREATED')
      console.log('World ID:', worldId)
      console.log('Placements:', placements.length)
      console.log('Crafted scenes: 1 (Bodhi Stupa)')
      console.log('Lights:', lights.length)
      console.log('URL: https://app.04515.xyz → explore → Vihara')
    } else {
      console.log('❌ ERROR:', data.slice(0, 500))
    }
  })
})

req.on('error', (e) => { console.error('REQUEST ERROR:', e.message) })
req.write(body)
req.end()
