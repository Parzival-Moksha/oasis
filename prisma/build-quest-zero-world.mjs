import { writeFileSync } from 'node:fs'

const WORLD_ID = 'world-quest-zero-system'
const ROOKIE_WIZARD_WORLD_ID = 'world-rookie-wizard-system'
const CREATED_AT = '2026-05-14T12:00:00.000Z'

function crafted(id, name, prompt, position, objects) {
  return {
    id,
    name,
    prompt,
    position,
    createdAt: CREATED_AT,
    model: 'codex-quest-zero-primitives',
    objects,
  }
}

function box(position, scale, color, extra = {}) {
  return { type: 'box', position, scale, color, roughness: 0.78, metalness: 0.02, ...extra }
}

function sphere(position, scale, color, extra = {}) {
  return { type: 'sphere', position, scale, color, roughness: 0.82, metalness: 0.02, ...extra }
}

function cylinder(position, scale, color, extra = {}) {
  return { type: 'cylinder', position, scale, color, roughness: 0.72, metalness: 0.02, ...extra }
}

function cone(position, scale, color, extra = {}) {
  return { type: 'cone', position, scale, color, roughness: 0.7, metalness: 0.02, ...extra }
}

function torus(position, scale, color, extra = {}) {
  return { type: 'torus', position, scale, color, roughness: 0.64, metalness: 0.04, ...extra }
}

function flame(position, scale, color = '#fb923c', extra = {}) {
  return {
    type: 'flame',
    position,
    scale,
    color,
    color2: '#fde68a',
    color3: '#ef4444',
    intensity: 1.25,
    speed: 1.25,
    ...extra,
  }
}

function glow(position, scale, color = '#fb923c', extra = {}) {
  return {
    type: 'glow_orb',
    position,
    scale,
    color,
    emissive: color,
    emissiveIntensity: 0.9,
    intensity: 1.15,
    ...extra,
  }
}

function text(position, value, color = '#fed7aa', scale = [1, 1, 1], extra = {}) {
  return {
    type: 'text',
    text: value,
    position,
    scale,
    color,
    align: 'center',
    emissive: color,
    emissiveIntensity: 0.18,
    ...extra,
  }
}

function fireTarget(index, position, accent) {
  return crafted(
    `quest-zero-fire-target-${index}`,
    `Fire Target ${index}`,
    'A wooden firebolt practice target with a glowing bullseye and non-form input surface.',
    position,
    [
      cylinder([0, 0.82, 0], [0.08, 1.64, 0.08], '#2f2418'),
      cylinder([0.58, 0.72, 0], [0.06, 1.44, 0.06], '#2f2418', { rotation: [0, 0, 0.08] }),
      cylinder([-0.58, 0.72, 0], [0.06, 1.44, 0.06], '#2f2418', { rotation: [0, 0, -0.08] }),
      box([0, 1.55, 0], [1.72, 1.18, 0.12], '#4b2f1f'),
      box([0, 1.55, -0.07], [1.46, 0.92, 0.08], '#1f130c'),
      torus([0, 1.55, -0.15], [0.92, 0.92, 0.1], accent, {
        rotation: [Math.PI / 2, 0, 0],
        emissive: accent,
        emissiveIntensity: 0.65,
      }),
      torus([0, 1.55, -0.18], [0.54, 0.54, 0.08], '#fde68a', {
        rotation: [Math.PI / 2, 0, 0],
        emissive: '#fde68a',
        emissiveIntensity: 0.72,
      }),
      sphere([0, 1.55, -0.24], [0.18, 0.18, 0.18], '#fef3c7', {
        emissive: '#f97316',
        emissiveIntensity: 1.2,
        animation: { type: 'pulse', speed: 1.8, amplitude: 0.16 },
      }),
      text([0, 2.34, -0.17], `TARGET ${index}`, '#fed7aa', [0.2, 0.2, 0.2], {
        rotation: [0, Math.PI, 0],
        fontSize: 0.25,
      }),
    ],
  )
}

function campfire(id, position) {
  return crafted(
    id,
    'Shrine campfire',
    'A small ritual fire with crossed logs, flame shader, ember glow, and smoke-like sparks.',
    position,
    [
      cylinder([-0.22, 0.16, 0], [0.1, 0.72, 0.1], '#3a2518', { rotation: [Math.PI / 2, 0, 1.0] }),
      cylinder([0.22, 0.16, 0], [0.1, 0.72, 0.1], '#3a2518', { rotation: [Math.PI / 2, 0, -1.0] }),
      cylinder([0, 0.12, 0.2], [0.08, 0.64, 0.08], '#4b2f1f', { rotation: [Math.PI / 2, 0, 0] }),
      flame([0, 0.58, 0], [0.52, 0.95, 0.52]),
      glow([0, 0.5, 0], [0.8, 0.8, 0.8], '#f97316'),
      { type: 'particle_emitter', position: [0, 0.9, 0], scale: [1, 1, 1], color: '#fed7aa', particleType: 'ember', particleCount: 34, speed: 0.75 },
    ],
  )
}

function stakeRing() {
  const objects = []
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2
    const radius = i % 2 === 0 ? 5.6 : 6.35
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    objects.push(
      cylinder([x, 0.8, z], [0.08, 1.6, 0.08], '#2f2418', { rotation: [0.12, angle, 0.05] }),
      cone([x, 1.68, z], [0.16, 0.34, 0.16], '#1c120b'),
    )
    if (i % 4 === 0) {
      objects.push(flame([x * 0.96, 1.88, z * 0.96], [0.18, 0.42, 0.18], '#fb923c'))
    }
  }
  return crafted(
    'quest-zero-stake-ring',
    'Fire shrine stake ring',
    'A rough ring of wooden stakes and little flames enclosing the Fire Guardian trial.',
    [0, 0, 12.8],
    objects,
  )
}

function shrineAltar() {
  return crafted(
    'quest-zero-fire-shrine',
    'Fire Guardian shrine',
    'A tribal stone-and-wood fire shrine where the first combat spell is earned.',
    [0, 0, 12.6],
    [
      cylinder([0, 0.08, 0], [3.3, 0.16, 3.3], '#2f2a26'),
      cylinder([0, 0.18, 0], [2.45, 0.11, 2.45], '#3f3f46'),
      box([0, 0.55, 1.45], [1.95, 0.58, 0.72], '#3a2a1a'),
      box([0, 0.9, 1.45], [1.35, 0.22, 0.52], '#21150d'),
      flame([0, 1.35, 1.45], [0.58, 1.1, 0.58]),
      glow([0, 1.18, 1.45], [1.2, 1.2, 1.2], '#fb923c'),
      text([0, 2.55, 1.15], 'FIRE GUARDIAN', '#fed7aa', [0.34, 0.34, 0.34], {
        rotation: [0, Math.PI, 0],
        fontSize: 0.38,
      }),
    ],
  )
}

function spawnCircle() {
  return crafted(
    'quest-zero-spawn-circle',
    'Quest Zero arrival circle',
    'A clear stone arrival circle with a visible path toward the fire shrine.',
    [0, 0, -17.5],
    [
      cylinder([0, 0.04, 0], [2.15, 0.08, 2.15], '#334155'),
      cylinder([0, 0.1, 0], [1.6, 0.05, 1.6], '#475569'),
      text([0, 0.45, -1.52], 'Quest Zero', '#fed7aa', [0.34, 0.34, 0.34], {
        rotation: [0, Math.PI, 0],
        fontSize: 0.42,
      }),
    ],
  )
}

function pathTorch(index, x, z) {
  return crafted(
    `quest-zero-path-torch-${index}`,
    `Quest path torch ${index}`,
    'A waist-high trail torch along the road to the Fire Guardian.',
    [x, 0, z],
    [
      cylinder([0, 0.62, 0], [0.09, 1.18, 0.09], '#2f2418'),
      cone([0, 1.34, 0], [0.18, 0.48, 0.18], '#f97316', { emissive: '#f97316', emissiveIntensity: 0.4 }),
      flame([0, 1.48, 0], [0.28, 0.56, 0.28]),
    ],
  )
}

const groundTiles = {}
for (let z = -18; z <= 20; z += 1) {
  for (let x = -1; x <= 1; x += 1) groundTiles[`${x},${z}`] = 'kn-dirt'
}
for (let z = -18; z <= 20; z += 2) {
  groundTiles[`-2,${z}`] = 'kn-grass'
  groundTiles[`2,${z}`] = 'kn-grass'
}
for (let z = 8; z <= 20; z += 1) {
  for (let x = -7; x <= 7; x += 1) {
    const dist = Math.hypot(x, z - 14)
    if (dist < 7.4) groundTiles[`${x},${z}`] = dist < 3.2 ? 'kn-cobblestone' : 'kn-rock'
  }
}
for (let z = -22; z <= 24; z += 1) {
  for (let x = -10; x <= 10; x += 1) {
    if (groundTiles[`${x},${z}`]) continue
    if ((x + z) % 7 === 0) groundTiles[`${x},${z}`] = 'forest'
    else if ((x * 3 + z) % 11 === 0) groundTiles[`${x},${z}`] = 'leaves'
  }
}

const craftedScenes = [
  spawnCircle(),
  pathTorch(1, -2.35, -12.8),
  pathTorch(2, 2.35, -9.8),
  pathTorch(3, -2.35, -6.4),
  pathTorch(4, 2.35, -3.0),
  pathTorch(5, -2.35, 0.4),
  pathTorch(6, 2.35, 3.8),
  pathTorch(7, -2.35, 7.2),
  shrineAltar(),
  stakeRing(),
  campfire('quest-zero-campfire-left', [-4.4, 0, 11.4]),
  campfire('quest-zero-campfire-right', [4.4, 0, 11.4]),
  fireTarget(1, [-3.4, 0, 18.2], '#fb923c'),
  fireTarget(2, [0, 0, 19.2], '#f97316'),
  fireTarget(3, [3.4, 0, 18.2], '#ef4444'),
]

const seed = {
  seedVersion: 1,
  slug: 'quest-zero',
  id: WORLD_ID,
  userId: 'local-user',
  name: 'Quest Zero',
  icon: 'Q',
  visibility: 'public',
  creatorName: 'The Oasis',
  creatorAvatar: null,
  thumbnailUrl: null,
  data: {
    version: 1,
    terrain: null,
    terrainHeights: [],
    groundPresetId: 'forest',
    groundTiles,
    craftedScenes,
    conjuredAssetIds: [],
    catalogPlacements: [],
    portalGates: [
      {
        id: 'quest-zero-to-rookie-wizard',
        label: 'Rookie Wizard',
        variant: 'verdant-arch',
        position: [0, 0, -20.4],
        rotationY: Math.PI,
        scale: 0.92,
        width: 2.45,
        height: 3.35,
        direction: 'one-way',
        sourceWorldId: WORLD_ID,
        targetWorldId: ROOKIE_WIZARD_WORLD_ID,
        targetWorldName: 'Rookie Wizard',
        action: { type: 'load_world', worldId: ROOKIE_WIZARD_WORLD_ID, worldName: 'Rookie Wizard' },
        spawnPose: { position: [0, 0, -17.6], rotationY: 0 },
      },
    ],
    spatialWebObjects: [],
    paintStrokes: [],
    text3dObjects: [],
    transforms: {},
    behaviors: {},
    lights: [
      { id: 'quest-zero-ambient', type: 'ambient', color: '#ffe7bf', intensity: 0.42 },
      { id: 'quest-zero-fire-shrine-glow', type: 'point', position: [0, 3.4, 13.2], color: '#fb923c', intensity: 1.8, distance: 19 },
      { id: 'quest-zero-target-glow', type: 'point', position: [0, 3.1, 18.7], color: '#f97316', intensity: 1.15, distance: 16 },
      { id: 'quest-zero-spawn-glow', type: 'point', position: [0, 2.7, -17.5], color: '#fbbf24', intensity: 0.8, distance: 10 },
    ],
    skyBackgroundId: 'forest',
    agentWindows: [
      {
        id: 'agent-npc-quest-zero-merlin',
        agentType: 'npc',
        npcId: 'quest-zero-merlin',
        linkedAvatarId: 'agent-avatar-quest-zero-merlin',
        anchorMode: 'next-to',
        position: [2.2, 2.35, -14.7],
        rotation: [0, Math.PI, 0],
        scale: 0.15,
        width: 470,
        height: 680,
        label: 'Merlin',
        renderMode: 'live-html',
        frameStyle: 'hologram',
        frameThickness: 5,
        windowOpacity: 0.92,
        windowBlur: 8,
      },
      {
        id: 'agent-npc-fire-guardian',
        agentType: 'npc',
        npcId: 'quest-zero-fire-guardian',
        linkedAvatarId: 'agent-avatar-npc-fire-guardian',
        anchorMode: 'next-to',
        position: [1.85, 2.45, 12.35],
        rotation: [0, Math.PI, 0],
        scale: 0.16,
        width: 470,
        height: 720,
        label: 'Fire Guardian',
        renderMode: 'live-html',
        frameStyle: 'fire',
        frameThickness: 6,
        windowOpacity: 0.92,
        windowBlur: 8,
      },
    ],
    agentAvatars: [
      {
        id: 'agent-avatar-quest-zero-merlin',
        agentType: 'npc',
        avatar3dUrl: '/avatars/gallery/EYE_Diviner.vrm',
        position: [1.4, 0, -14.7],
        rotation: [0, Math.PI, 0],
        scale: 1.04,
        linkedWindowId: 'agent-npc-quest-zero-merlin',
        label: 'Merlin',
      },
      {
        id: 'agent-avatar-npc-fire-guardian',
        agentType: 'npc',
        avatar3dUrl: '/avatars/gallery/EvilPendra.vrm',
        position: [0, 0, 12.35],
        rotation: [0, Math.PI, 0],
        scale: 1.08,
        linkedWindowId: 'agent-npc-fire-guardian',
        label: 'Fire Guardian',
      },
    ],
    savedAt: CREATED_AT,
  },
}

writeFileSync('prisma/default-worlds/quest-zero.world.json', `${JSON.stringify(seed, null, 2)}\n`)
console.log(`[quest-zero] wrote ${WORLD_ID}`)
