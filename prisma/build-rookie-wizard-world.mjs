import { writeFileSync } from 'node:fs'

const WORLD_ID = 'world-rookie-wizard-system'
const PORTAL_ZERO_WORLD_ID = 'world-welcome-hub-system'
const CREATED_AT = '2026-05-12T18:00:00.000Z'

function v(x, y, z) {
  return [Number(x.toFixed(3)), Number(y.toFixed(3)), Number(z.toFixed(3))]
}

function crafted(id, name, prompt, position, objects) {
  return {
    id,
    name,
    prompt,
    position,
    createdAt: CREATED_AT,
    model: 'codex-rookie-wizard-primitives',
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

function text(position, value, color = '#dbeafe', scale = [1, 1, 1]) {
  return {
    type: 'text',
    text: value,
    position,
    scale,
    color,
    align: 'center',
    emissive: color,
    emissiveIntensity: 0.16,
  }
}

function torchScene(index, side, z) {
  const x = side === 'left' ? -2.35 : 2.35
  const lean = side === 'left' ? -0.12 : 0.12
  return crafted(
    `rookie-torch-${side}-${index}`,
    `Path torch ${side} ${index}`,
    'A waist-high carved stone torch with blue-orange magical flame.',
    [x, 0, z],
    [
      cylinder([0, 0.48, 0], [0.13, 0.95, 0.13], '#5b4632'),
      cylinder([0, 1.08, 0], [0.22, 0.18, 0.22], '#2f2a26'),
      cone([lean, 1.42, 0], [0.24, 0.62, 0.24], '#fb923c', {
        emissive: '#fb923c',
        emissiveIntensity: 0.85,
        animation: { type: 'pulse', speed: 1.7, intensity: 0.18 },
      }),
      { type: 'flame', position: [lean, 1.5, 0], scale: [0.42, 0.8, 0.42], color: '#60a5fa', emissive: '#60a5fa', emissiveIntensity: 1.2 },
      sphere([0, 1.34, 0], [0.34, 0.34, 0.34], '#38bdf8', {
        emissive: '#38bdf8',
        emissiveIntensity: 0.22,
        transparent: true,
        opacity: 0.35,
      }),
    ],
  )
}

function moundScene(index, x, z, sx, sz, color) {
  return crafted(
    `rookie-cavern-mound-${index}`,
    `Cavern mound ${index}`,
    'Low rounded cave terrain mound forming the edges of the apprentice path.',
    [x, 0, z],
    [
      sphere([0, 0.22, 0], [sx, 0.42, sz], color),
      sphere([sx * 0.28, 0.34, sz * 0.12], [sx * 0.54, 0.38, sz * 0.48], '#334155'),
      sphere([-sx * 0.32, 0.28, -sz * 0.18], [sx * 0.44, 0.3, sz * 0.4], '#475569'),
    ],
  )
}

const groundTiles = {}
for (let z = -18; z <= 15; z += 1) {
  for (let x = -1; x <= 1; x += 1) groundTiles[`${x},${z}`] = 'kn-cobblestone'
}
for (let z = 5; z <= 13; z += 1) {
  for (let x = -4; x <= 4; x += 1) groundTiles[`${x},${z}`] = 'kn-cobblestone'
}

const torches = []
for (let i = 0; i < 10; i += 1) {
  const z = -14 + i * 1.9
  torches.push(torchScene(i + 1, 'left', z), torchScene(i + 1, 'right', z))
}

const mounds = [
  moundScene(1, -5.4, -14, 2.8, 2.1, '#1e293b'),
  moundScene(2, 5.3, -12, 2.4, 2.9, '#27364a'),
  moundScene(3, -6.4, -4, 3.1, 2.4, '#334155'),
  moundScene(4, 6.6, -2.2, 3.2, 2.2, '#1f2a44'),
  moundScene(5, -7.3, 7.4, 3.6, 2.8, '#2b3d52'),
  moundScene(6, 7.5, 8.6, 3.5, 2.6, '#263447'),
]

const craftedScenes = [
  crafted('rookie-south-threshold', 'South cave threshold', 'The first steps of the apprentice path.', [0, 0, -18.5], [
    box([0, -0.02, 0], [2.4, 0.035, 1.2], '#1f2937'),
    text([0, 0.88, -0.45], 'ROOKIE WIZARD', '#bfdbfe', [0.5, 0.5, 0.5]),
  ]),
  crafted('rookie-plaza', 'Merlin plaza', 'A small circular stone plaza where Merlin greets new players.', [0, 0, 8.3], [
    cylinder([0, 0.04, 0], [4.2, 0.08, 4.2], '#3f3f46'),
    cylinder([0, 0.09, 0], [3.55, 0.05, 3.55], '#475569'),
    cylinder([0, 0.18, 1.9], [0.95, 0.22, 0.95], '#64748b'),
    text([0, 0.42, -2.65], 'Speak with Merlin', '#fbbf24', [0.42, 0.42, 0.42]),
  ]),
  crafted('rookie-merlin-aura', 'Merlin aura', 'A quiet gold-blue aura marking Merlin as the first guide.', [0, 0, 10.15], [
    cylinder([0, 0.04, 0], [0.9, 0.08, 0.9], '#1d4ed8', { emissive: '#1d4ed8', emissiveIntensity: 0.18 }),
    sphere([0, 1.25, 0], [1.25, 1.25, 1.25], '#f59e0b', {
      emissive: '#f59e0b',
      emissiveIntensity: 0.16,
      transparent: true,
      opacity: 0.22,
      animation: { type: 'pulse', speed: 0.85, intensity: 0.13 },
    }),
    text([0, 2.55, 0], 'MERLIN', '#fde68a', [0.42, 0.42, 0.42]),
  ]),
  crafted('rookie-portal-signs', 'Portal lesson signs', 'Small signs naming the first two exits.', [0, 0, 13.2], [
    text([3.25, 1.45, -0.55], 'Create your first private world', '#dbeafe', [0.32, 0.32, 0.32]),
    text([-3.25, 1.45, -0.55], 'Portal Zero', '#bbf7d0', [0.36, 0.36, 0.36]),
  ]),
  ...torches,
  ...mounds,
]

const seed = {
  seedVersion: 1,
  slug: 'rookie-wizard',
  id: WORLD_ID,
  userId: 'local-user',
  name: 'Rookie Wizard',
  icon: 'R',
  visibility: 'core',
  creatorName: 'The Oasis',
  creatorAvatar: null,
  thumbnailUrl: null,
  data: {
    version: 1,
    terrain: null,
    terrainHeights: [],
    groundPresetId: 'sand',
    groundTiles,
    craftedScenes,
    conjuredAssetIds: [],
    catalogPlacements: [],
    portalGates: [
      {
        id: 'rookie-new-private-world',
        label: 'Create Private World',
        variant: 'void-door',
        position: [3.4, 0, 15.4],
        rotationY: -0.28,
        scale: 0.95,
        width: 2.35,
        height: 3.15,
        direction: 'one-way',
        sourceWorldId: WORLD_ID,
        action: {
          type: 'create_world',
          visibility: 'private',
          name: 'First spell room',
          icon: 'R',
          promptForName: true,
        },
        spawnPose: { position: [0, 0, -4], rotationY: 0 },
      },
      {
        id: 'rookie-to-portal-zero',
        label: 'Portal Zero',
        variant: 'stargate-vortex',
        position: [-3.4, 0, 15.4],
        rotationY: 0.28,
        scale: 0.92,
        width: 2.45,
        height: 3.35,
        direction: 'one-way',
        sourceWorldId: WORLD_ID,
        targetWorldId: PORTAL_ZERO_WORLD_ID,
        targetWorldName: 'Portal Zero',
        action: { type: 'load_world', worldId: PORTAL_ZERO_WORLD_ID, worldName: 'Portal Zero' },
        spawnPose: { position: [0, 0, -14], rotationY: 0 },
      },
    ],
    spatialWebObjects: [],
    paintStrokes: [],
    text3dObjects: [],
    transforms: {},
    behaviors: {},
    lights: [
      { id: 'rookie-ambient', type: 'ambient', color: '#b7d7ff', intensity: 0.46 },
      { id: 'rookie-path-blue', type: 'point', position: [0, 3.5, -7], color: '#60a5fa', intensity: 1.15, distance: 24 },
      { id: 'rookie-plaza-gold', type: 'point', position: [0, 4.2, 8.4], color: '#fbbf24', intensity: 1.35, distance: 18 },
      { id: 'rookie-portal-glow', type: 'point', position: [0, 3.2, 15.2], color: '#c084fc', intensity: 1.05, distance: 14 },
    ],
    skyBackgroundId: 'blue_grotto',
    agentWindows: [],
    agentAvatars: [
      {
        id: 'agent-avatar-merlin',
        agentType: 'merlin',
        avatar3dUrl: '/avatars/gallery/EYE_Diviner.vrm',
        position: [0, 0, 10.2],
        rotation: [0, 3.141592653589793, 0],
        scale: 1.08,
        label: 'Merlin',
      },
    ],
    savedAt: CREATED_AT,
  },
}

const manifest = {
  seedVersion: 1,
  worlds: [
    {
      slug: 'portal-zero',
      id: PORTAL_ZERO_WORLD_ID,
      file: 'portal-zero.world.json',
      name: 'Portal Zero',
      visibility: 'core',
    },
    {
      slug: 'rookie-wizard',
      id: WORLD_ID,
      file: 'rookie-wizard.world.json',
      name: 'Rookie Wizard',
      visibility: 'core',
    },
  ],
}

writeFileSync('prisma/default-worlds/rookie-wizard.world.json', `${JSON.stringify(seed, null, 2)}\n`)
writeFileSync('prisma/default-worlds/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[rookie-wizard] wrote ${WORLD_ID}`)
