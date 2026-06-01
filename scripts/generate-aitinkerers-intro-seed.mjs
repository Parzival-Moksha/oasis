#!/usr/bin/env node
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Generate the AI Tinkerers Bogotá 2026 intro world seed.
// Runway-style 3D PowerPoint: spawn at +z, walk -z through 5 chapter
// stations, exit through a portal fan. Halliday voice: lore first.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(__dirname, '..', 'prisma', 'default-worlds', 'aitinkerers-bogota-intro.world.json')

const WORLD_ID = 'world-aitinkerers-bogota-intro'
const OWNER = 'chrome3'
const CREATED_AT = '2026-05-28T00:00:00.000Z'
const SAVED_AT = new Date().toISOString()

// ─═̷─═̷─ LAYOUT ─═̷─═̷─
// Spawn at z=+5 looking -z. Chapters every ~12 units. Portal fan at z=-66.
const CHAPTER_Z = [-5, -17, -29, -41, -53]
const PORTAL_FAN_Z = -66
const RUNWAY_X = [-1, 0, 1]      // 3-wide dirt path
const RUNWAY_Z_MIN = -68
const RUNWAY_Z_MAX = 5

// ─═̷─═̷─ GROUND TILES ─═̷─═̷─
function buildGroundTiles() {
  const tiles = {}
  // Dirt runway down the spine
  for (let z = RUNWAY_Z_MIN; z <= RUNWAY_Z_MAX; z += 1) {
    for (const x of RUNWAY_X) tiles[`${x},${z}`] = 'dirt'
  }
  // Cobble clearings at each chapter station (7×7 centered on chapter z)
  for (const cz of CHAPTER_Z) {
    for (let x = -3; x <= 3; x += 1) {
      for (let z = cz - 3; z <= cz + 3; z += 1) tiles[`${x},${z}`] = 'cobble'
    }
  }
  // Portal plaza: wider stone-look cobble fan at the end
  for (let x = -5; x <= 5; x += 1) {
    for (let z = PORTAL_FAN_Z - 3; z <= PORTAL_FAN_Z + 2; z += 1) tiles[`${x},${z}`] = 'stone'
  }
  return tiles
}

// ─═̷─═̷─ TEXT 3D (chapter headers, floating overhead) ─═̷─═̷─
function text3D(id, text, position, rotation, opts = {}) {
  return {
    id: `text3d-${id}`,
    type: 'text_3d',
    text,
    fontId: 'helvetiker_regular',
    size: opts.size ?? 0.95,
    depth: opts.depth ?? 0.32,
    color: opts.color ?? '#fef3c7',
    toneBias: opts.toneBias ?? -0.18,
    shininess: opts.shininess ?? 1,
    position,
    rotation: rotation ?? [0, 0, 0],
    createdAt: Date.parse(CREATED_AT) + (opts.tickOffset ?? 0),
  }
}

const text3dObjects = [
  text3D('ch1-hdr', 'AGENTS ARE GHOSTS', [0, 5.2, CHAPTER_Z[0] - 0.5], [0, 0, 0], { size: 1.15, color: '#cbd5e1', toneBias: -0.4, tickOffset: 1 }),
  text3D('ch2-hdr', 'THE NEW SKY', [0, 5.2, CHAPTER_Z[1] - 0.5], [0, 0, 0], { size: 1.25, color: '#fde047', tickOffset: 2 }),
  text3D('ch3-hdr', 'THE STACK', [0, 5.2, CHAPTER_Z[2] - 0.5], [0, 0, 0], { size: 1.3, color: '#a78bfa', tickOffset: 3 }),
  text3D('ch4-hdr', 'MCP IS THE BRIDGE', [0, 5.2, CHAPTER_Z[3] - 0.5], [0, 0, 0], { size: 1.2, color: '#22d3ee', tickOffset: 4 }),
  text3D('ch5-hdr', 'LAPTOP -> 100 PEOPLE', [0, 5.2, CHAPTER_Z[4] - 0.5], [0, 0, 0], { size: 1.1, color: '#f97316', tickOffset: 5 }),
  text3D('ch5-loc', '164,850 LOC . 500 FILES . ONE VIBEDEV', [0, 3.6, CHAPTER_Z[4] + 0.5], [0, 0, 0], { size: 0.42, color: '#fbbf24', toneBias: -0.1, tickOffset: 6 }),
  text3D('end-hdr', 'STEP IN', [0, 5.6, PORTAL_FAN_Z + 1], [0, 0, 0], { size: 1.6, color: '#ffffff', toneBias: 0.2, tickOffset: 7 }),
  text3D('spawn-hint', 'WALK FORWARD', [0, 3.2, 1.5], [0, 0, 0], { size: 0.42, color: '#94a3b8', toneBias: -0.5, tickOffset: 8 }),
]

// ─═̷─═̷─ CRAFTED SCENES (monuments composed of primitives) ─═̷─═̷─
const HALF_PI = Math.PI / 2

function craft(id, name, prompt, position, objects) {
  return { id, name, prompt, position, createdAt: CREATED_AT, model: 'codex-aitinkerers-intro-primitives', objects }
}

const craftedScenes = [
  // ═══ CHAPTER 1 — Agents Are Ghosts ═══
  // A translucent 2x2x2 glass cage with a captive glow-orb inside, dim particle dust
  craft(
    'ait-ch1-glass-cage',
    'Chapter 1 — Glass Cage of 2D',
    'translucent glass prison with captive agent ghost inside, melancholic',
    [0, 0, CHAPTER_Z[0]],
    [
      // The cage frame (4 edges)
      { type: 'box', position: [-1.1, 1.1, 0], scale: [0.06, 2.2, 0.06], color: '#94a3b8', metalness: 0.4, roughness: 0.5, emissive: '#1e293b', emissiveIntensity: 0.2 },
      { type: 'box', position: [1.1, 1.1, 0], scale: [0.06, 2.2, 0.06], color: '#94a3b8', metalness: 0.4, roughness: 0.5, emissive: '#1e293b', emissiveIntensity: 0.2 },
      { type: 'box', position: [0, 1.1, -1.1], scale: [0.06, 2.2, 0.06], color: '#94a3b8', metalness: 0.4, roughness: 0.5, emissive: '#1e293b', emissiveIntensity: 0.2 },
      { type: 'box', position: [0, 1.1, 1.1], scale: [0.06, 2.2, 0.06], color: '#94a3b8', metalness: 0.4, roughness: 0.5, emissive: '#1e293b', emissiveIntensity: 0.2 },
      // The translucent box itself
      { type: 'box', position: [0, 1.1, 0], scale: [2.2, 2.2, 2.2], color: '#cbd5e1', metalness: 0.1, roughness: 0.1, opacity: 0.18 },
      // The captive agent — a dim glowing orb pulsing inside
      { type: 'glow_orb', position: [0, 1.1, 0], scale: [0.55, 0.55, 0.55], color: '#60a5fa', color2: '#1e3a8a', intensity: 1.4, animation: { type: 'pulse', speed: 0.6, amplitude: 0.3 } },
      // Dim particle dust
      { type: 'particle_emitter', position: [0, 1.6, 0], scale: [1.8, 1.8, 1.8], color: '#cbd5e1', particleType: 'dust', particleCount: 60, intensity: 0.7 },
    ],
  ),

  // ═══ CHAPTER 2 — The New Sky ═══
  // An arch (cylinder + torus) + 3 small towers behind it, golden
  craft(
    'ait-ch2-arch',
    'Chapter 2 — Oasis Arch',
    'monumental archway promising a vast spatial world beyond',
    [0, 0, CHAPTER_Z[1]],
    [
      // Two pillars
      { type: 'cylinder', position: [-1.4, 1.4, 0], scale: [0.25, 2.8, 0.25], color: '#fde047', metalness: 0.5, roughness: 0.4, emissive: '#facc15', emissiveIntensity: 0.18 },
      { type: 'cylinder', position: [1.4, 1.4, 0], scale: [0.25, 2.8, 0.25], color: '#fde047', metalness: 0.5, roughness: 0.4, emissive: '#facc15', emissiveIntensity: 0.18 },
      // The arch on top (torus rotated to form a half-arch above)
      { type: 'torus', position: [0, 2.8, 0], scale: [1.65, 1.65, 0.14], rotation: [HALF_PI, 0, 0], color: '#fbbf24', metalness: 0.6, roughness: 0.3, emissive: '#f59e0b', emissiveIntensity: 0.3 },
      // Three distant spires behind
      { type: 'cone', position: [-2.2, 1.8, -1.6], scale: [0.5, 3.6, 0.5], color: '#fcd34d', metalness: 0.4, roughness: 0.5 },
      { type: 'cone', position: [0, 2.2, -2.2], scale: [0.55, 4.4, 0.55], color: '#fcd34d', metalness: 0.4, roughness: 0.5, emissive: '#f59e0b', emissiveIntensity: 0.15 },
      { type: 'cone', position: [2.2, 1.8, -1.6], scale: [0.5, 3.6, 0.5], color: '#fcd34d', metalness: 0.4, roughness: 0.5 },
      // A small floating sun-disc
      { type: 'sphere', position: [0, 4.4, -2.6], scale: [0.55, 0.55, 0.55], color: '#fff7ed', emissive: '#fbbf24', emissiveIntensity: 0.9, animation: { type: 'bob', speed: 0.4, amplitude: 0.18 } },
    ],
  ),

  // ═══ CHAPTER 3 — The Stack ═══
  // 5 monoliths in a row, each labeled with stack pillar
  craft(
    'ait-ch3-monoliths',
    'Chapter 3 — The Stack',
    'five monolithic pillars representing the tech stack',
    [0, 0, CHAPTER_Z[2]],
    [
      // 5 pillars arrayed at x = -2.4, -1.2, 0, 1.2, 2.4
      // 1. Three.js / R3F — obsidian black with cyan wireframe halo
      { type: 'box', position: [-2.4, 1.4, 0], scale: [0.7, 2.8, 0.7], color: '#0f172a', metalness: 0.7, roughness: 0.3, emissive: '#22d3ee', emissiveIntensity: 0.12 },
      { type: 'text', position: [-2.4, 3.05, 0.36], scale: [1, 1, 1], color: '#67e8f9', fontSize: 0.22, anchorX: 'center', anchorY: 'middle', text: 'R3F\nthree.js', emissive: '#22d3ee', emissiveIntensity: 0.5 },
      // 2. Next.js — silver
      { type: 'box', position: [-1.2, 1.4, 0], scale: [0.7, 2.8, 0.7], color: '#e5e7eb', metalness: 0.85, roughness: 0.2 },
      { type: 'text', position: [-1.2, 3.05, 0.36], scale: [1, 1, 1], color: '#0f172a', fontSize: 0.25, anchorX: 'center', anchorY: 'middle', text: 'NEXT 14' },
      // 3. Colyseus — translucent cyan crystal
      { type: 'crystal', position: [0, 1.6, 0], scale: [0.6, 1.5, 0.6], color: '#22d3ee', color2: '#0ea5e9', intensity: 1.2 },
      { type: 'text', position: [0, 3.4, 0.36], scale: [1, 1, 1], color: '#cffafe', fontSize: 0.22, anchorX: 'center', anchorY: 'middle', text: 'COLYSEUS\nrooms', emissive: '#06b6d4', emissiveIntensity: 0.4 },
      // 4. Prisma + SQLite — dark stone with a single river of glow down the face
      { type: 'box', position: [1.2, 1.4, 0], scale: [0.7, 2.8, 0.7], color: '#1e293b', metalness: 0.3, roughness: 0.6 },
      { type: 'box', position: [1.2, 1.4, 0.36], scale: [0.06, 2.6, 0.02], color: '#7c3aed', emissive: '#a78bfa', emissiveIntensity: 1.2 },
      { type: 'text', position: [1.2, 3.05, 0.4], scale: [1, 1, 1], color: '#ddd6fe', fontSize: 0.2, anchorX: 'center', anchorY: 'middle', text: 'PRISMA\nSQLite' },
      // 5. WebGL→WebGPU — copper + platinum split
      { type: 'box', position: [2.16, 1.4, 0], scale: [0.34, 2.8, 0.7], color: '#b45309', metalness: 0.75, roughness: 0.35 },
      { type: 'box', position: [2.55, 1.4, 0], scale: [0.34, 2.8, 0.7], color: '#e2e8f0', metalness: 0.95, roughness: 0.15 },
      { type: 'text', position: [2.36, 3.05, 0.36], scale: [1, 1, 1], color: '#facc15', fontSize: 0.18, anchorX: 'center', anchorY: 'middle', text: 'WebGL\n->WebGPU' },
      // Floating particle wisps over the pillars
      { type: 'particle_emitter', position: [0, 3.8, 0], scale: [4.5, 0.6, 1.0], color: '#22d3ee', particleType: 'firefly', particleCount: 40, intensity: 0.85 },
    ],
  ),

  // ═══ CHAPTER 4 — MCP Is The Bridge ═══
  // Left cluster: 3 code-harness towers. Right cluster: 3 in-world-agent shrines.
  // A central glowing beam (the "MCP bridge") connects the two sides.
  craft(
    'ait-ch4-agents',
    'Chapter 4 — Agent Layer',
    'left tower cluster (coding harnesses) and right shrine cluster (in-world agents) bridged by glowing MCP beam',
    [0, 0, CHAPTER_Z[3]],
    [
      // === LEFT — Coding harnesses (x = -3.2, -2.0, -2.6 z offset) ===
      // Claude Code
      { type: 'cylinder', position: [-3.2, 1.0, 1.2], scale: [0.42, 2.0, 0.42], color: '#1e1b4b', metalness: 0.6, roughness: 0.4, emissive: '#7c3aed', emissiveIntensity: 0.35 },
      { type: 'sphere', position: [-3.2, 2.3, 1.2], scale: [0.45, 0.45, 0.45], color: '#a78bfa', emissive: '#7c3aed', emissiveIntensity: 0.7, animation: { type: 'rotate', speed: 0.4, axis: 'y' } },
      { type: 'text', position: [-3.2, 2.95, 1.2], scale: [1, 1, 1], color: '#ddd6fe', fontSize: 0.18, anchorX: 'center', anchorY: 'middle', text: 'CLAUDE\nCODE' },
      // Codex
      { type: 'cylinder', position: [-2.0, 0.95, 0], scale: [0.4, 1.9, 0.4], color: '#0f172a', metalness: 0.5, roughness: 0.5, emissive: '#0ea5e9', emissiveIntensity: 0.3 },
      { type: 'sphere', position: [-2.0, 2.15, 0], scale: [0.42, 0.42, 0.42], color: '#38bdf8', emissive: '#0284c7', emissiveIntensity: 0.6, animation: { type: 'rotate', speed: 0.5, axis: 'y' } },
      { type: 'text', position: [-2.0, 2.75, 0], scale: [1, 1, 1], color: '#bae6fd', fontSize: 0.18, anchorX: 'center', anchorY: 'middle', text: 'CODEX' },
      // Anorak Pro
      { type: 'cylinder', position: [-3.2, 1.0, -1.2], scale: [0.42, 2.0, 0.42], color: '#3f1d2e', metalness: 0.6, roughness: 0.4, emissive: '#ec4899', emissiveIntensity: 0.32 },
      { type: 'sphere', position: [-3.2, 2.3, -1.2], scale: [0.45, 0.45, 0.45], color: '#f472b6', emissive: '#db2777', emissiveIntensity: 0.65, animation: { type: 'rotate', speed: 0.45, axis: 'y' } },
      { type: 'text', position: [-3.2, 2.95, -1.2], scale: [1, 1, 1], color: '#fbcfe8', fontSize: 0.18, anchorX: 'center', anchorY: 'middle', text: 'ANORAK\nPRO' },

      // === RIGHT — In-world agents ===
      // Hermes
      { type: 'box', position: [3.2, 1.1, 1.2], scale: [0.55, 2.2, 0.55], color: '#365314', metalness: 0.3, roughness: 0.6, emissive: '#84cc16', emissiveIntensity: 0.3 },
      { type: 'cone', position: [3.2, 2.55, 1.2], scale: [0.4, 0.6, 0.4], color: '#a3e635', emissive: '#84cc16', emissiveIntensity: 0.55 },
      { type: 'text', position: [3.2, 3.15, 1.2], scale: [1, 1, 1], color: '#ecfccb', fontSize: 0.18, anchorX: 'center', anchorY: 'middle', text: 'HERMES' },
      // OpenClaw
      { type: 'box', position: [2.0, 1.05, 0], scale: [0.55, 2.1, 0.55], color: '#7f1d1d', metalness: 0.4, roughness: 0.5, emissive: '#dc2626', emissiveIntensity: 0.4 },
      { type: 'torus', position: [2.0, 2.4, 0], scale: [0.42, 0.42, 0.08], rotation: [HALF_PI, 0, 0], color: '#ef4444', emissive: '#dc2626', emissiveIntensity: 0.6, animation: { type: 'rotate', speed: 0.6, axis: 'y' } },
      { type: 'text', position: [2.0, 3.0, 0], scale: [1, 1, 1], color: '#fecaca', fontSize: 0.18, anchorX: 'center', anchorY: 'middle', text: 'OPEN\nCLAW' },
      // Merlin
      { type: 'box', position: [3.2, 1.1, -1.2], scale: [0.55, 2.2, 0.55], color: '#1e3a8a', metalness: 0.4, roughness: 0.5, emissive: '#3b82f6', emissiveIntensity: 0.35 },
      { type: 'crystal', position: [3.2, 2.55, -1.2], scale: [0.32, 0.6, 0.32], color: '#60a5fa', color2: '#1d4ed8', intensity: 1.5 },
      { type: 'text', position: [3.2, 3.25, -1.2], scale: [1, 1, 1], color: '#dbeafe', fontSize: 0.18, anchorX: 'center', anchorY: 'middle', text: 'MERLIN' },

      // === CENTER — MCP bridge beam connecting left & right ===
      { type: 'cylinder', position: [0, 1.8, 0], scale: [0.12, 5.6, 0.12], rotation: [0, 0, HALF_PI], color: '#22d3ee', emissive: '#06b6d4', emissiveIntensity: 1.4 },
      { type: 'text', position: [0, 2.5, 0], scale: [1, 1, 1], color: '#cffafe', fontSize: 0.32, anchorX: 'center', anchorY: 'middle', text: 'MCP', emissive: '#06b6d4', emissiveIntensity: 0.6 },
      { type: 'particle_emitter', position: [0, 1.8, 0], scale: [5.0, 0.3, 0.3], color: '#22d3ee', particleType: 'spark', particleCount: 80, intensity: 1.0, speed: 1.5 },
    ],
  ),

  // ═══ CHAPTER 5 — Laptop → 100 People ═══
  // GitHub-as-bridge: two mountainous platforms (Ashburn west, Nuremberg east)
  // connected by a glowing cathedral beam. A small laptop-cube in the foreground.
  craft(
    'ait-ch5-bridge',
    'Chapter 5 — Local <-> GitHub <-> Hosted',
    'two datacenter mounds bridged by a glowing GitHub beam, tiny laptop in the foreground',
    [0, 0, CHAPTER_Z[4]],
    [
      // West mound (Ashburn — your hosted Hetzner box)
      { type: 'cone', position: [-3.2, 1.1, -0.6], scale: [1.6, 2.2, 1.6], color: '#475569', metalness: 0.2, roughness: 0.85 },
      { type: 'box', position: [-3.2, 2.4, -0.6], scale: [0.5, 0.6, 0.5], color: '#0ea5e9', emissive: '#0284c7', emissiveIntensity: 0.6 },
      { type: 'text', position: [-3.2, 3.05, -0.3], scale: [1, 1, 1], color: '#bae6fd', fontSize: 0.18, anchorX: 'center', anchorY: 'middle', text: 'ASHBURN\n04515.xyz' },
      // East mound (Nuremberg — your dev/EU box)
      { type: 'cone', position: [3.2, 1.1, -0.6], scale: [1.6, 2.2, 1.6], color: '#475569', metalness: 0.2, roughness: 0.85 },
      { type: 'box', position: [3.2, 2.4, -0.6], scale: [0.5, 0.6, 0.5], color: '#fde047', emissive: '#facc15', emissiveIntensity: 0.6 },
      { type: 'text', position: [3.2, 3.05, -0.3], scale: [1, 1, 1], color: '#fef9c3', fontSize: 0.18, anchorX: 'center', anchorY: 'middle', text: 'NUREMBERG\ndev mirror' },
      // Bridge: thick glowing cylinder
      { type: 'cylinder', position: [0, 2.5, -0.6], scale: [0.2, 6.0, 0.2], rotation: [0, 0, HALF_PI], color: '#1f2937', metalness: 0.6, roughness: 0.4, emissive: '#22c55e', emissiveIntensity: 0.4 },
      // GitHub-as-temple in the center on top of the bridge
      { type: 'cylinder', position: [0, 3.2, -0.6], scale: [0.55, 0.5, 0.55], color: '#0f172a', metalness: 0.7, roughness: 0.3, emissive: '#22c55e', emissiveIntensity: 0.3 },
      { type: 'text', position: [0, 3.85, -0.3], scale: [1, 1, 1], color: '#bbf7d0', fontSize: 0.22, anchorX: 'center', anchorY: 'middle', text: 'GITHUB' },
      // Tiny laptop in the foreground (a flat box with raised screen)
      { type: 'box', position: [0, 0.18, 1.6], scale: [0.7, 0.05, 0.5], color: '#1f2937', metalness: 0.8, roughness: 0.2 },
      { type: 'box', position: [0, 0.45, 1.4], scale: [0.7, 0.5, 0.04], color: '#0f172a', metalness: 0.8, roughness: 0.2, emissive: '#67e8f9', emissiveIntensity: 0.6 },
      { type: 'text', position: [0, 0.45, 1.36], scale: [1, 1, 1], color: '#67e8f9', fontSize: 0.07, anchorX: 'center', anchorY: 'middle', text: 'YOU' },
      // Particles climbing the bridge
      { type: 'particle_emitter', position: [0, 2.5, -0.6], scale: [5.5, 0.4, 0.4], color: '#22c55e', particleType: 'firefly', particleCount: 60, intensity: 1.0, speed: 1.2 },
    ],
  ),
]

// ─═̷─═̷─ LIGHTS ─═̷─═̷─
const lights = [
  { id: 'ait-ambient', type: 'ambient', color: '#fff7ed', intensity: 0.38 },
  { id: 'ait-sun', type: 'directional', position: [-12, 14, 6], target: [0, 0, -30], color: '#fffbeb', intensity: 1.05 },
  // Warm point light over each chapter station
  { id: 'ait-ch1-glow', type: 'point', position: [0, 3.2, CHAPTER_Z[0]], color: '#60a5fa', intensity: 1.2, distance: 12 },
  { id: 'ait-ch2-glow', type: 'point', position: [0, 3.8, CHAPTER_Z[1]], color: '#fbbf24', intensity: 1.6, distance: 14 },
  { id: 'ait-ch3-glow', type: 'point', position: [0, 4.4, CHAPTER_Z[2]], color: '#a78bfa', intensity: 1.4, distance: 16 },
  { id: 'ait-ch4-glow', type: 'point', position: [0, 3.6, CHAPTER_Z[3]], color: '#22d3ee', intensity: 1.6, distance: 16 },
  { id: 'ait-ch5-glow', type: 'point', position: [0, 4.0, CHAPTER_Z[4]], color: '#22c55e', intensity: 1.5, distance: 18 },
  // Portal plaza glow
  { id: 'ait-portal-glow', type: 'point', position: [0, 4.0, PORTAL_FAN_Z], color: '#ffffff', intensity: 1.8, distance: 16 },
]

// ─═̷─═̷─ PORTAL FAN AT THE END ─═̷─═̷─
const portalGates = [
  // CENTER: Portal Zero
  {
    id: 'ait-portal-portal-zero',
    label: 'PORTAL ZERO',
    variant: 'stargate-vortex',
    position: [0, 0, PORTAL_FAN_Z],
    rotationY: 0,
    scale: 1.05,
    width: 2.8,
    height: 3.6,
    direction: 'one-way',
    sourceWorldId: WORLD_ID,
    targetWorldId: 'world-welcome-hub-system',
    targetWorldName: 'Portal Zero',
    action: { type: 'load_world', worldId: 'world-welcome-hub-system', worldName: 'Portal Zero' },
  },
  // LEFT: Conjure Arena (external)
  {
    id: 'ait-portal-conjure',
    label: 'CONJURE ARENA',
    variant: 'solar-arch',
    position: [-4.4, 0, PORTAL_FAN_Z + 0.6],
    rotationY: Math.PI / 8,
    scale: 0.95,
    width: 2.5,
    height: 3.4,
    direction: 'one-way',
    sourceWorldId: WORLD_ID,
    action: {
      type: 'external_url',
      url: 'https://conjure.04515.xyz',
      label: 'Conjure Arena',
      returnUrl: 'https://04515.xyz',
      requiresConfirm: false,
    },
  },
  // RIGHT: Demo Router (shortcode /ai → sharded FFA)
  {
    id: 'ait-portal-demo-router',
    label: 'DEMO ROUTER',
    variant: 'threshold-ring',
    position: [4.4, 0, PORTAL_FAN_Z + 0.6],
    rotationY: -Math.PI / 8,
    scale: 0.95,
    width: 2.5,
    height: 3.4,
    direction: 'one-way',
    sourceWorldId: WORLD_ID,
    action: {
      type: 'external_url',
      url: '/ai',
      label: 'Demo Router',
      returnUrl: 'current',
      requiresConfirm: false,
    },
  },
]

// ─═̷─═̷─ ASSEMBLE WORLD STATE ─═̷─═̷─
const worldData = {
  version: 1,
  terrain: null,
  terrainHeights: Array(101 * 101).fill(0),
  groundPresetId: 'grass',
  groundTiles: buildGroundTiles(),
  craftedScenes,
  conjuredAssetIds: [],
  catalogPlacements: [],
  portalGates,
  spatialWebObjects: [],
  paintStrokes: [],
  text3dObjects,
  transforms: {},
  behaviors: {},
  lights,
  skyBackgroundId: 'belfast_sunset',
  agentWindows: [],
  agentAvatars: [],
  savedAt: SAVED_AT,
}

const seed = {
  seedVersion: 1,
  slug: 'aitinkerers-bogota-intro',
  id: WORLD_ID,
  userId: OWNER,
  name: 'AI Tinkerers Bogota Intro',
  icon: 'AI',
  visibility: 'public',
  pvpEnabled: false,
  creatorName: 'The Oasis',
  creatorAvatar: null,
  thumbnailUrl: null,
  data: worldData,
}

writeFileSync(OUT_PATH, JSON.stringify(seed, null, 2) + '\n', 'utf8')
console.log(`[generate-aitinkerers-intro-seed] wrote ${OUT_PATH}`)
console.log(`  craftedScenes=${craftedScenes.length} text3d=${text3dObjects.length} lights=${lights.length} portals=${portalGates.length} tiles=${Object.keys(worldData.groundTiles).length}`)
