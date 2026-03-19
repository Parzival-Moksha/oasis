#!/usr/bin/env node
// ░▒▓█ CREATE 3 SHOWCASE WORLDS █▓▒░
// Direct Supabase insertion — bypasses NextAuth session requirement
// Run: node scripts/create-showcase-worlds.mjs

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_USER_ID = process.env.ADMIN_USER_ID

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE env vars. Copy .env.example → .env and fill in values.')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Helper: generate placement ID
const pid = (catalogId, i) => `catalog-${catalogId}-${Date.now() + i}`

// Helper: make a catalog placement
function place(catalogId, name, glbPath, pos, opts = {}) {
  const id = pid(catalogId, Math.random() * 100000 | 0)
  return {
    placement: {
      id,
      catalogId,
      name,
      glbPath,
      position: pos,
      rotation: opts.rotation || [0, 0, 0],
      scale: opts.scale || 1,
    },
    transform: {
      position: pos,
      rotation: opts.rotation || [0, 0, 0],
      scale: opts.scale || 1,
    },
    behavior: opts.behavior || undefined,
    _id: id,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// WORLD 1: 🏙️ Cyberpunk Rooftop
// Night city vibes — floating platforms, neon signs, robots, antennas
// ═══════════════════════════════════════════════════════════════════════
function buildCyberpunkRooftop() {
  const objects = [
    // Main platform cluster — the stage
    place('platform_4x4', 'Main Platform', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4.gltf', [0, 0, 0], { scale: 1.5 }),
    place('platform_4x4_empty', 'Platform B', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4_Empty.gltf', [6, 0, 0], { scale: 1.5 }),
    place('platform_4x2', 'Platform C', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x2.gltf', [-6, 0, 0], { scale: 1.5 }),
    place('platform_2x2', 'Platform Bridge', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_2x2.gltf', [0, 0, 6], { scale: 1.5 }),
    place('platform_4x1', 'Walkway', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x1.gltf', [0, 0, -6], { scale: 1.5 }),

    // Elevated platforms
    place('platform_2x2_empty', 'Upper Deck', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_2x2_Empty.gltf', [3, 3, 3], { scale: 1.2 }),
    place('platform_2x1', 'Sniper Nest', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_2x1_Empty.gltf', [-4, 5, -4], { scale: 1.2 }),

    // Supports and structure
    place('support', 'Support A', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Support.gltf', [3, 0, 3], { scale: 2 }),
    place('support_long', 'Support B', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Support_Long.gltf', [-4, 0, -4], { scale: 2 }),
    place('support_short', 'Support C', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Support_Short.gltf', [6, 0, -3], { scale: 2 }),

    // Rails
    place('rail_long', 'Rail Left', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Rail_Long.gltf', [-3, 0.5, -3], { scale: 2 }),
    place('rail_long', 'Rail Right', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Rail_Long.gltf', [3, 0.5, -3], { scale: 2 }),
    place('rail_corner', 'Rail Corner', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Rail_Corner.gltf', [-3, 0.5, 3], { scale: 2 }),

    // Antennas and tech
    place('antenna1', 'Antenna Tower', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Antenna_1.gltf', [8, 0, 4], { scale: 2 }),
    place('antenna2', 'Antenna Dish', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Antenna_2.gltf', [-8, 0, -2], { scale: 2 }),
    place('computer', 'Terminal', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Computer.gltf', [1, 0.5, 1], { scale: 2 }),
    place('computer_large', 'Mainframe', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Computer_Large.gltf', [-2, 0.5, -1], { scale: 2 }),

    // TVs and signs — the neon vibe
    place('tv1', 'Screen A', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/TV_1.gltf', [4, 2, 0], { scale: 2.5, rotation: [0, -Math.PI/4, 0] }),
    place('tv2', 'Screen B', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/TV_2.gltf', [-5, 3, 2], { scale: 2, rotation: [0, Math.PI/3, 0] }),
    place('tv3', 'Screen C', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/TV_3.gltf', [0, 4, -5], { scale: 2 }),
    place('sign1', 'Neon Sign A', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Sign_1.gltf', [7, 1, -2], { scale: 2 }),
    place('sign2', 'Neon Sign B', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Sign_2.gltf', [-7, 2, 3], { scale: 2, rotation: [0, Math.PI/2, 0] }),
    place('sign3', 'Sign Tower', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Sign_3.gltf', [0, 0.5, 8], { scale: 2 }),
    place('sign_corner1', 'Corner Sign', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Sign_Corner_1.gltf', [5, 0.5, 5], { scale: 1.5 }),

    // AC units and pipes — rooftop clutter
    place('ac', 'AC Unit A', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/AC.gltf', [2, 0.5, -2], { scale: 1.5 }),
    place('ac_stacked', 'AC Stack', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/AC_Stacked.gltf', [-3, 0.5, 2], { scale: 1.5 }),
    place('ac_side', 'AC Side', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/AC_Side.gltf', [5, 0.5, -4], { scale: 1.5 }),
    place('pipe1', 'Pipe Run A', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Pipe_1.gltf', [-1, 1, 4], { scale: 1.5 }),
    place('pipe2', 'Pipe Run B', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Pipe_2.gltf', [3, 1, -5], { scale: 1.5, rotation: [0, Math.PI/2, 0] }),
    place('pipe_corner', 'Pipe Corner', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Pipe_Corner.gltf', [-1, 1, -4], { scale: 1.5 }),

    // Enemies — guarding the rooftop
    place('enemy_2legs', 'Patrol Bot', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Enemies/Enemy_2Legs.gltf', [4, 0.5, 3], { scale: 1.5, behavior: { movement: { type: 'patrol', radius: 3, speed: 0.5 }, visible: true } }),
    place('enemy_flying', 'Drone Scout', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Enemies/Enemy_Flying.gltf', [0, 5, 0], { scale: 1.5, behavior: { movement: { type: 'orbit', radius: 6, speed: 0.3, axis: 'xz' }, visible: true } }),
    place('turret_cannon', 'Defense Turret', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Enemies/Turret_Cannon.gltf', [-4, 5.5, -4], { scale: 1.5, behavior: { movement: { type: 'spin', axis: 'y', speed: 0.2 }, visible: true } }),
    place('enemy_large', 'Heavy Mech', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Enemies/Enemy_Large.gltf', [-6, 0.5, 0], { scale: 2 }),

    // Pickups — rewards
    place('lootbox', 'Lootbox', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Pickups and Objects/Lootbox.gltf', [3, 3.5, 3], { scale: 2.5, behavior: { movement: { type: 'hover', amplitude: 0.3, speed: 1, offset: 0 }, visible: true } }),
    place('health', 'Health', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Pickups and Objects/Pickup_Health.gltf', [6, 1, 2], { scale: 2, behavior: { movement: { type: 'spin', axis: 'y', speed: 1 }, visible: true } }),
    place('gear', 'Data Chip', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Pickups and Objects/Collectible_Gear.gltf', [0, 1.5, 0], { scale: 3, behavior: { movement: { type: 'hover', amplitude: 0.5, speed: 0.8, offset: 0 }, visible: true } }),

    // Door
    place('door', 'Rooftop Exit', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Door.gltf', [0, 0.5, -6], { scale: 2 }),

    // Fence perimeter
    place('fence', 'Fence A', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Fence.gltf', [-8, 0, 0], { scale: 2 }),
    place('fence', 'Fence B', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Fence.gltf', [8, 0, 0], { scale: 2 }),

    // Lights
    place('light_street1', 'Streetlight A', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Light_Street_1.gltf', [-5, 0, 5], { scale: 2 }),
    place('light_street2', 'Streetlight B', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Light_Street_2.gltf', [7, 0, -5], { scale: 2 }),
    place('light_square', 'Floor Light', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Light_Square.gltf', [0, 0.5, 3], { scale: 2 }),

    // Cable detailing
    place('cable_long', 'Cable A', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Cable_Long.gltf', [2, 2, 5], { scale: 1.5 }),
    place('cable_thick', 'Cable B', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Cable_Thick.gltf', [-3, 3, -3], { scale: 1.5, rotation: [0, Math.PI/4, 0] }),
  ]

  const catalogPlacements = objects.map(o => o.placement)
  const transforms = {}
  const behaviors = {}
  objects.forEach(o => {
    transforms[o._id] = o.transform
    if (o.behavior) behaviors[o._id] = o.behavior
  })

  return {
    terrain: null,
    groundPresetId: 'none', // floating platforms — no ground
    craftedScenes: [
      // Glowing neon text — "SECTOR 7"
      {
        id: `crafted-neon-${Date.now()}`,
        name: 'SECTOR 7 Sign',
        prompt: 'Floating neon sign',
        objects: [
          { type: 'text', text: 'SECTOR 7', position: [0, 7, -8], scale: [1, 1, 1], color: '#00ffff', emissive: '#00ffff', emissiveIntensity: 3, fontSize: 2 },
          { type: 'text', text: '[ RESTRICTED ]', position: [0, 5.5, -8], scale: [1, 1, 1], color: '#ff0044', emissive: '#ff0044', emissiveIntensity: 2, fontSize: 0.8 },
          // Floating holographic ring
          { type: 'torus', position: [0, 3, 0], rotation: [Math.PI/2, 0, 0], scale: [4, 4, 0.1], color: '#0088ff', emissive: '#0088ff', emissiveIntensity: 1.5, opacity: 0.3, animation: { type: 'rotate', speed: 0.3, axis: 'z' } },
          { type: 'torus', position: [0, 3.2, 0], rotation: [Math.PI/2, 0, 0], scale: [5, 5, 0.05], color: '#ff00aa', emissive: '#ff00aa', emissiveIntensity: 1, opacity: 0.2, animation: { type: 'rotate', speed: -0.2, axis: 'z' } },
        ],
        position: [0, 0, 0],
        createdAt: new Date().toISOString(),
      },
    ],
    conjuredAssetIds: [],
    catalogPlacements,
    transforms,
    behaviors,
    lights: [
      { id: `light-env-${Date.now()}`, type: 'environment', color: '#ffffff', intensity: 0.3, position: [0, 0, 0] },
      { id: `light-point-1-${Date.now()}`, type: 'point', color: '#00ccff', intensity: 5, position: [0, 4, 0], castShadow: true },
      { id: `light-point-2-${Date.now()}`, type: 'point', color: '#ff0066', intensity: 3, position: [-6, 3, 3] },
      { id: `light-point-3-${Date.now()}`, type: 'point', color: '#00ff88', intensity: 3, position: [6, 3, -3] },
      { id: `light-spot-${Date.now()}`, type: 'spot', color: '#ffffff', intensity: 4, position: [0, 10, 0], target: [0, 0, 0], angle: 60, castShadow: true },
    ],
    skyBackgroundId: 'night007',
  }
}

// ═══════════════════════════════════════════════════════════════════════
// WORLD 2: 🏰 Medieval Village Square
// Cozy castle courtyard — walls, towers, market stalls, barrels, trees
// ═══════════════════════════════════════════════════════════════════════
function buildMedievalVillage() {
  const objects = [
    // ── Castle walls (square perimeter ~20 units) ──
    // North wall
    place('km_wall_fortified', 'North Wall A', '/models/kenney-medieval/wall-fortified.glb', [-6, 0, -10], { scale: 2 }),
    place('km_wall_fort_gate', 'North Gate', '/models/kenney-medieval/wall-fortified-gate.glb', [0, 0, -10], { scale: 2 }),
    place('km_wall_fortified', 'North Wall B', '/models/kenney-medieval/wall-fortified.glb', [6, 0, -10], { scale: 2 }),
    // South wall
    place('km_wall_fortified', 'South Wall A', '/models/kenney-medieval/wall-fortified.glb', [-6, 0, 10], { scale: 2, rotation: [0, Math.PI, 0] }),
    place('km_wall_fort_door', 'South Door', '/models/kenney-medieval/wall-fortified-door.glb', [0, 0, 10], { scale: 2, rotation: [0, Math.PI, 0] }),
    place('km_wall_fortified', 'South Wall B', '/models/kenney-medieval/wall-fortified.glb', [6, 0, 10], { scale: 2, rotation: [0, Math.PI, 0] }),
    // East wall
    place('km_wall_fortified', 'East Wall A', '/models/kenney-medieval/wall-fortified.glb', [10, 0, -4], { scale: 2, rotation: [0, Math.PI/2, 0] }),
    place('km_wall_fort_window', 'East Window', '/models/kenney-medieval/wall-fortified-window.glb', [10, 0, 2], { scale: 2, rotation: [0, Math.PI/2, 0] }),
    place('km_wall_fortified', 'East Wall B', '/models/kenney-medieval/wall-fortified.glb', [10, 0, 8], { scale: 2, rotation: [0, Math.PI/2, 0] }),
    // West wall
    place('km_wall_fortified', 'West Wall A', '/models/kenney-medieval/wall-fortified.glb', [-10, 0, -4], { scale: 2, rotation: [0, -Math.PI/2, 0] }),
    place('km_wall_fort_paint', 'West Paint', '/models/kenney-medieval/wall-fortified-paint.glb', [-10, 0, 2], { scale: 2, rotation: [0, -Math.PI/2, 0] }),
    place('km_wall_fortified', 'West Wall B', '/models/kenney-medieval/wall-fortified.glb', [-10, 0, 8], { scale: 2, rotation: [0, -Math.PI/2, 0] }),

    // ── Corner towers ──
    place('km_tower', 'NE Tower', '/models/kenney-medieval/tower.glb', [10, 0, -10], { scale: 2 }),
    place('km_tower_paint', 'NW Tower', '/models/kenney-medieval/tower-paint.glb', [-10, 0, -10], { scale: 2 }),
    place('km_tower', 'SE Tower', '/models/kenney-medieval/tower.glb', [10, 0, 10], { scale: 2 }),
    place('km_tower_paint', 'SW Tower', '/models/kenney-medieval/tower-paint.glb', [-10, 0, 10], { scale: 2 }),

    // ── Battlements on walls ──
    place('km_battlement', 'Battlement N', '/models/kenney-medieval/battlement.glb', [0, 3, -10], { scale: 2 }),
    place('km_battlement', 'Battlement S', '/models/kenney-medieval/battlement.glb', [0, 3, 10], { scale: 2 }),

    // ── Central well / market area ──
    // Wooden structures (market stalls)
    place('km_structure', 'Market Stall A', '/models/kenney-medieval/structure.glb', [-3, 0, 0], { scale: 2 }),
    place('km_structure_wall', 'Market Stall B', '/models/kenney-medieval/structure-wall.glb', [3, 0, 0], { scale: 2, rotation: [0, Math.PI/2, 0] }),
    place('km_structure_poles', 'Tent Frame', '/models/kenney-medieval/structure-poles.glb', [0, 0, 3], { scale: 2 }),

    // Barrels and crates — market goods
    place('km_barrels', 'Barrel Cluster A', '/models/kenney-medieval/barrels.glb', [-4, 0, 3], { scale: 2 }),
    place('km_barrel', 'Lone Barrel', '/models/kenney-medieval/detail-barrel.glb', [4, 0, -3], { scale: 2 }),
    place('km_crate', 'Supply Crate', '/models/kenney-medieval/detail-crate.glb', [5, 0, 2], { scale: 2 }),
    place('km_crate_ropes', 'Shipping Crate', '/models/kenney-medieval/detail-crate-ropes.glb', [5, 0, 4], { scale: 2 }),
    place('km_crate_small', 'Small Crate', '/models/kenney-medieval/detail-crate-small.glb', [-5, 0, -2], { scale: 2 }),

    // ── Trees and nature ──
    place('km_tree_large', 'Old Oak', '/models/kenney-medieval/tree-large.glb', [7, 0, 7], { scale: 3 }),
    place('km_tree_large', 'Elm Tree', '/models/kenney-medieval/tree-large.glb', [-7, 0, 6], { scale: 2.5 }),
    place('km_tree_shrub', 'Shrub A', '/models/kenney-medieval/tree-shrub.glb', [-6, 0, -6], { scale: 2 }),
    place('km_tree_shrub', 'Shrub B', '/models/kenney-medieval/tree-shrub.glb', [8, 0, -3], { scale: 2 }),
    place('km_tree_shrub', 'Shrub C', '/models/kenney-medieval/tree-shrub.glb', [-2, 0, 7], { scale: 1.5 }),

    // ── Fences around garden area ──
    place('km_fence_wood', 'Garden Fence A', '/models/kenney-medieval/fence-wood.glb', [5, 0, 6], { scale: 2 }),
    place('km_fence_wood', 'Garden Fence B', '/models/kenney-medieval/fence-wood.glb', [7, 0, 4], { scale: 2, rotation: [0, Math.PI/2, 0] }),
    place('km_fence_med', 'Iron Fence', '/models/kenney-medieval/fence.glb', [-7, 0, 3], { scale: 2 }),

    // ── Interior details ──
    place('km_stairs_stone', 'Stone Stairs', '/models/kenney-medieval/stairs-stone.glb', [8, 0, -8], { scale: 2 }),
    place('km_ladder', 'Wall Ladder', '/models/kenney-medieval/ladder.glb', [-9, 0, -6], { scale: 2 }),
    place('km_pulley_crate', 'Pulley System', '/models/kenney-medieval/pulley-crate.glb', [-8, 3, -8], { scale: 2 }),

    // Overhang / balcony
    place('km_overhang', 'Balcony', '/models/kenney-medieval/overhang.glb', [3, 3, -9], { scale: 2 }),
    place('km_overhang_fence', 'Balcony Rail', '/models/kenney-medieval/overhang-fence.glb', [5, 3, -9], { scale: 2 }),

    // Floor tiles near center
    place('km_floor', 'Courtyard Floor A', '/models/kenney-medieval/floor.glb', [0, 0, 0], { scale: 2 }),
    place('km_floor_flat', 'Courtyard Floor B', '/models/kenney-medieval/floor-flat.glb', [-3, 0, -3], { scale: 2 }),

    // ── Village props — kenney medieval village ──
    place('qv_wall_plaster', 'Village House Wall', '/models/quaternius-medieval-village/Wall_Plaster.gltf', [-5, 0, -7], { scale: 1.5 }),
    place('qv_door_round', 'House Door', '/models/quaternius-medieval-village/Door_Round.gltf', [-5, 0, -5], { scale: 1.5 }),
    place('qv_roof_roundtiles', 'House Roof', '/models/quaternius-medieval-village/Roof_RoundTiles.gltf', [-5, 2.5, -6], { scale: 1.5 }),

    // ── Fantasy props for flavor ──
    place('qf_potion_1', 'Health Potion', '/models/quaternius-fantasy/Potion_1.gltf', [-3, 1, 0.5], { scale: 2, behavior: { movement: { type: 'hover', amplitude: 0.15, speed: 1.5, offset: 0 }, visible: true } }),
    place('qf_potion_1', 'Mana Potion', '/models/quaternius-fantasy/Potion_1.gltf', [-3.5, 1, -0.5], { scale: 2, behavior: { movement: { type: 'hover', amplitude: 0.15, speed: 1.5, offset: Math.PI }, visible: true } }),
    place('qf_chest_wood', 'Treasure Chest', '/models/quaternius-fantasy/Chest_Wood.gltf', [0, 0, -3], { scale: 2 }),
    place('qf_shield_1', 'Knight Shield', '/models/quaternius-fantasy/Shield_1.gltf', [3.5, 1.5, -0.5], { scale: 2 }),
    place('qf_sword_bronze', 'Bronze Sword', '/models/quaternius-fantasy/Sword_Bronze.gltf', [3.5, 1, 0.5], { scale: 2, rotation: [0, 0, -Math.PI/4] }),

    // Dock area (side detail)
    place('km_dock_side', 'Dock', '/models/kenney-medieval/dock-side.glb', [9, -0.5, 5], { scale: 2 }),
    place('km_dock_corner', 'Dock Corner', '/models/kenney-medieval/dock-corner.glb', [9, -0.5, 7], { scale: 2 }),

    // Bricks detail
    place('km_bricks', 'Rubble', '/models/kenney-medieval/bricks.glb', [6, 0, -7], { scale: 2 }),

    // Columns
    place('km_column', 'Stone Column A', '/models/kenney-medieval/column.glb', [-2, 0, -8], { scale: 2 }),
    place('km_column_damaged', 'Broken Column', '/models/kenney-medieval/column-damaged.glb', [2, 0, 6], { scale: 2 }),
  ]

  const catalogPlacements = objects.map(o => o.placement)
  const transforms = {}
  const behaviors = {}
  objects.forEach(o => {
    transforms[o._id] = o.transform
    if (o.behavior) behaviors[o._id] = o.behavior
  })

  return {
    terrain: null,
    groundPresetId: 'grass',
    craftedScenes: [
      // Central well
      {
        id: `crafted-well-${Date.now()}`,
        name: 'Village Well',
        prompt: 'Stone well in village center',
        objects: [
          // Well base (cylinder)
          { type: 'cylinder', position: [0, 0.4, 0], scale: [1.2, 0.8, 1.2], color: '#8B7355', roughness: 0.9 },
          // Water surface
          { type: 'cylinder', position: [0, 0.35, 0], scale: [1, 0.05, 1], color: '#1a5276', metalness: 0.3, roughness: 0.2 },
          // Well roof supports
          { type: 'box', position: [-0.5, 1.2, 0], scale: [0.1, 1.6, 0.1], color: '#654321' },
          { type: 'box', position: [0.5, 1.2, 0], scale: [0.1, 1.6, 0.1], color: '#654321' },
          // Roof
          { type: 'cone', position: [0, 2.2, 0], scale: [1.2, 0.6, 1.2], color: '#8B4513' },
          // Bucket
          { type: 'cylinder', position: [0.2, 0.7, 0], scale: [0.2, 0.3, 0.2], color: '#8B7355' },
        ],
        position: [0, 0, 0],
        createdAt: new Date().toISOString(),
      },
      // Village name sign
      {
        id: `crafted-sign-${Date.now() + 1}`,
        name: 'Village Sign',
        prompt: 'Welcome sign',
        objects: [
          { type: 'box', position: [0, 0.5, 0], scale: [0.15, 1, 0.15], color: '#654321' },
          { type: 'box', position: [0, 1.2, 0], scale: [2, 0.6, 0.1], color: '#8B7355' },
          { type: 'text', text: 'WILLKOMMEN', position: [0, 1.3, 0.1], scale: [1, 1, 1], color: '#2c1810', fontSize: 0.3 },
        ],
        position: [0, 0, -8],
        createdAt: new Date().toISOString(),
      },
    ],
    conjuredAssetIds: [],
    catalogPlacements,
    transforms,
    behaviors,
    lights: [
      { id: `light-env-${Date.now()}`, type: 'environment', color: '#ffffff', intensity: 1.0, position: [0, 0, 0] },
      { id: `light-dir-${Date.now()}`, type: 'directional', color: '#ffe4b5', intensity: 2.5, position: [10, 15, 5], target: [0, 0, 0], castShadow: true },
      { id: `light-ambient-${Date.now()}`, type: 'ambient', color: '#87ceeb', intensity: 0.3, position: [0, 0, 0] },
      // Warm torchlight near market stalls
      { id: `light-point-torch1-${Date.now()}`, type: 'point', color: '#ff8c00', intensity: 2, position: [-3, 2.5, 0] },
      { id: `light-point-torch2-${Date.now()}`, type: 'point', color: '#ff8c00', intensity: 2, position: [3, 2.5, 0] },
    ],
    skyBackgroundId: 'sunny_vondelpark',
  }
}

// ═══════════════════════════════════════════════════════════════════════
// WORLD 3: 🚀 Sci-Fi Command Center
// Military base — desks, lockers, weapons, turrets, alien specimens
// ═══════════════════════════════════════════════════════════════════════
function buildSciFiCommandCenter() {
  const objects = [
    // ── Floor platform ──
    place('platform_4x4', 'Floor A', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4.gltf', [0, 0, 0], { scale: 2 }),
    place('platform_4x4', 'Floor B', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4.gltf', [8, 0, 0], { scale: 2 }),
    place('platform_4x4', 'Floor C', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4.gltf', [-8, 0, 0], { scale: 2 }),
    place('platform_4x4', 'Floor D', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4.gltf', [0, 0, 8], { scale: 2 }),
    place('platform_4x4', 'Floor E', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4.gltf', [0, 0, -8], { scale: 2 }),
    place('platform_4x4', 'Floor F', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4.gltf', [8, 0, 8], { scale: 2 }),
    place('platform_4x4', 'Floor G', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4.gltf', [-8, 0, -8], { scale: 2 }),
    place('platform_4x4', 'Floor H', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4.gltf', [8, 0, -8], { scale: 2 }),
    place('platform_4x4', 'Floor I', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_4x4.gltf', [-8, 0, 8], { scale: 2 }),

    // ── Command center desks ──
    place('prop_desk_l', 'Command Desk', '/models/scifi-essentials/Prop_Desk_L.gltf', [0, 0.5, -2], { scale: 2.5 }),
    place('prop_desk_medium', 'Ops Desk A', '/models/scifi-essentials/Prop_Desk_Medium.gltf', [4, 0.5, -2], { scale: 2 }),
    place('prop_desk_medium', 'Ops Desk B', '/models/scifi-essentials/Prop_Desk_Medium.gltf', [-4, 0.5, -2], { scale: 2 }),
    place('prop_desk_small', 'Side Desk', '/models/scifi-essentials/Prop_Desk_Small.gltf', [7, 0.5, -5], { scale: 2 }),
    place('prop_chair', 'Commander Chair', '/models/scifi-essentials/Prop_Chair.gltf', [0, 0.5, -4], { scale: 2 }),
    place('prop_chair', 'Ops Chair A', '/models/scifi-essentials/Prop_Chair.gltf', [4, 0.5, -4], { scale: 2 }),
    place('prop_chair', 'Ops Chair B', '/models/scifi-essentials/Prop_Chair.gltf', [-4, 0.5, -4], { scale: 2 }),

    // ── Computers on desks ──
    place('computer', 'Terminal Alpha', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Computer.gltf', [0, 1.5, -2], { scale: 1.5 }),
    place('computer', 'Terminal Beta', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Computer.gltf', [4, 1.5, -2], { scale: 1.5 }),
    place('computer_large', 'Main Display', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Computer_Large.gltf', [0, 1, -7], { scale: 3, rotation: [0, 0, 0] }),

    // ── Armory section (east wing) ──
    place('prop_locker', 'Armory Locker A', '/models/scifi-essentials/Prop_Locker.gltf', [10, 0.5, -6], { scale: 2 }),
    place('prop_locker', 'Armory Locker B', '/models/scifi-essentials/Prop_Locker.gltf', [10, 0.5, -4], { scale: 2 }),
    place('prop_locker', 'Armory Locker C', '/models/scifi-essentials/Prop_Locker.gltf', [10, 0.5, -2], { scale: 2 }),
    place('prop_shelves_wide_tall', 'Weapon Rack', '/models/scifi-essentials/Prop_Shelves_WideTall.gltf', [10, 0.5, 2], { scale: 2 }),
    place('prop_shelves_thin_tall', 'Supply Shelf', '/models/scifi-essentials/Prop_Shelves_ThinTall.gltf', [10, 0.5, 5], { scale: 2 }),

    // Weapons on display
    place('gun_rifle', 'Rifle Display', '/models/scifi-essentials/Gun_Rifle.gltf', [9, 2, 2], { scale: 2, rotation: [0, 0, Math.PI/12] }),
    place('gun_sniper', 'Sniper Display', '/models/scifi-essentials/Gun_Sniper.gltf', [9, 2.5, 2.5], { scale: 2, rotation: [0, 0, Math.PI/12] }),
    place('gun_pistol', 'Sidearm', '/models/scifi-essentials/Gun_Pistol.gltf', [8, 1.5, -3], { scale: 2 }),
    place('gun_smg', 'SMG', '/models/scifi-essentials/Gun_SMG_Ammo.gltf', [8, 1.5, -5], { scale: 2 }),

    // Ammo and supplies
    place('prop_ammo', 'Ammo Crate A', '/models/scifi-essentials/Prop_Ammo.gltf', [7, 0.5, 5], { scale: 2 }),
    place('prop_ammo_closed', 'Ammo Crate B', '/models/scifi-essentials/Prop_Ammo_Closed.gltf', [7, 0.5, 7], { scale: 2 }),
    place('prop_ammo_small', 'Ammo Box', '/models/scifi-essentials/Prop_Ammo_Small.gltf', [8, 1, 5], { scale: 2 }),
    place('prop_grenade', 'Grenades', '/models/scifi-essentials/Prop_Grenade.gltf', [9, 1.5, 4], { scale: 3 }),

    // ── Storage / logistics (west wing) ──
    place('prop_crate', 'Supply Crate A', '/models/scifi-essentials/Prop_Crate.gltf', [-8, 0.5, 3], { scale: 2 }),
    place('prop_crate_large', 'Large Crate', '/models/scifi-essentials/Prop_Crate_Large.gltf', [-10, 0.5, 5], { scale: 2 }),
    place('prop_crate_tarp', 'Covered Crate', '/models/scifi-essentials/Prop_Crate_Tarp.gltf', [-8, 0.5, 6], { scale: 2 }),
    place('prop_crate_tarp_large', 'Mystery Cargo', '/models/scifi-essentials/Prop_Crate_Tarp_Large.gltf', [-10, 0.5, 8], { scale: 2 }),
    place('prop_barrel1', 'Fuel Barrel A', '/models/scifi-essentials/Prop_Barrel1.gltf', [-6, 0.5, 8], { scale: 2 }),
    place('prop_barrel2_closed', 'Sealed Barrel', '/models/scifi-essentials/Prop_Barrel2_Closed.gltf', [-6, 0.5, 6], { scale: 2 }),
    place('prop_barrel2_open', 'Open Barrel', '/models/scifi-essentials/Prop_Barrel2_Open.gltf', [-4, 0.5, 8], { scale: 2 }),
    place('prop_shelves_wide_short', 'Storage Shelf', '/models/scifi-essentials/Prop_Shelves_WideShort.gltf', [-10, 0.5, -3], { scale: 2 }),

    // ── Medical bay (south) ──
    place('prop_healthpack', 'Med Kit A', '/models/scifi-essentials/Prop_HealthPack.gltf', [-3, 0.5, 6], { scale: 2 }),
    place('prop_healthpack_tube', 'Stim Tube', '/models/scifi-essentials/Prop_HealthPack_Tube.gltf', [-2, 0.5, 7], { scale: 2 }),
    place('prop_syringe', 'Syringe', '/models/scifi-essentials/Prop_Syringe.gltf', [-1, 1, 6], { scale: 3 }),

    // ── Defense turrets ──
    place('turret_gun', 'Entrance Turret', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Enemies/Turret_Gun.gltf', [5, 0.5, 10], { scale: 2, behavior: { movement: { type: 'spin', axis: 'y', speed: 0.15 }, visible: true } }),
    place('turret_double', 'Heavy Turret', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Enemies/Turret_GunDouble.gltf', [-5, 0.5, 10], { scale: 2, behavior: { movement: { type: 'spin', axis: 'y', speed: 0.15 }, visible: true } }),

    // ── Alien specimens (captured enemies in containment) ──
    place('qs_alien_cyclop', 'Specimen Alpha', '/models/quaternius-scifi/Alien_Cyclop.gltf', [-8, 0.5, -6], { scale: 1.5 }),
    place('enemy_eyedrone', 'Captured Drone', '/models/scifi-essentials/Enemy_EyeDrone.gltf', [-6, 2, -7], { scale: 1.5, behavior: { movement: { type: 'hover', amplitude: 0.2, speed: 0.5, offset: 0 }, visible: true } }),
    place('enemy_trilobite', 'Specimen Beta', '/models/scifi-essentials/Enemy_Trilobite.gltf', [-4, 0.5, -7], { scale: 1.5 }),

    // ── SciFi megakit additions ──
    place('qs_platform_stairs', 'Access Stairs', '/models/quaternius-scifi/Platform_Stairs.gltf', [5, 0, 5], { scale: 1.5 }),

    // Satellite dish on roof
    place('prop_satellite', 'Comms Dish', '/models/scifi-essentials/Prop_SatelliteDish.gltf', [0, 5, -10], { scale: 3, behavior: { movement: { type: 'spin', axis: 'y', speed: 0.1 }, visible: true } }),

    // Misc desk items
    place('prop_mug', 'Coffee', '/models/scifi-essentials/Prop_Mug.gltf', [1, 1.5, -2], { scale: 3 }),
    place('prop_keycard', 'Access Card', '/models/scifi-essentials/Prop_KeyCard.gltf', [-4, 1.2, -2], { scale: 3 }),
    place('prop_mine', 'Proximity Mine', '/models/scifi-essentials/Prop_Mine.gltf', [3, 0.5, 8], { scale: 3 }),

    // ── Entrance markers ──
    place('door', 'Main Entrance', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Door.gltf', [0, 0.5, 10], { scale: 2.5 }),
    place('light_street1', 'Entrance Light L', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Light_Street_1.gltf', [-3, 0, 10], { scale: 2 }),
    place('light_street2', 'Entrance Light R', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Light_Street_2.gltf', [3, 0, 10], { scale: 2 }),

    // Eye drone patrolling
    place('enemy_flying_gun', 'Security Drone', '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Enemies/Enemy_Flying_Gun.gltf', [0, 4, 0], { scale: 1.5, behavior: { movement: { type: 'orbit', radius: 8, speed: 0.2, axis: 'xz' }, visible: true } }),
  ]

  const catalogPlacements = objects.map(o => o.placement)
  const transforms = {}
  const behaviors = {}
  objects.forEach(o => {
    transforms[o._id] = o.transform
    if (o.behavior) behaviors[o._id] = o.behavior
  })

  return {
    terrain: null,
    groundPresetId: 'none',
    craftedScenes: [
      // Holographic war table
      {
        id: `crafted-holo-${Date.now()}`,
        name: 'Holographic War Table',
        prompt: 'Holographic tactical display',
        objects: [
          // Table base
          { type: 'cylinder', position: [0, 0.3, 3], scale: [2, 0.6, 2], color: '#1a1a2e', metalness: 0.8, roughness: 0.2 },
          // Holographic terrain (translucent)
          { type: 'box', position: [0, 1, 3], scale: [1.5, 0.01, 1.5], color: '#00ff88', emissive: '#00ff88', emissiveIntensity: 1, opacity: 0.4 },
          // Rotating holographic ring
          { type: 'torus', position: [0, 1.5, 3], rotation: [Math.PI/2, 0, 0], scale: [1.8, 1.8, 0.05], color: '#00aaff', emissive: '#00aaff', emissiveIntensity: 2, opacity: 0.3, animation: { type: 'rotate', speed: 0.5, axis: 'z' } },
          // Data pillars
          { type: 'box', position: [-0.5, 1.3, 2.5], scale: [0.05, 0.6, 0.05], color: '#00ff44', emissive: '#00ff44', emissiveIntensity: 3, animation: { type: 'pulse', speed: 2 } },
          { type: 'box', position: [0.3, 1.5, 3.3], scale: [0.05, 0.8, 0.05], color: '#ff4400', emissive: '#ff4400', emissiveIntensity: 3, animation: { type: 'pulse', speed: 1.5 } },
          { type: 'box', position: [0.5, 1.2, 2.7], scale: [0.05, 0.5, 0.05], color: '#ffaa00', emissive: '#ffaa00', emissiveIntensity: 3, animation: { type: 'pulse', speed: 2.5 } },
          // Center beacon
          { type: 'sphere', position: [0, 1.8, 3], scale: [0.15, 0.15, 0.15], color: '#ffffff', emissive: '#00ffff', emissiveIntensity: 5, animation: { type: 'bob', speed: 1.5, amplitude: 0.2 } },
        ],
        position: [0, 0, 0],
        createdAt: new Date().toISOString(),
      },
      // Header text
      {
        id: `crafted-header-${Date.now() + 1}`,
        name: 'Base ID',
        prompt: 'Military base designation',
        objects: [
          { type: 'text', text: 'OASIS COMMAND', position: [0, 4, -10], scale: [1, 1, 1], color: '#00ffaa', emissive: '#00ffaa', emissiveIntensity: 2, fontSize: 1.5 },
          { type: 'text', text: 'STATION ALPHA-7', position: [0, 2.8, -10], scale: [1, 1, 1], color: '#4488ff', emissive: '#4488ff', emissiveIntensity: 1.5, fontSize: 0.7 },
          // Alert stripes
          { type: 'box', position: [0, 3.5, -10.1], scale: [8, 0.05, 0.01], color: '#ff4400', emissive: '#ff4400', emissiveIntensity: 2 },
          { type: 'box', position: [0, 2.5, -10.1], scale: [6, 0.05, 0.01], color: '#ff4400', emissive: '#ff4400', emissiveIntensity: 2 },
        ],
        position: [0, 0, 0],
        createdAt: new Date().toISOString(),
      },
    ],
    conjuredAssetIds: [],
    catalogPlacements,
    transforms,
    behaviors,
    lights: [
      { id: `light-env-${Date.now()}`, type: 'environment', color: '#ffffff', intensity: 0.4, position: [0, 0, 0] },
      // Cool overhead lighting
      { id: `light-dir-${Date.now()}`, type: 'directional', color: '#ccddff', intensity: 1.5, position: [0, 10, 0], target: [0, 0, 0], castShadow: true },
      // Warm accent near holotable
      { id: `light-point-holo-${Date.now()}`, type: 'point', color: '#00ffaa', intensity: 3, position: [0, 2, 3] },
      // Red alert accent in armory
      { id: `light-point-armory-${Date.now()}`, type: 'point', color: '#ff4444', intensity: 2, position: [10, 2, 0] },
      // Blue accent in containment
      { id: `light-point-contain-${Date.now()}`, type: 'point', color: '#4488ff', intensity: 2, position: [-7, 2, -7] },
      // Entrance spotlights
      { id: `light-spot-entry-${Date.now()}`, type: 'spot', color: '#ffffff', intensity: 3, position: [0, 6, 10], target: [0, 0, 10], angle: 45, castShadow: true },
    ],
    skyBackgroundId: 'night008',
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN — Insert all 3 worlds into Supabase
// ═══════════════════════════════════════════════════════════════════════
async function main() {
  console.log('░▒▓█ CREATING 3 SHOWCASE WORLDS █▓▒░\n')

  // Get user's profile info for creator_name cache
  const { data: profile } = await sb.from('profiles').select('display_name, avatar_url').eq('id', ADMIN_USER_ID).single()
  const creatorName = profile?.display_name || 'vibedev'
  const creatorAvatar = profile?.avatar_url || null

  const worlds = [
    { name: 'Cyberpunk Rooftop', icon: '🏙️', builder: buildCyberpunkRooftop, visibility: 'public' },
    { name: 'Medieval Village', icon: '🏰', builder: buildMedievalVillage, visibility: 'public' },
    { name: 'Sci-Fi Command Center', icon: '🚀', builder: buildSciFiCommandCenter, visibility: 'public' },
  ]

  for (const w of worlds) {
    const state = w.builder()
    const objectCount = (state.catalogPlacements?.length || 0) + (state.craftedScenes?.length || 0)

    const worldData = {
      version: 1,
      ...state,
      savedAt: new Date().toISOString(),
    }

    // Generate world ID same format as world-server.ts
    const worldId = `world-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    // Insert world row
    const { data, error } = await sb.from('worlds').insert({
      id: worldId,
      user_id: ADMIN_USER_ID,
      name: w.name,
      icon: w.icon,
      visibility: w.visibility,
      data: worldData,
      creator_name: creatorName,
      creator_avatar: creatorAvatar,
      object_count: objectCount,
    }).select('id').single()

    if (error) {
      console.error(`✗ Failed to create "${w.name}":`, error.message)
      continue
    }

    console.log(`✓ ${w.icon} ${w.name}`)
    console.log(`  ID: ${data.id}`)
    console.log(`  Objects: ${objectCount}`)
    console.log(`  Visibility: ${w.visibility}`)
    console.log(`  URL: http://localhost:4515/?world=${data.id}`)
    console.log()
  }

  console.log('░▒▓█ DONE █▓▒░')
  console.log('Reload the app to see your new worlds in the world list.')
}

main().catch(console.error)
