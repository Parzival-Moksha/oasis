// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TERRAIN GENERATOR — From noise to mountains, from math to Middle-earth
// ─═̷─═̷─ॐ─═̷─═̷─ The land remembers what the wind cannot ─═̷─═̷─ॐ─═̷─═̷─
// Simplex noise → heightmap → vertex colors → living terrain
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { createNoise2D } from 'simplex-noise'

// ═══════════════════════════════════════════════════════════════════════════════
// TERRAIN PARAMS — What the LLM generates, what the land becomes
// ═══════════════════════════════════════════════════════════════════════════════

export interface TerrainPalette {
  deepWater: string
  shallowWater: string
  sand: string
  grass: string
  forest: string
  rock: string
  snow: string
}

export interface TerrainParams {
  name: string
  size: number                // world units (meters)
  resolution: number          // vertices per side (64-256)
  heightScale: number         // max height amplitude
  noiseOctaves: number        // detail layers (1-8)
  noisePersistence: number    // amplitude falloff per octave (0-1)
  noiseLacunarity: number     // frequency multiplier per octave
  noiseScale: number          // base frequency
  seed: number                // reproducible worlds
  waterLevel: number          // 0-1 normalized height for water plane
  palette: TerrainPalette
  features: string[]          // descriptive tags (for future use)
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULTS — A gentle green world if the LLM gives us nothing
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_TERRAIN: TerrainParams = {
  name: 'Genesis',
  size: 64,
  resolution: 128,
  heightScale: 6,
  noiseOctaves: 5,
  noisePersistence: 0.45,
  noiseLacunarity: 2.1,
  noiseScale: 0.025,
  seed: 42,
  waterLevel: 0.25,
  palette: {
    deepWater: '#1a3a5c',
    shallowWater: '#2980b9',
    sand: '#e8d68c',
    grass: '#4a7c2e',
    forest: '#2d5a1e',
    rock: '#6b6b6b',
    snow: '#f0f0f0',
  },
  features: [],
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEIGHTMAP GENERATION — Stacked octaves of simplex noise
// ═══════════════════════════════════════════════════════════════════════════════

export interface TerrainData {
  heights: Float32Array     // resolution * resolution heightmap (0-1 normalized)
  colors: Float32Array      // resolution * resolution * 3 RGB vertex colors
  normals: Float32Array     // resolution * resolution * 3 normals for lighting
  params: TerrainParams
}

/** Seed-based noise factory */
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** Generate heightmap from terrain params */
export function generateTerrain(params: TerrainParams): TerrainData {
  const { resolution, noiseOctaves, noisePersistence, noiseLacunarity, noiseScale, seed } = params
  const rng = seededRandom(seed)

  // Create noise with deterministic seed
  const noise2D = createNoise2D(rng)

  const count = resolution * resolution
  const heights = new Float32Array(count)
  const colors = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)

  // ── Pass 1: Generate raw heights ──
  let minH = Infinity, maxH = -Infinity
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const i = z * resolution + x

      let amplitude = 1
      let frequency = noiseScale
      let height = 0
      let maxAmp = 0

      for (let o = 0; o < noiseOctaves; o++) {
        height += noise2D(x * frequency, z * frequency) * amplitude
        maxAmp += amplitude
        amplitude *= noisePersistence
        frequency *= noiseLacunarity
      }

      // Normalize to -1..1 then shift to 0..1
      height = (height / maxAmp + 1) / 2
      heights[i] = height
      if (height < minH) minH = height
      if (height > maxH) maxH = height
    }
  }

  // ── Pass 2: Normalize to 0..1 range ──
  const range = maxH - minH || 1
  for (let i = 0; i < count; i++) {
    heights[i] = (heights[i] - minH) / range
  }

  // ── Pass 3: Compute vertex colors with smooth biome blending ──
  // Pre-parse palette once (not per vertex)
  const pal = {
    deepWater: hexToRgb(params.palette.deepWater),
    shallowWater: hexToRgb(params.palette.shallowWater),
    sand: hexToRgb(params.palette.sand),
    grass: hexToRgb(params.palette.grass),
    forest: hexToRgb(params.palette.forest),
    rock: hexToRgb(params.palette.rock),
    snow: hexToRgb(params.palette.snow),
  }
  const wl = params.waterLevel

  // Create a secondary detail noise for micro-variation within biomes
  const detailNoise = createNoise2D(seededRandom(seed + 777))

  for (let i = 0; i < count; i++) {
    const h = heights[i]
    const x = i % resolution
    const z = Math.floor(i / resolution)

    // ── Slope: steep faces → rock regardless of height ──
    // Use the normal's Y component: flat=1.0, cliff=0.0
    // (normals computed in pass 4, but we need slope NOW — compute inline)
    const hL = heights[z * resolution + Math.max(0, x - 1)]
    const hR = heights[z * resolution + Math.min(resolution - 1, x + 1)]
    const hU = heights[Math.max(0, z - 1) * resolution + x]
    const hD = heights[Math.min(resolution - 1, z + 1) * resolution + x]
    const dx = (hR - hL) * params.heightScale
    const dz = (hD - hU) * params.heightScale
    const slope = Math.sqrt(dx * dx + dz * dz)  // gradient magnitude
    const slopeFactor = smoothstep(0.8, 2.5, slope)  // 0=flat, 1=cliff

    // ── Micro-detail noise: breaks up uniform color bands ──
    const detail = detailNoise(x * 0.15, z * 0.15) * 0.06  // subtle +-6% variation
    const hd = Math.max(0, Math.min(1, h + detail))

    // ── Height-based biome blending (smooth transitions) ──
    let color: [number, number, number]

    // Define biome boundaries relative to water level
    const sandTop = wl + 0.06
    const grassTop = wl + 0.35
    const forestTop = wl + 0.55
    const rockTop = 0.88

    if (hd < wl * 0.6) {
      // Deep water
      color = pal.deepWater
    } else if (hd < wl) {
      // Deep → shallow water blend
      const t = smoothstep(wl * 0.6, wl, hd)
      color = lerpColor(pal.deepWater, pal.shallowWater, t)
    } else if (hd < sandTop) {
      // Shallow water → sand
      const t = smoothstep(wl, sandTop, hd)
      color = lerpColor(pal.shallowWater, pal.sand, t)
    } else if (hd < wl + 0.12) {
      // Sand → grass transition
      const t = smoothstep(sandTop, wl + 0.12, hd)
      color = lerpColor(pal.sand, pal.grass, t)
    } else if (hd < grassTop) {
      // Grass zone (with subtle variation toward forest)
      const t = smoothstep(wl + 0.12, grassTop, hd) * 0.3
      color = lerpColor(pal.grass, pal.forest, t)
    } else if (hd < forestTop) {
      // Grass → forest
      const t = smoothstep(grassTop, forestTop, hd)
      color = lerpColor(pal.grass, pal.forest, t)
    } else if (hd < rockTop) {
      // Forest → rock
      const t = smoothstep(forestTop, rockTop, hd)
      color = lerpColor(pal.forest, pal.rock, t)
    } else {
      // Rock → snow
      const t = smoothstep(rockTop, 0.95, hd)
      color = lerpColor(pal.rock, pal.snow, t)
    }

    // ── Mix in rock based on slope (cliffs are always rocky) ──
    if (slopeFactor > 0 && hd > wl) {
      color = lerpColor(color, pal.rock, slopeFactor * 0.85)
    }

    // ── Subtle brightness variation (dappled light effect) ──
    const dapple = 1.0 + detailNoise(x * 0.08, z * 0.08) * 0.08
    colors[i * 3] = Math.min(1, color[0] * dapple)
    colors[i * 3 + 1] = Math.min(1, color[1] * dapple)
    colors[i * 3 + 2] = Math.min(1, color[2] * dapple)
  }

  // ── Pass 4: Compute normals from heightmap ──
  const hs = params.heightScale
  const cellSize = params.size / (resolution - 1)
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const i = z * resolution + x

      // Sample neighboring heights for cross product
      const hL = heights[z * resolution + Math.max(0, x - 1)] * hs
      const hR = heights[z * resolution + Math.min(resolution - 1, x + 1)] * hs
      const hU = heights[Math.max(0, z - 1) * resolution + x] * hs
      const hD = heights[Math.min(resolution - 1, z + 1) * resolution + x] * hs

      // Finite difference normal
      const nx = hL - hR
      const nz = hU - hD
      const ny = 2 * cellSize
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1

      normals[i * 3] = nx / len
      normals[i * 3 + 1] = ny / len
      normals[i * 3 + 2] = nz / len
    }
  }

  return { heights, colors, normals, params }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ]
}

/** GLSL-style smoothstep: 0 below edge0, 1 above edge1, smooth curve between */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Linearly interpolate between two RGB colors */
function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

// ▓▓▓▓【T̸E̸R̸R̸A̸I̸N̸】▓▓▓▓ॐ▓▓▓▓【G̸E̸N̸E̸S̸I̸S̸】▓▓▓▓
