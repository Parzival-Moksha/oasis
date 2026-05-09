import { writeFileSync } from 'node:fs'

const WORLD_ID = 'world-welcome-hub-system'
const CREATED_AT = '2026-05-09T16:00:00.000Z'

function primitive(type, position, scale, color, extra = {}) {
  return {
    type,
    position,
    scale,
    color,
    roughness: 0.72,
    metalness: 0.02,
    ...extra,
  }
}

function scene(id, name, position, objects, prompt = name) {
  return {
    id,
    name,
    prompt,
    position,
    createdAt: CREATED_AT,
    model: 'codex-portal-zero-primitives',
    objects,
  }
}

function text(id, label, position, rotationY, size = 0.42, color = '#e0f2fe') {
  return scene(id, label, position, [
    primitive('text', [0, 0, 0], [1, 1, 1], color, {
      text: label,
      fontSize: size,
      anchorX: 'center',
      anchorY: 'middle',
      rotation: [0, rotationY, 0],
      emissive: color,
      emissiveIntensity: 0.35,
    }),
  ], `Readable hub label: ${label}`)
}

function plinth(id, name, position, color, radius = 2.8) {
  return scene(id, name, position, [
    primitive('cylinder', [0, 0.07, 0], [radius, 0.14, radius], color, {
      roughness: 0.64,
    }),
  ], `${name} lightweight circular platform`)
}

function markerPair(id, name, x, z, color) {
  return scene(id, name, [x, 0, z], [
    primitive('cylinder', [-0.6, 0.72, 0], [0.08, 1.45, 0.08], '#64748b', { roughness: 0.58 }),
    primitive('cylinder', [0.6, 0.72, 0], [0.08, 1.45, 0.08], '#64748b', { roughness: 0.58 }),
    primitive('box', [0, 1.5, 0], [1.55, 0.22, 0.14], color, {
      emissive: color,
      emissiveIntensity: 0.14,
      roughness: 0.46,
    }),
  ], `${name} small runway marker`)
}

function lantern(id, name, position, color) {
  return scene(id, name, position, [
    primitive('cylinder', [0, 0.5, 0], [0.08, 1.0, 0.08], '#334155', { metalness: 0.18, roughness: 0.42 }),
    primitive('sphere', [0, 1.15, 0], [0.34, 0.34, 0.34], color, {
      emissive: color,
      emissiveIntensity: 0.72,
      opacity: 0.86,
    }),
  ], `${name} low-poly glow lantern`)
}

function crystal(id, name, position, color, color2) {
  return scene(id, name, position, [
    primitive('crystal', [0, 0.68, 0], [0.48, 1.35, 0.48], color, {
      color2,
      intensity: 0.8,
      speed: 0.35,
    }),
  ], `${name} tiny shader crystal marker`)
}

function bench(id, name, position, rotationY) {
  return scene(id, name, position, [
    primitive('box', [0, 0.46, 0], [1.7, 0.16, 0.48], '#7c4a21', {
      rotation: [0, rotationY, 0],
    }),
    primitive('box', [-0.58, 0.24, 0], [0.16, 0.48, 0.18], '#3f2b16', { rotation: [0, rotationY, 0] }),
    primitive('box', [0.58, 0.24, 0], [0.16, 0.48, 0.18], '#3f2b16', { rotation: [0, rotationY, 0] }),
  ], `${name} simple movable bench`)
}

function planter(id, name, position, color) {
  return scene(id, name, position, [
    primitive('cylinder', [0, 0.24, 0], [0.45, 0.48, 0.45], '#5f3b23', {
      roughness: 0.86,
    }),
    primitive('cone', [0, 0.9, 0], [0.7, 0.95, 0.7], color, {
      roughness: 0.76,
      emissive: color,
      emissiveIntensity: 0.04,
    }),
  ], `${name} small plant landmark`)
}

function makeGroundTiles() {
  const tiles = {}
  for (let z = -22; z <= 22; z += 1) {
    tiles[`-1,${z}`] = 'kn-cobblestone'
    tiles[`0,${z}`] = 'kn-cobblestone'
    tiles[`1,${z}`] = 'kn-cobblestone'
  }
  for (let x = -22; x <= 22; x += 1) {
    tiles[`${x},-1`] = 'kn-cobblestone'
    tiles[`${x},0`] = 'kn-cobblestone'
    tiles[`${x},1`] = 'kn-cobblestone'
  }
  return tiles
}

const craftedScenes = [
  scene('pz-center-compass-ring', 'Portal Zero center compass ring', [0, 0, 0], [
    primitive('torus', [0, 0.12, 0], [4.7, 4.7, 0.12], '#38bdf8', {
      rotation: [Math.PI / 2, 0, 0],
      emissive: '#0ea5e9',
      emissiveIntensity: 0.18,
      roughness: 0.36,
    }),
  ], 'A separate editable center compass ring'),
  scene('pz-center-stone-dais', 'Portal Zero stone dais', [0, 0, 0], [
    primitive('cylinder', [0, 0.08, 0], [3.5, 0.16, 3.5], '#ffffff', {
      roughness: 0.82,
    }),
  ]),
  scene('pz-center-title', 'Portal Zero title', [0, 1.35, -2.45], [
    primitive('text', [0, 0, 0], [1, 1, 1], '#f8fafc', {
      text: 'PORTAL ZERO',
      fontSize: 0.66,
      anchorX: 'center',
      anchorY: 'middle',
      emissive: '#bae6fd',
      emissiveIntensity: 0.25,
    }),
  ]),
  text('pz-center-subtitle', 'choose a runway', [0, 0.9, 2.35], Math.PI, 0.31, '#bae6fd'),

  plinth('pz-conjure-plinth', 'Conjure portal plinth', [0, 0, -18.7], '#155e75'),
  plinth('pz-public-plinth', 'Public worlds plinth', [18.7, 0, 0], '#92400e'),
  plinth('pz-ffa-plinth', 'FFA worlds plinth', [0, 0, 18.7], '#166534'),
  plinth('pz-private-plinth', 'Private worlds plinth', [-18.7, 0, 0], '#4c1d95'),

  text('pz-conjure-sign', 'CONJURE', [0, 1.25, -14.2], 0, 0.46, '#67e8f9'),
  text('pz-public-sign', 'PUBLIC', [14.2, 1.25, 0], -Math.PI / 2, 0.46, '#fde68a'),
  text('pz-ffa-sign', 'FFA BUILD', [0, 1.25, 14.2], Math.PI, 0.46, '#86efac'),
  text('pz-private-sign', 'PRIVATE', [-14.2, 1.25, 0], Math.PI / 2, 0.46, '#c4b5fd'),

  text('pz-public-runway-note', 'public gallery runway', [9.5, 0.95, -2.35], -Math.PI / 2, 0.28, '#fed7aa'),
  text('pz-ffa-runway-note', 'free-build quadrant', [2.35, 0.95, 9.5], Math.PI, 0.28, '#bbf7d0'),
  text('pz-private-runway-note', 'solo lab door', [-9.5, 0.95, 2.35], Math.PI / 2, 0.28, '#ddd6fe'),
  text('pz-conjure-runway-note', 'external arena', [-2.35, 0.95, -9.5], 0, 0.28, '#cffafe'),

  markerPair('pz-north-runway-left-marker', 'Conjure left runway marker', [-2.55, 0, -9.4], '#0891b2'),
  markerPair('pz-north-runway-right-marker', 'Conjure right runway marker', [2.55, 0, -9.4], '#0891b2'),
  markerPair('pz-east-runway-marker', 'Public runway marker', [9.4, 0, 2.55], '#ca8a04'),
  markerPair('pz-south-runway-marker', 'FFA runway marker', [2.55, 0, 9.4], '#16a34a'),
  markerPair('pz-west-runway-marker', 'Private runway marker', [-9.4, 0, -2.55], '#7c3aed'),

  scene('pz-google-forms-altar-base', 'Google Forms altar base', [-6.2, 0, -4.5], [
    primitive('cylinder', [0, 0.32, 0], [1.35, 0.64, 1.35], '#ffffff', {
      roughness: 0.46,
    }),
    primitive('box', [0, 0.82, 0], [2.25, 0.18, 1.22], '#0f172a', {
      emissive: '#0e7490',
      emissiveIntensity: 0.08,
      rotation: [0, 0.56, 0],
    }),
  ], 'Separate base for the spatial Google Forms altar'),
  text('pz-google-forms-altar-label', 'FORMS ALTAR', [-7.9, 1.65, -5.75], 0.56, 0.32, '#67e8f9'),

  lantern('pz-lantern-ne', 'Northeast lantern', [6.5, 0, -6.5], '#22d3ee'),
  lantern('pz-lantern-se', 'Southeast lantern', [6.5, 0, 6.5], '#fbbf24'),
  lantern('pz-lantern-sw', 'Southwest lantern', [-6.5, 0, 6.5], '#a78bfa'),
  lantern('pz-lantern-nw', 'Northwest lantern', [-6.5, 0, -6.5], '#86efac'),

  crystal('pz-crystal-public', 'Public amber shard', [12.1, 0, -5.4], '#f59e0b', '#fde68a'),
  crystal('pz-crystal-ffa', 'FFA emerald shard', [5.4, 0, 12.1], '#22c55e', '#bbf7d0'),
  crystal('pz-crystal-private', 'Private violet shard', [-12.1, 0, 5.4], '#8b5cf6', '#ddd6fe'),
  crystal('pz-crystal-conjure', 'Conjure cyan shard', [-5.4, 0, -12.1], '#06b6d4', '#cffafe'),

  bench('pz-bench-east', 'East waiting bench', [7.7, 0, -3.9], -0.24),
  bench('pz-bench-west', 'West waiting bench', [-7.7, 0, 3.9], 2.9),
  planter('pz-planter-public', 'Public sprout planter', [11.8, 0, 4.6], '#65a30d'),
  planter('pz-planter-ffa', 'FFA fern planter', [-4.6, 0, 11.8], '#16a34a'),
  planter('pz-planter-private', 'Private blue planter', [-11.8, 0, -4.6], '#38bdf8'),
]

const portalGates = [
  {
    id: 'portal-zero-conjure-external',
    label: 'Conjure Arena',
    variant: 'stargate-vortex',
    position: [0, 0, -19.8],
    rotationY: 0,
    scale: 0.96,
    width: 2.65,
    height: 3.55,
    direction: 'one-way',
    sourceWorldId: WORLD_ID,
    action: {
      type: 'external_url',
      url: 'https://conjure.04515.xyz',
      label: 'Conjure Arena',
      returnUrl: 'current',
      requiresConfirm: false,
    },
  },
  {
    id: 'portal-zero-new-public-world',
    label: 'New Public World',
    variant: 'solar-arch',
    position: [19.8, 0, 0],
    rotationY: -Math.PI / 2,
    scale: 0.92,
    width: 2.35,
    height: 3.15,
    direction: 'one-way',
    sourceWorldId: WORLD_ID,
    action: { type: 'create_world', visibility: 'public', name: 'Public world', icon: 'P', promptForName: true },
  },
  {
    id: 'portal-zero-new-ffa-world',
    label: 'New FFA World',
    variant: 'rift-slit',
    position: [0, 0, 19.8],
    rotationY: Math.PI,
    scale: 0.92,
    width: 2.35,
    height: 3.15,
    direction: 'one-way',
    sourceWorldId: WORLD_ID,
    action: { type: 'create_world', visibility: 'ffa', name: 'Free for all world', icon: 'F', promptForName: true },
  },
  {
    id: 'portal-zero-new-private-world',
    label: 'New Private World',
    variant: 'void-door',
    position: [-19.8, 0, 0],
    rotationY: Math.PI / 2,
    scale: 0.92,
    width: 2.35,
    height: 3.15,
    direction: 'one-way',
    sourceWorldId: WORLD_ID,
    action: { type: 'create_world', visibility: 'private', name: 'Private world', icon: 'R', promptForName: true },
  },
]

const data = {
  version: 1,
  terrain: null,
  terrainHeights: [],
  groundPresetId: 'grass',
  groundTiles: makeGroundTiles(),
  craftedScenes,
  conjuredAssetIds: [],
  catalogPlacements: [],
  portalGates,
  spatialWebObjects: [
    {
      id: 'spatial-google-forms-altar-portal-zero',
      type: 'text',
      formId: 'portal-zero-google-forms-altar',
      label: 'Google Forms Altar',
      description: 'Paste a public Google Form link. The altar builds a shareable Oasis world, then opens a portal.',
      value: '',
      placeholder: 'https://forms.gle/...',
      position: [-6.2, 1.2, -4.5],
      rotation: [0, 0.56, 0],
      width: 4.8,
      height: 1.65,
      accentColor: '#22d3ee',
      visualStyle: 'google-form-altar',
      action: {
        type: 'create_world_from_google_form',
        successMessage: 'Oasis world ready.',
      },
    },
  ],
  transforms: {},
  behaviors: {},
  lights: [
    { id: 'pz-hemi-soft-stars', type: 'hemisphere', position: [0, 14, 0], color: '#c7d2fe', intensity: 0.55 },
    { id: 'pz-center-cyan-fill', type: 'point', position: [0, 3.2, 0], color: '#67e8f9', intensity: 1.0, distance: 26 },
    { id: 'pz-public-warm-fill', type: 'point', position: [14, 2.8, 0], color: '#fbbf24', intensity: 0.56, distance: 15 },
    { id: 'pz-ffa-green-fill', type: 'point', position: [0, 2.8, 14], color: '#86efac', intensity: 0.48, distance: 15 },
  ],
  skyBackgroundId: 'blue_grotto',
  agentWindows: [],
  agentAvatars: [],
  savedAt: CREATED_AT,
}

const seed = {
  seedVersion: 1,
  slug: 'portal-zero',
  id: WORLD_ID,
  userId: 'local-user',
  name: 'Portal Zero',
  icon: '0',
  visibility: 'core',
  creatorName: 'The Oasis',
  creatorAvatar: null,
  thumbnailUrl: null,
  data,
}

writeFileSync('prisma/default-worlds/portal-zero.world.json', `${JSON.stringify(seed, null, 2)}\n`)

const counts = {
  craftedScenes: data.craftedScenes.length,
  primitiveObjects: data.craftedScenes.reduce((sum, item) => sum + item.objects.length, 0),
  portalGates: data.portalGates.length,
  spatialWebObjects: data.spatialWebObjects.length,
  lights: data.lights.length,
  groundTiles: Object.keys(data.groundTiles).length,
}

console.log(JSON.stringify({ worldId: WORLD_ID, counts, skyBackgroundId: data.skyBackgroundId, groundPresetId: data.groundPresetId }, null, 2))
