// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SEED — Welcome Hub
// First-load world for openclaw.04515.xyz visitors. Authored, fast, idempotent.
//
// Run: pnpm seed:welcome-hub
//      (equivalently: npx tsx prisma/seed-welcome-hub.ts)
//
// What this seed does:
//   • Upserts a single World row with id "world-welcome-hub-system",
//     ownerId "local-user" (treated as system-owned in both local + hosted modes).
//   • Writes a hand-authored WorldState JSON containing:
//       - belfast_sunset HDRI sky (warm, welcoming)
//       - cobble ground preset (stone path)
//       - 5 lights: ambient warm fill + hemisphere + 3 accent points
//       - Captain Lobster VRM (av_captain_lobster) as the OpenClaw greeter
//       - tasteful scenery: 4 trees, 4 candlestick stands, 2 metal torches,
//         a coin pile, an anvil, and a banner
//       - "Starwell Ring" portal — crafted scene with torus + glow_orb shader
//         primitives. targetWorldId is the same world (loops back) for v1.
//   • Idempotent — re-running updates the row in place; no duplicate worlds.
//
// What this seed does NOT do:
//   • No prisma migrations (writes through the existing prisma.world model only).
//   • No HTTP calls (direct DB write so it works during build / before server up).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { PrismaClient } from '../node_modules/.prisma/client'

const WELCOME_HUB_ID = 'world-welcome-hub-system'
const SYSTEM_OWNER_ID = 'local-user' // hosted mode treats this as system-owned for now

const prisma = new PrismaClient()

// ═══════════════════════════════════════════════════════════════════════════
// Catalog asset IDs — every ID below is verified against
// src/components/scene-lib/constants.ts (ASSET_CATALOG) on 2026-04-28.
// If you add new placements, double-check the id+path pair there first.
// ═══════════════════════════════════════════════════════════════════════════

const ts = Date.now()
let placementSeq = 0
function placementId(catalogId: string): string {
  placementSeq++
  return `catalog-${catalogId}-${ts}-${placementSeq}`
}

interface SeedPlacement {
  id: string
  catalogId: string
  name: string
  glbPath: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale: number
}

function p(
  catalogId: string,
  name: string,
  glbPath: string,
  position: [number, number, number],
  scale: number,
  rotation: [number, number, number] = [0, 0, 0],
): SeedPlacement {
  return { id: placementId(catalogId), catalogId, name, glbPath, position, rotation, scale }
}

// Captain Lobster avatar — present in catalog at av_captain_lobster.
// (See src/lib/agent-avatar-catalog.ts: DEFAULT_AGENT_AVATAR_URL_BY_TYPE.openclaw
//  also points at this exact VRM, so this is the canonical OpenClaw face.)
const CAPTAIN_LOBSTER = p(
  'av_captain_lobster',
  'Captain Lobster (OpenClaw)',
  '/avatars/gallery/CaptainLobster.vrm',
  [0, 0, -3],
  1.2,
  [0, Math.PI, 0], // facing the spawn point (player faces -Z by default)
)

// ═══════════════════════════════════════════════════════════════════════════
// Scenery — small, tasteful spawn-point ring
// All catalog ids below verified in ASSET_CATALOG.
// ═══════════════════════════════════════════════════════════════════════════

const PI = Math.PI
const SCENERY: SeedPlacement[] = [
  // Four trees framing the spawn — Kenney medieval large trees
  p('km_tree_large', 'Tree NE', '/models/kenney-medieval/tree-large.glb', [8, 0, -8], 2.5, [0, 0.4, 0]),
  p('km_tree_large', 'Tree NW', '/models/kenney-medieval/tree-large.glb', [-8, 0, -8], 2.5, [0, 1.7, 0]),
  p('km_tree_large', 'Tree SE', '/models/kenney-medieval/tree-large.glb', [8, 0, 8], 2.5, [0, 2.6, 0]),
  p('km_tree_large', 'Tree SW', '/models/kenney-medieval/tree-large.glb', [-8, 0, 8], 2.5, [0, 0.9, 0]),

  // Four candlestick stands flanking the path — warm, ceremonial
  p('qf_candlestick_stand', 'Candle Front L', '/models/quaternius-fantasy/CandleStick_Stand.gltf', [-2, 0, 2], 1.5),
  p('qf_candlestick_stand', 'Candle Front R', '/models/quaternius-fantasy/CandleStick_Stand.gltf', [2, 0, 2], 1.5),
  p('qf_candlestick_stand', 'Candle Back L', '/models/quaternius-fantasy/CandleStick_Stand.gltf', [-2, 0, -5], 1.5),
  p('qf_candlestick_stand', 'Candle Back R', '/models/quaternius-fantasy/CandleStick_Stand.gltf', [2, 0, -5], 1.5),

  // Two metal torches at the portal threshold
  p('qf_torch_metal', 'Torch L', '/models/quaternius-fantasy/Torch_Metal.gltf', [-3.5, 0, -10], 1.8),
  p('qf_torch_metal', 'Torch R', '/models/quaternius-fantasy/Torch_Metal.gltf', [3.5, 0, -10], 1.8),

  // Mystical accents — coin pile, anvil, banner
  p('qf_coin_pile', 'Coin Pile', '/models/quaternius-fantasy/Coin_Pile_2.gltf', [4, 0, 4], 1.3),
  p('qf_anvil_log', 'Anvil', '/models/quaternius-fantasy/Anvil_Log.gltf', [-4, 0, 4], 1.3, [0, PI / 4, 0]),
  p('qf_banner_1', 'Banner', '/models/quaternius-fantasy/Banner_1.gltf', [0, 0, 6], 1.5),

  // Captain Lobster — OpenClaw greeter avatar
  CAPTAIN_LOBSTER,
]

// ═══════════════════════════════════════════════════════════════════════════
// "Starwell Ring" portal — crafted scene at z = -12 (north of spawn)
// Pure procedural geometry so it loads without GLB fetches.
// targetWorldId is the same world for v1 (loop-back placeholder).
// TODO: when world-routing portal mechanic ships, swap targetWorldId
//       for a real destination world id.
// ═══════════════════════════════════════════════════════════════════════════

const STARWELL_RING = {
  id: 'craft-welcome-starwell-ring',
  name: 'Starwell Ring',
  prompt: 'A glowing portal ring — torus arch with a swirling magical core.',
  position: [0, 1.8, -12] as [number, number, number],
  createdAt: new Date().toISOString(),
  // userData hint for future portal logic — readers can ignore unknown fields.
  // (CraftedScene shape allows extra metadata via JSON; consumers only read
  //  the typed fields. We stash portal info in `prompt` for now and on each
  //  primitive's metadata via a stable name.)
  // Portal target: same world (loop). Replace later via patch script.
  // targetWorldId: WELCOME_HUB_ID
  objects: [
    // Outer torus — vertical (rotated 90° on X) so it stands like a doorway
    {
      type: 'torus' as const,
      position: [0, 0, 0] as [number, number, number],
      rotation: [PI / 2, 0, 0] as [number, number, number],
      scale: [2.0, 2.0, 2.0] as [number, number, number],
      color: '#7e3bff',
      emissive: '#a07bff',
      emissiveIntensity: 1.4,
      metalness: 0.3,
      roughness: 0.4,
      animation: { type: 'rotate' as const, axis: 'z' as const, speed: 0.25 },
    },
    // Inner glow orb — the swirling core
    {
      type: 'glow_orb' as const,
      position: [0, 0, 0] as [number, number, number],
      scale: [1.6, 1.6, 1.6] as [number, number, number],
      color: '#9be0ff',
      color2: '#7e3bff',
      intensity: 2.5,
      speed: 0.6,
      opacity: 0.55,
    },
    // Two small particle emitters for star sparkle
    {
      type: 'particle_emitter' as const,
      position: [-1.6, 0, 0] as [number, number, number],
      scale: [0.4, 0.4, 0.4] as [number, number, number],
      color: '#fff5b8',
      particleCount: 60,
      particleType: 'firefly' as const,
      speed: 0.8,
    },
    {
      type: 'particle_emitter' as const,
      position: [1.6, 0, 0] as [number, number, number],
      scale: [0.4, 0.4, 0.4] as [number, number, number],
      color: '#fff5b8',
      particleCount: 60,
      particleType: 'firefly' as const,
      speed: 0.8,
    },
    // Floating label above the ring
    {
      type: 'text' as const,
      position: [0, 2.4, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      color: '#ffe9b8',
      emissive: '#ffe9b8',
      emissiveIntensity: 0.6,
      text: 'Starwell',
      fontSize: 0.6,
      anchorX: 'center' as const,
      anchorY: 'middle' as const,
    },
  ],
}

// ═══════════════════════════════════════════════════════════════════════════
// Lights — 5 sources, warm + welcoming
// Type ids and shape per src/lib/conjure/types.ts WorldLight.
// ═══════════════════════════════════════════════════════════════════════════

const LIGHTS = [
  // Soft ambient warm fill — every PBR surface gets a baseline
  { id: `light-ambient-${ts}-1`, type: 'ambient' as const, color: '#ffd9a8', intensity: 18, position: [0, 0, 0] as [number, number, number] },
  // Hemisphere — sky + ground tint
  { id: `light-hemisphere-${ts}-2`, type: 'hemisphere' as const, color: '#ffc28a', groundColor: '#3a2d2a', intensity: 30, position: [0, 8, 0] as [number, number, number] },
  // Sun-style directional from above-front
  { id: `light-directional-${ts}-3`, type: 'directional' as const, color: '#fff1d6', intensity: 60, position: [6, 12, 6] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
  // Accent point — purple at the portal
  { id: `light-point-${ts}-4`, type: 'point' as const, color: '#9b6cff', intensity: 90, position: [0, 2.5, -12] as [number, number, number] },
  // Accent point — warm at the spawn
  { id: `light-point-${ts}-5`, type: 'point' as const, color: '#ffb070', intensity: 60, position: [0, 2.0, 2] as [number, number, number] },
]

// ═══════════════════════════════════════════════════════════════════════════
// Agent avatar — bind Captain Lobster placement to the openclaw agent type
// so the OpenClaw panel (when opened) recognizes its embodied greeter.
// ═══════════════════════════════════════════════════════════════════════════

const AGENT_AVATARS = [
  {
    id: `agent-avatar-openclaw-${ts}`,
    agentType: 'openclaw' as const,
    avatar3dUrl: '/avatars/gallery/CaptainLobster.vrm',
    position: [0, 0, -3] as [number, number, number],
    rotation: [0, Math.PI, 0] as [number, number, number],
    scale: 1.2,
    label: 'OpenClaw',
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// Final WorldState — shape per src/lib/forge/world-persistence.ts WorldState
// ═══════════════════════════════════════════════════════════════════════════

const worldState = {
  version: 1 as const,
  terrain: null,
  groundPresetId: 'cobble', // stone path
  craftedScenes: [STARWELL_RING],
  conjuredAssetIds: [] as string[],
  catalogPlacements: SCENERY,
  transforms: {} as Record<string, unknown>,
  lights: LIGHTS,
  skyBackgroundId: 'belfast_sunset', // warm sunset HDRI
  agentAvatars: AGENT_AVATARS,
  savedAt: new Date().toISOString(),
}

const objectCount =
  worldState.craftedScenes.length +
  worldState.conjuredAssetIds.length +
  worldState.catalogPlacements.length

async function main() {
  const existing = await prisma.world.findUnique({ where: { id: WELCOME_HUB_ID } })
  const now = new Date()

  if (existing) {
    await prisma.world.update({
      where: { id: WELCOME_HUB_ID },
      data: {
        userId: SYSTEM_OWNER_ID,
        name: 'Welcome Hub',
        icon: '🌅',
        visibility: 'public',
        data: JSON.stringify(worldState),
        objectCount,
        creatorName: 'The Oasis',
        updatedAt: now,
      },
    })
    console.log(`[seed:welcome-hub] Updated existing Welcome Hub (${WELCOME_HUB_ID}) — ${objectCount} objects.`)
  } else {
    await prisma.world.create({
      data: {
        id: WELCOME_HUB_ID,
        userId: SYSTEM_OWNER_ID,
        name: 'Welcome Hub',
        icon: '🌅',
        visibility: 'public',
        data: JSON.stringify(worldState),
        objectCount,
        creatorName: 'The Oasis',
        createdAt: now,
        updatedAt: now,
      },
    })
    console.log(`[seed:welcome-hub] Created Welcome Hub (${WELCOME_HUB_ID}) — ${objectCount} objects.`)
  }
}

main()
  .catch((err) => {
    console.error('[seed:welcome-hub] Failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
