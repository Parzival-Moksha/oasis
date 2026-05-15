import { writeFileSync } from 'node:fs'

const WORLD_ID = 'world-rookie-wizard-system'
const PORTAL_ZERO_WORLD_ID = 'world-welcome-hub-system'
const QUEST_ZERO_WORLD_ID = 'world-quest-zero-system'
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

function text(position, value, color = '#dbeafe', scale = [1, 1, 1], extra = {}) {
  return {
    type: 'text',
    text: value,
    position,
    scale,
    color,
    align: 'center',
    emissive: color,
    emissiveIntensity: 0.16,
    ...extra,
  }
}

function text3d(id, value, position, color, size, extra = {}) {
  return {
    id,
    type: 'text_3d',
    text: value,
    fontId: 'helvetiker_regular',
    size,
    depth: Math.max(0.055, size * 0.22),
    color,
    toneBias: 0.08,
    shininess: 0.72,
    position,
    rotation: [0, Math.PI, 0],
    authorId: 'local-user',
    createdAt: Date.parse(CREATED_AT),
    ...extra,
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

function crystalClusterScene(index, x, z, color = '#38bdf8') {
  return crafted(
    `rookie-ground-crystal-${index}`,
    `Low path crystal ${index}`,
    'Small low-poly crystal growths beside the apprentice walkway.',
    [x, 0, z],
    [
      cone([0, 0.32, 0], [0.24, 0.64, 0.24], color, {
        emissive: color,
        emissiveIntensity: 0.18,
        rotation: [0.08, 0.2, -0.08],
      }),
      cone([0.32, 0.22, 0.18], [0.16, 0.44, 0.16], '#a78bfa', {
        emissive: '#a78bfa',
        emissiveIntensity: 0.14,
        rotation: [-0.16, -0.35, 0.12],
      }),
      cone([-0.26, 0.19, -0.1], [0.14, 0.38, 0.14], '#67e8f9', {
        emissive: '#67e8f9',
        emissiveIntensity: 0.12,
        rotation: [0.18, 0.5, -0.16],
      }),
    ],
  )
}

function pebbleScene(index, x, z, sx, sz) {
  return crafted(
    `rookie-path-pebbles-${index}`,
    `Path pebbles ${index}`,
    'A sparse scatter of readable stones and moss at the path edge.',
    [x, 0, z],
    [
      sphere([0, 0.08, 0], [sx, 0.14, sz], '#475569'),
      sphere([0.45, 0.06, -0.22], v(sx * 0.62, 0.1, sz * 0.58), '#334155'),
      sphere([-0.38, 0.04, 0.2], v(sx * 0.46, 0.07, sz * 0.42), '#166534', {
        roughness: 0.9,
      }),
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
for (let z = -18; z <= 4; z += 2) {
  groundTiles[`-2,${z}`] = z % 4 === 0 ? 'kn-rock' : 'kn-dirt'
  groundTiles[`2,${z}`] = z % 4 === 0 ? 'kn-dirt' : 'kn-rock'
}
for (let z = -17; z <= 3; z += 4) {
  groundTiles[`-3,${z}`] = 'kn-grass'
  groundTiles[`3,${z}`] = 'kn-grass'
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

const pathDetails = [
  crystalClusterScene(1, 3.1, -16.2, '#38bdf8'),
  pebbleScene(1, -2.9, -13.8, 0.32, 0.22),
  pebbleScene(2, 2.85, -10.4, 0.26, 0.2),
  crystalClusterScene(2, -3.05, -7.2, '#a78bfa'),
  pebbleScene(3, -2.75, -3.6, 0.3, 0.24),
  crystalClusterScene(3, 3.2, 1.6, '#67e8f9'),
]

const loreGalleryItems = [
  {
    id: 'portal-zero',
    title: 'Portal Zero',
    line: 'Every shared road starts at the hub.',
    z: -14.9,
    imageUrl: '/generated-images/rookie-lore-portal-zero.jpg',
    accent: '#38bdf8',
  },
  {
    id: 'first-gate',
    title: 'The First Gate',
    line: 'A door is a promise: step through and return.',
    z: -10.9,
    imageUrl: '/generated-images/rookie-lore-first-gate.jpg',
    accent: '#c084fc',
  },
  {
    id: 'merlin-lantern',
    title: 'Merlin Lantern',
    line: 'Guides do not own the spell. They aim it.',
    z: -6.9,
    imageUrl: '/generated-images/rookie-lore-merlin-lantern.jpg',
    accent: '#fbbf24',
  },
  {
    id: 'shared-world',
    title: 'Shared World',
    line: 'Presence makes stone remember footsteps.',
    z: -2.9,
    imageUrl: '/generated-images/rookie-lore-shared-world.jpg',
    accent: '#86efac',
  },
  {
    id: 'openclaw-signal',
    title: 'OpenClaw Signal',
    line: 'The avatar is body. The mind arrives awake.',
    z: 1.1,
    imageUrl: '/generated-images/rookie-lore-openclaw-signal.jpg',
    accent: '#fb7185',
  },
]

const loreMediaPlacements = loreGalleryItems.map((item, index) => ({
  id: `rookie-lore-media-${item.id}`,
  catalogId: 'generated-image',
  name: item.title,
  glbPath: '',
  position: [4.2, 1.55, item.z],
  rotation: [0, -Math.PI / 2, 0],
  scale: 1.55,
  imageUrl: item.imageUrl,
  imageFrameStyle: index % 2 === 0 ? 'gilded' : 'baroque',
  imageFrameThickness: 1.08,
  thumbnail: item.imageUrl,
}))

const loreCaptions = loreGalleryItems.map((item, index) => crafted(
  `rookie-lore-caption-${item.id}`,
  `${item.title} caption`,
  `Readable caption beside the ${item.title} generated media frame.`,
  [3.72, 0, item.z + 1.25],
  [
    text([0, 2.95, 0], item.title.toUpperCase(), '#fef3c7', [0.16, 0.16, 0.16], {
      rotation: [0, -Math.PI / 2, 0],
      fontSize: 0.34,
    }),
    text([0, 2.48, 0], item.line, item.accent, [0.11, 0.11, 0.11], {
      rotation: [0, -Math.PI / 2, 0],
      fontSize: 0.23,
    }),
  ],
))

const craftedScenes = [
  crafted('rookie-south-threshold', 'South cave threshold', 'The first steps of the apprentice path.', [0, 0, -18.5], [
    box([0, -0.02, 0], [2.4, 0.035, 1.2], '#1f2937'),
    text([0, 1.05, 0.15], 'ROOKIE WIZARD', '#bfdbfe', [0.28, 0.28, 0.28], {
      rotation: [0, Math.PI, 0],
      fontSize: 0.44,
    }),
  ]),
  crafted('rookie-plaza', 'Merlin plaza', 'A small circular stone plaza where Merlin greets new players.', [0, 0, 8.3], [
    cylinder([0, 0.04, 0], [4.2, 0.08, 4.2], '#3f3f46'),
    cylinder([0, 0.09, 0], [3.55, 0.05, 3.55], '#475569'),
    cylinder([0, 0.18, 1.9], [0.95, 0.22, 0.95], '#64748b'),
    text([0, 0.42, -2.65], 'Speak with Merlin', '#fbbf24', [0.36, 0.36, 0.36], {
      rotation: [0, Math.PI, 0],
      fontSize: 0.46,
    }),
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
    text([0, 2.55, 0], 'MERLIN', '#fde68a', [0.38, 0.38, 0.38], {
      rotation: [0, Math.PI, 0],
      fontSize: 0.42,
    }),
  ]),
  crafted('rookie-portal-signs', 'Portal lesson sign posts', 'Low sign posts under the first three exit labels.', [0, 0, 13.2], [
    cylinder([-3.25, 0.78, -0.58], [0.07, 1.48, 0.07], '#2f2418'),
    cylinder([0, 0.78, -0.58], [0.07, 1.48, 0.07], '#2f2418'),
    cylinder([3.25, 0.78, -0.58], [0.07, 1.48, 0.07], '#2f2418'),
    box([-3.25, 1.45, -0.62], [1.95, 0.12, 0.16], '#5b4632'),
    box([0, 1.45, -0.62], [1.95, 0.12, 0.16], '#5b4632'),
    box([3.25, 1.45, -0.62], [2.25, 0.12, 0.16], '#5b4632'),
  ]),
  ...torches,
  ...mounds,
  ...pathDetails,
  ...loreCaptions,
]

const seed = {
  seedVersion: 1,
  slug: 'rookie-wizard',
  id: WORLD_ID,
  userId: 'local-user',
  name: 'Rookie Wizard',
  icon: 'R',
  visibility: 'public',
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
    catalogPlacements: loreMediaPlacements,
    portalGates: [
      {
        id: 'rookie-arrival-from-portal-zero',
        label: 'Portal Zero return',
        variant: 'threshold-ring',
        position: [0, 0, -19.15],
        rotationY: 0,
        scale: 0.72,
        width: 1.9,
        height: 2.65,
        direction: 'one-way',
        hidden: true,
        sourceWorldId: WORLD_ID,
        targetWorldId: PORTAL_ZERO_WORLD_ID,
        targetWorldName: 'Portal Zero',
        action: { type: 'load_world', worldId: PORTAL_ZERO_WORLD_ID, worldName: 'Portal Zero' },
        spawnPose: { position: [0, 0, -17.6], rotationY: 0 },
      },
      {
        id: 'rookie-to-quest-zero',
        label: 'Quest Zero',
        variant: 'solar-arch',
        position: [0, 0, 15.4],
        rotationY: 0,
        scale: 0.96,
        width: 2.45,
        height: 3.35,
        direction: 'one-way',
        hidden: true,
        sourceWorldId: WORLD_ID,
        targetWorldId: QUEST_ZERO_WORLD_ID,
        targetWorldName: 'Quest Zero',
        action: { type: 'load_world', worldId: QUEST_ZERO_WORLD_ID, worldName: 'Quest Zero' },
        spawnPose: { position: [0, 0, -17.6], rotationY: 0 },
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
        hidden: true,
        sourceWorldId: WORLD_ID,
        targetWorldId: PORTAL_ZERO_WORLD_ID,
        targetWorldName: 'Portal Zero',
        action: { type: 'load_world', worldId: PORTAL_ZERO_WORLD_ID, worldName: 'Portal Zero' },
        spawnPose: { position: [0, 0, -14], rotationY: 0 },
      },
    ],
    spatialWebObjects: [],
    paintStrokes: [],
    text3dObjects: [
      text3d('rookie-sign-quest-zero', 'Quest Zero', [0, 1.45, 12.65], '#fed7aa', 0.38),
      text3d('rookie-sign-portal-zero', 'Portal Zero', [-3.25, 1.45, 12.65], '#bbf7d0', 0.36),
    ],
    transforms: {},
    behaviors: {},
    lights: [
      { id: 'rookie-ambient', type: 'ambient', color: '#b7d7ff', intensity: 0.46 },
      { id: 'rookie-path-blue', type: 'point', position: [0, 3.5, -7], color: '#60a5fa', intensity: 1.15, distance: 24 },
      { id: 'rookie-plaza-gold', type: 'point', position: [0, 4.2, 8.4], color: '#fbbf24', intensity: 1.35, distance: 18 },
      { id: 'rookie-portal-glow', type: 'point', position: [0, 3.2, 15.2], color: '#c084fc', intensity: 1.05, distance: 14 },
    ],
    skyBackgroundId: 'blue_grotto',
    agentWindows: [
      {
        id: 'agent-npc-rookie-merlin',
        agentType: 'npc',
        npcId: 'rookie-wizard-merlin',
        linkedAvatarId: 'agent-avatar-merlin',
        anchorMode: 'next-to',
        position: [1.8, 2.35, 10.15],
        rotation: [0, Math.PI, 0],
        scale: 0.16,
        width: 470,
        height: 680,
        label: 'Merlin',
        renderMode: 'live-html',
        frameStyle: 'hologram',
        frameThickness: 5,
        windowOpacity: 0.92,
        windowBlur: 8,
      },
    ],
    agentAvatars: [
      {
        id: 'agent-avatar-merlin',
        agentType: 'merlin',
        avatar3dUrl: '/avatars/gallery/EYE_Diviner.vrm',
        position: [0, 0, 10.2],
        rotation: [0, 3.141592653589793, 0],
        scale: 1.08,
        linkedWindowId: 'agent-npc-rookie-merlin',
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
      slug: 'quest-zero',
      id: QUEST_ZERO_WORLD_ID,
      file: 'quest-zero.world.json',
      name: 'Quest Zero',
      visibility: 'public',
    },
    {
      slug: 'rookie-wizard',
      id: WORLD_ID,
      file: 'rookie-wizard.world.json',
      name: 'Rookie Wizard',
      visibility: 'public',
    },
  ],
}

writeFileSync('prisma/default-worlds/rookie-wizard.world.json', `${JSON.stringify(seed, null, 2)}\n`)
writeFileSync('prisma/default-worlds/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[rookie-wizard] wrote ${WORLD_ID}`)
