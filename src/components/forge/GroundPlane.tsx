// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// GROUND PLANE — The living earth beneath every Forge world
// ─═̷─═̷─🌍─═̷─═̷─ Tile-based painting + PBR textures from Poly Haven ─═̷─═̷─🌍─═̷─═̷─
//
// Architecture:
//   Base layer: full 100x100m plane with default preset texture (or void)
//   Painted tiles: one InstancedMesh per unique preset (batched rendering)
//   Paint mode: grid overlay + click plane + brush preview
//
// Each tile = 1m x 1m. World bounds: -50 to +49 on X/Z axes.
// Sparse storage: only painted tiles exist in state.
//
// ░▒▓ TEXTURE SHARING PROTOCOL ▓▒░
// Tile textures are loaded ONCE and shared (not cloned). Repeat is (1,1) for
// all tile instances. BaseGround needs different repeat, so it clones + sets
// needsUpdate=true to force GPU re-upload.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useMemo, useEffect, useState, useCallback, useRef, useContext } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { type GroundPreset, GROUND_PRESETS, getTextureUrls } from '../../lib/forge/ground-textures'
import {
  TERRAIN_GRID_SEGMENTS,
  hasTerrainRelief,
  normalizeTerrainHeights,
  sampleTerrainHeightAt,
  terrainVertexIndex,
} from '../../lib/forge/terrain-brush'
import { useOasisStore } from '../../store/oasisStore'
import { DragContext } from '../scene-lib/contexts'

const GROUND_SIZE = 100
const TILE_SIZE = 1
const HALF_GROUND_SIZE = GROUND_SIZE / 2
const TILE_RELIEF_OFFSET = 0.012
// Max tiles per preset group — covers full 100×100 world (10,000 tiles)
const MAX_TILES_PER_GROUP = 10000
const DEFAULT_CUSTOM_FULL_GROUND_REPEAT = 24

function textureUrlsForPreset(preset: GroundPreset): { diffuse: string } | null {
  if (preset.customTextureUrl) return { diffuse: preset.customTextureUrl }
  if (preset.assetName) return getTextureUrls(preset.assetName)
  return null
}

function fullGroundRepeatForPreset(preset: GroundPreset): number {
  const repeat = Number.isFinite(preset.tileRepeat) && preset.tileRepeat > 0 ? preset.tileRepeat : 1
  return preset.customTextureUrl && repeat <= 4 ? DEFAULT_CUSTOM_FULL_GROUND_REPEAT : repeat
}

function clampGridIndex(value: number): number {
  return Math.max(0, Math.min(TERRAIN_GRID_SEGMENTS, value))
}

function pushUpwardQuad(indices: number[], a: number, b: number, c: number, d: number) {
  indices.push(a, c, b, a, d, c)
}

function buildReliefGroundGeometry(heights: number[]): THREE.BufferGeometry {
  const normalized = normalizeTerrainHeights(heights)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let iz = 0; iz <= TERRAIN_GRID_SEGMENTS; iz++) {
    for (let ix = 0; ix <= TERRAIN_GRID_SEGMENTS; ix++) {
      const height = normalized[terrainVertexIndex(ix, iz)] || 0
      positions.push(ix - HALF_GROUND_SIZE, height, iz - HALF_GROUND_SIZE)
      uvs.push(ix / TERRAIN_GRID_SEGMENTS, iz / TERRAIN_GRID_SEGMENTS)
    }
  }

  for (let iz = 0; iz < TERRAIN_GRID_SEGMENTS; iz++) {
    for (let ix = 0; ix < TERRAIN_GRID_SEGMENTS; ix++) {
      const a = terrainVertexIndex(ix, iz)
      const b = terrainVertexIndex(ix + 1, iz)
      const d = terrainVertexIndex(ix, iz + 1)
      const c = terrainVertexIndex(ix + 1, iz + 1)
      pushUpwardQuad(indices, a, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function buildReliefTileGeometry(tiles: [number, number][], heights: number[], stretch = 1): THREE.BufferGeometry {
  const normalized = normalizeTerrainHeights(heights)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const cellSize = Math.max(1, Math.floor(stretch || 1)) * TILE_SIZE

  for (const [x, z] of tiles) {
    const minX = clampGridIndex(x + HALF_GROUND_SIZE)
    const minZ = clampGridIndex(z + HALF_GROUND_SIZE)
    const maxX = clampGridIndex(x + cellSize + HALF_GROUND_SIZE)
    const maxZ = clampGridIndex(z + cellSize + HALF_GROUND_SIZE)
    const base = positions.length / 3
    const x0 = minX - HALF_GROUND_SIZE
    const x1 = maxX - HALF_GROUND_SIZE
    const z0 = minZ - HALF_GROUND_SIZE
    const z1 = maxZ - HALF_GROUND_SIZE
    const h00 = (normalized[terrainVertexIndex(minX, minZ)] || 0) + TILE_RELIEF_OFFSET
    const h10 = (normalized[terrainVertexIndex(maxX, minZ)] || 0) + TILE_RELIEF_OFFSET
    const h11 = (normalized[terrainVertexIndex(maxX, maxZ)] || 0) + TILE_RELIEF_OFFSET
    const h01 = (normalized[terrainVertexIndex(minX, maxZ)] || 0) + TILE_RELIEF_OFFSET

    positions.push(
      x0, h00, z0,
      x1, h10, z0,
      x1, h11, z1,
      x0, h01, z1,
    )
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
    pushUpwardQuad(indices, base, base + 1, base + 2, base + 3)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

// ░▒▓ PLACEHOLDER TEXTURE — 1x1 grey pixel, lazy-initialized (SSR-safe) ▓▒░
// Forces GPU shader to compile WITH texture sampler from the start.
// Without this, InstancedMesh material compiled with map=null gets a shader
// WITHOUT a texture sampler. When the real texture arrives, needsUpdate=true
// triggers recompilation, but InstancedMesh shader recompilation is unreliable
// in Three.js — the sampler slot stays empty → white tiles forever.
let _placeholderTex: THREE.Texture | null = null
function getPlaceholderTexture(): THREE.Texture {
  if (!_placeholderTex) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#888888'
    ctx.fillRect(0, 0, 1, 1)
    _placeholderTex = new THREE.CanvasTexture(canvas)
    _placeholderTex.colorSpace = THREE.SRGBColorSpace
  }
  return _placeholderTex
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXTURE CACHE — Load once from Poly Haven CDN, share everywhere
// ═══════════════════════════════════════════════════════════════════════════════

const textureCache = new Map<string, THREE.Texture>()
/** URLs that permanently failed after all retries — don't keep hammering */
const failedUrls = new Set<string>()

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 800 // doubles each attempt: 800 → 1600 → 3200

function loadTextureOnce(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, resolve, undefined, () => resolve(null))
  })
}

async function loadCachedTexture(url: string, colorSpace: THREE.ColorSpace): Promise<THREE.Texture | null> {
  const cached = textureCache.get(url)
  if (cached) return cached
  if (failedUrls.has(url)) return null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt - 1)))
    }
    const tex = await loadTextureOnce(url)
    if (tex) {
      tex.colorSpace = colorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      textureCache.set(url, tex)
      return tex
    }
  }
  // All retries exhausted — mark as permanently failed
  console.warn(`[GroundTexture] Failed after ${MAX_RETRIES} attempts: ${url}`)
  failedUrls.add(url)
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// BASE GROUND — The default texture, full 100x100m plane
// ░▒▓ Shows on unpainted tiles (skipped when preset = 'none') ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function BaseGround({ preset }: { preset: GroundPreset }) {
  const gl = useThree(s => s.gl)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  const urls = useMemo(() => textureUrlsForPreset(preset), [preset.assetName, preset.customTextureUrl])
  const tileRepeat = fullGroundRepeatForPreset(preset)
  const [diffuse, setDiffuse] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    let cancelled = false
    let activeClone: THREE.Texture | null = null

    if (!urls) {
      setDiffuse(null)
      return () => { cancelled = true }
    }

    // BaseGround needs tiled repeat, so we clone + force GPU re-upload
    loadCachedTexture(urls.diffuse, THREE.SRGBColorSpace).then(tex => {
      if (!cancelled && tex) {
        const clone = tex.clone()
        clone.repeat.set(tileRepeat, tileRepeat)
        clone.needsUpdate = true
        // Force synchronous GPU upload BEFORE React re-render.
        // Without this, setDiffuse triggers render with map=clone + color=#ffffff,
        // but the texture isn't in VRAM yet → white frame for 1-3 draws.
        gl.initTexture(clone)
        activeClone = clone
        setDiffuse(clone)
      }
    })

    return () => { cancelled = true; activeClone?.dispose() }
  }, [urls, tileRepeat, gl])

  useEffect(() => {
    const mat = matRef.current
    if (!mat) return
    if (diffuse) {
      mat.map = diffuse
      mat.color.set('#ffffff')
    } else {
      mat.map = getPlaceholderTexture()
      mat.color.set(preset.color)
    }
    mat.needsUpdate = true
  }, [diffuse, preset.color])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
      <meshStandardMaterial
        ref={matRef}
        color={preset.color}
        map={getPlaceholderTexture()}
        roughness={1}
        metalness={0}
        envMapIntensity={0.15}
        toneMapped
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TILE GROUP RENDERER — InstancedMesh for all tiles of one preset
// ░▒▓ One draw call per texture group — 500 grass tiles = 1 draw call ▓▒░
//
// KEY DESIGN: Stable mount. We allocate MAX_TILES_PER_GROUP instances once,
// then update `mesh.count` + instance matrices when tiles change.
// Texture is loaded once and SHARED (not cloned) — repeat (1,1) is default.
// No remount on tile count change = no white flash, no texture reload.
// ═══════════════════════════════════════════════════════════════════════════════

function ReliefGround({ preset, heights }: { preset: GroundPreset; heights: number[] }) {
  const gl = useThree(s => s.gl)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  const urls = useMemo(() => textureUrlsForPreset(preset), [preset.assetName, preset.customTextureUrl])
  const tileRepeat = fullGroundRepeatForPreset(preset)
  const [diffuse, setDiffuse] = useState<THREE.Texture | null>(null)

  const geometry = useMemo(() => buildReliefGroundGeometry(heights), [heights])

  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    let cancelled = false
    let activeClone: THREE.Texture | null = null

    if (!urls) {
      setDiffuse(null)
      return () => { cancelled = true }
    }

    loadCachedTexture(urls.diffuse, THREE.SRGBColorSpace).then(tex => {
      if (!cancelled && tex) {
        const clone = tex.clone()
        clone.repeat.set(tileRepeat, tileRepeat)
        clone.needsUpdate = true
        gl.initTexture(clone)
        activeClone = clone
        setDiffuse(clone)
      }
    })

    return () => { cancelled = true; activeClone?.dispose() }
  }, [urls, tileRepeat, gl])

  useEffect(() => {
    const mat = matRef.current
    if (!mat) return
    if (diffuse) {
      mat.map = diffuse
      mat.color.set('#ffffff')
    } else {
      mat.map = getPlaceholderTexture()
      mat.color.set(preset.color)
    }
    mat.needsUpdate = true
  }, [diffuse, preset.color])

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        ref={matRef}
        color={preset.color}
        map={getPlaceholderTexture()}
        roughness={0.95}
        metalness={0}
        envMapIntensity={0.2}
        toneMapped
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function TileGroupRenderer({ preset, tiles, stretch = 1 }: { preset: GroundPreset; tiles: [number, number][]; stretch?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  // Custom textures bypass the Poly Haven path builder
  const urls = useMemo(() =>
    preset.customTextureUrl
      ? { diffuse: preset.customTextureUrl }
      : getTextureUrls(preset.assetName),
    [preset.assetName, preset.customTextureUrl])
  const [diffuse, setDiffuse] = useState<THREE.Texture | null>(null)

  const gl = useThree(s => s.gl)

  // Load diffuse texture ONCE — shared reference, no clone needed
  useEffect(() => {
    let cancelled = false
    let activeClone: THREE.Texture | null = null
    loadCachedTexture(urls.diffuse, THREE.SRGBColorSpace).then(tex => {
      if (!cancelled && tex) {
        // Stretch comes from the instance matrix; UVs stay 0..1 so the full
        // texture is visible on the enlarged painted cell.
        gl.initTexture(tex)
        setDiffuse(tex)
      }
    })
    return () => { cancelled = true }
  }, [urls.diffuse, gl])

  // ░▒▓ IMPERATIVE MATERIAL SYNC — R3F declarative updates can miss texture
  // assignment on instancedMesh children. Force the GPU handshake here.
  // The placeholder texture ensures the shader compiles with a sampler slot,
  // so swapping to the real texture is a data change, not a shader recompile. ▓▒░
  useEffect(() => {
    const mat = matRef.current
    if (!mat) return
    if (diffuse) {
      mat.map = diffuse
      mat.color.set('#ffffff')
    } else {
      mat.map = getPlaceholderTexture()
      mat.color.set(preset.color)
    }
    mat.needsUpdate = true
  }, [diffuse, preset.color])

  // ░▒▓ MOUNT GUARD — InstancedMesh initializes count=MAX_TILES_PER_GROUP,
  // rendering 2048 identity-matrix ghosts at origin until the matrix effect
  // runs. Zero the count immediately so no phantom tiles flash on screen. ▓▒░
  useEffect(() => {
    const mesh = meshRef.current
    if (mesh) mesh.count = 0
  }, [])

  // Update instance matrices + visible count whenever tiles change
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const dummy = new THREE.Object3D()
    const count = Math.min(tiles.length, MAX_TILES_PER_GROUP)
    const s = Math.max(1, stretch)
    for (let i = 0; i < count; i++) {
      const [x, z] = tiles[i]
      // ░▒▓ Stretched cells render at sxsm. Position is the cell's lattice
      // anchor + half-cell offset so the centered InstancedMesh quad lands
      // exactly on the (x,z)..(x+s, z+s) footprint. ▓▒░
      dummy.position.set(x + s / 2, 0.001, z + s / 2)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.set(s, s, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.count = count  // ← only render this many instances
    mesh.instanceMatrix.needsUpdate = true
  }, [tiles, stretch])

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX_TILES_PER_GROUP]}
      frustumCulled={false}
    >
      <planeGeometry args={[TILE_SIZE, TILE_SIZE]} />
      {/* ░▒▓ Placeholder texture on mount ensures shader always has sampler slot ▓▒░ */}
      <meshStandardMaterial
        ref={matRef}
        color={preset.color}
        map={getPlaceholderTexture()}
        roughness={1}
        metalness={0}
        envMapIntensity={0.15}
        toneMapped
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </instancedMesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// RELIEF TILE GROUP RENDERER — Painted tiles that conform to sculpted terrain
// ═══════════════════════════════════════════════════════════════════════════════

function ReliefTileGroupRenderer({
  preset,
  tiles,
  heights,
  stretch = 1,
}: {
  preset: GroundPreset
  tiles: [number, number][]
  heights: number[]
  stretch?: number
}) {
  const gl = useThree(s => s.gl)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  const urls = useMemo(() =>
    preset.customTextureUrl
      ? { diffuse: preset.customTextureUrl }
      : getTextureUrls(preset.assetName),
    [preset.assetName, preset.customTextureUrl])
  const [diffuse, setDiffuse] = useState<THREE.Texture | null>(null)
  const geometry = useMemo(() => buildReliefTileGeometry(tiles, heights, stretch), [tiles, heights, stretch])

  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    let cancelled = false
    loadCachedTexture(urls.diffuse, THREE.SRGBColorSpace).then(tex => {
      if (!cancelled && tex) {
        gl.initTexture(tex)
        setDiffuse(tex)
      }
    })
    return () => { cancelled = true }
  }, [urls.diffuse, gl])

  useEffect(() => {
    const mat = matRef.current
    if (!mat) return
    if (diffuse) {
      mat.map = diffuse
      mat.color.set('#ffffff')
    } else {
      mat.map = getPlaceholderTexture()
      mat.color.set(preset.color)
    }
    mat.needsUpdate = true
  }, [diffuse, preset.color])

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <meshStandardMaterial
        ref={matRef}
        color={preset.color}
        map={getPlaceholderTexture()}
        roughness={1}
        metalness={0}
        envMapIntensity={0.15}
        toneMapped
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}

// PAINT GRID OVERLAY — Shows the 1m grid when in paint mode
function PaintGridOverlay() {
  return (
    <gridHelper
      args={[GROUND_SIZE, GROUND_SIZE, '#ffffff', '#ffffff']}
      position={[0, 0.005, 0]}
      material-transparent
      material-opacity={0.08}
    />
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRUSH PREVIEW — Shows which tiles will be painted on hover
// ═══════════════════════════════════════════════════════════════════════════════

function BrushPreview({
  position,
  size,
  color,
  shape = 'square',
}: {
  position: [number, number, number]
  size: number
  color: string
  shape?: 'square' | 'circle'
}) {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.15 + Math.sin(state.clock.elapsedTime * 3) * 0.05
    }
  })

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[position[0], position[1], position[2]]}
    >
      {shape === 'circle' ? <circleGeometry args={[size, 48]} /> : <planeGeometry args={[size, size]} />}
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.2}
        depthWrite={false}
      />
    </mesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAINT OVERLAY — Invisible click plane that catches paint clicks
// ░▒▓ Handles: left-click paint, right-click erase, drag-paint ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function PaintOverlay({ texturePaintActive, sculptActive }: { texturePaintActive: boolean; sculptActive: boolean }) {
  const paintGroundArea = useOasisStore(s => s.paintGroundArea)
  const eraseGroundTile = useOasisStore(s => s.eraseGroundTile)
  const paintBrushSize = useOasisStore(s => s.paintBrushSize)
  const paintBrushPresetId = useOasisStore(s => s.paintBrushPresetId)
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const terrainBrushRadius = useOasisStore(s => s.terrainBrushRadius)
  const terrainBrushDirection = useOasisStore(s => s.terrainBrushDirection)
  const sculptTerrainAt = useOasisStore(s => s.sculptTerrainAt)
  const saveWorldState = useOasisStore(s => s.saveWorldState)
  const beginUndoBatch = useOasisStore(s => s.beginUndoBatch)
  const commitUndoBatch = useOasisStore(s => s.commitUndoBatch)
  const { setIsDragging } = useContext(DragContext)
  const camera = useThree(s => s.camera)
  const gl = useThree(s => s.gl)
  const [hoverPos, setHoverPos] = useState<[number, number, number] | null>(null)
  const isPainting = useRef(false)
  const isSculpting = useRef(false)
  const lastSculptPoint = useRef<THREE.Vector3 | null>(null)
  const crosshairRaycasterRef = useRef(new THREE.Raycaster())
  const crosshairPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const crosshairHitRef = useRef(new THREE.Vector3())
  const crosshairNdcRef = useRef(new THREE.Vector2())

  const brushPreset = useMemo(() =>
    GROUND_PRESETS.find(p => p.id === paintBrushPresetId),
    [paintBrushPresetId],
  )

  // Snap world position to tile grid center — must match paintGroundArea math exactly
  // paintGroundArea centers the brush at Math.floor(cx), Math.floor(cz)
  // Tiles span from floor(x)-half to floor(x)+half, visual center = floor(x)+0.5
  const snapToGrid = useCallback((point: THREE.Vector3): [number, number, number] => {
    const tx = Math.floor(point.x) + 0.5
    const tz = Math.floor(point.z) + 0.5
    return [tx, 0.003, tz]
  }, [])

  const getSculptPreviewPos = useCallback((point: THREE.Vector3): [number, number, number] => {
    return [point.x, sampleTerrainHeightAt(terrainHeights, point.x, point.z) + 0.035, point.z]
  }, [terrainHeights])

  const updateCrosshairNdc = useCallback(() => {
    const canvasRect = gl.domElement.getBoundingClientRect()
    const crosshair = typeof document !== 'undefined'
      ? document.querySelector('[data-oasis-crosshair]')
      : null
    const crosshairRect = crosshair?.getBoundingClientRect()
    const clientX = crosshairRect
      ? crosshairRect.left + crosshairRect.width / 2
      : canvasRect.left + canvasRect.width / 2
    const clientY = crosshairRect
      ? crosshairRect.top + crosshairRect.height / 2
      : canvasRect.top + canvasRect.height / 2
    crosshairNdcRef.current.set(
      ((clientX - canvasRect.left) / Math.max(1, canvasRect.width)) * 2 - 1,
      -(((clientY - canvasRect.top) / Math.max(1, canvasRect.height)) * 2 - 1),
    )
    return crosshairNdcRef.current
  }, [gl])

  useFrame((_, delta) => {
    if (!isSculpting.current || !lastSculptPoint.current || !sculptActive) return
    const point = lastSculptPoint.current
    sculptTerrainAt(point.x, point.z, Math.min(delta, 0.05))
  })

  const finishStroke = useCallback(() => {
    const shouldSaveSculpt = isSculpting.current
    isPainting.current = false
    isSculpting.current = false
    lastSculptPoint.current = null
    setIsDragging(false)
    commitUndoBatch()
    if (shouldSaveSculpt) saveWorldState()
  }, [setIsDragging, commitUndoBatch, saveWorldState])

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation()
    const point = e.point as THREE.Vector3
    if (sculptActive) {
      if (e.button !== 0) return
      beginUndoBatch('Sculpt terrain', 'terrain')
      isSculpting.current = true
      lastSculptPoint.current = point.clone()
      setIsDragging(true)
      sculptTerrainAt(point.x, point.z, 1 / 30)
      return
    }
    if (!texturePaintActive) return
    // Right-click = erase (single tile, own undo command)
    if (e.button === 2) {
      setIsDragging(true) // Block orbit pan during erase — prevents camera lurch
      beginUndoBatch('Erase tile', '🧽')
      eraseGroundTile(point.x, point.z)
      commitUndoBatch()
      setIsDragging(false)
      return
    }
    // ░▒▓ GUARD: only left-click (button 0) paints. Middle-click, extra buttons,
    // or any R3F edge-case event with unexpected button value → ignore silently.
    // Without this, non-left clicks fall through to paint at wild raycast coords. ▓▒░
    if (e.button !== 0) return
    // Left-click = paint — freeze orbit so drag paints, not rotates
    // ░▒▓ Begin undo batch — entire paint stroke = one undo command ▓▒░
    beginUndoBatch('Paint tiles', '🎨')
    isPainting.current = true
    setIsDragging(true)
    paintGroundArea(point.x, point.z)
  }, [paintGroundArea, eraseGroundTile, setIsDragging, beginUndoBatch, commitUndoBatch, sculptActive, texturePaintActive, sculptTerrainAt])

  const handlePointerUp = useCallback(() => {
    finishStroke()
  }, [finishStroke])

  useEffect(() => {
    if (!texturePaintActive && !sculptActive) return
    const paintStrokeActive = { current: false }
    const sculptStrokeActive = { current: false }

    const raycastCrosshairGround = () => {
      const raycaster = crosshairRaycasterRef.current
      const hit = crosshairHitRef.current
      raycaster.setFromCamera(updateCrosshairNdc(), camera)
      if (!raycaster.ray.intersectPlane(crosshairPlaneRef.current, hit)) return null
      return hit
    }

    const handlePaintAtCrosshair = (event: Event) => {
      if (!texturePaintActive) return
      const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase || 'start'
      if (phase === 'end') {
        if (paintStrokeActive.current) commitUndoBatch()
        paintStrokeActive.current = false
        return
      }
      const hit = raycastCrosshairGround()
      if (!hit) return
      if (!paintStrokeActive.current) {
        beginUndoBatch('Paint tiles', 'paint')
        paintStrokeActive.current = true
      }
      paintGroundArea(hit.x, hit.z)
      setHoverPos(snapToGrid(hit))
    }

    const handleTerrainBrushAtCrosshair = (event: Event) => {
      if (!sculptActive) return
      const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase || 'start'
      if (phase === 'end') {
        const shouldSave = sculptStrokeActive.current
        if (sculptStrokeActive.current) commitUndoBatch()
        sculptStrokeActive.current = false
        if (shouldSave) saveWorldState()
        return
      }
      const hit = raycastCrosshairGround()
      if (!hit) return
      if (!sculptStrokeActive.current) {
        beginUndoBatch('Sculpt terrain', 'terrain')
        sculptStrokeActive.current = true
      }
      sculptTerrainAt(hit.x, hit.z, 1 / 18)
      setHoverPos(getSculptPreviewPos(hit))
    }

    window.addEventListener('oasis:paint-at-crosshair', handlePaintAtCrosshair)
    window.addEventListener('oasis:terrain-brush-at-crosshair', handleTerrainBrushAtCrosshair)
    return () => {
      window.removeEventListener('oasis:paint-at-crosshair', handlePaintAtCrosshair)
      window.removeEventListener('oasis:terrain-brush-at-crosshair', handleTerrainBrushAtCrosshair)
    }
  }, [camera, beginUndoBatch, commitUndoBatch, getSculptPreviewPos, paintGroundArea, saveWorldState, sculptActive, sculptTerrainAt, snapToGrid, texturePaintActive, updateCrosshairNdc])

  const handlePointerMove = useCallback((e: any) => {
    const point = e.point as THREE.Vector3
    setHoverPos(sculptActive ? getSculptPreviewPos(point) : snapToGrid(point))
    if (isSculpting.current) {
      lastSculptPoint.current = point.clone()
      return
    }
    // Drag-painting
    if (texturePaintActive && isPainting.current) {
      paintGroundArea(point.x, point.z)
    }
  }, [snapToGrid, getSculptPreviewPos, paintGroundArea, sculptActive, texturePaintActive])

  return (
    <>
      {/* Invisible click plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.002, 0]}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => { setHoverPos(null); finishStroke() }}
        onContextMenu={(e: any) => e.nativeEvent?.preventDefault?.()}
      >
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Brush preview at cursor */}
      {hoverPos && (sculptActive || brushPreset) && (
        <BrushPreview
          position={hoverPos}
          size={sculptActive ? terrainBrushRadius : paintBrushSize}
          color={sculptActive ? (terrainBrushDirection === 'down' ? '#60A5FA' : '#F59E0B') : (brushPreset?.color || '#34D399')}
          shape={sculptActive ? 'circle' : 'square'}
        />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ░▒▓█ GROUND PLANE — The mother of all ground rendering █▓▒░
// Base ground (when preset !== 'none') + painted tiles + paint mode overlay
// Tiles + overlays ALWAYS render, even on void — only the base plane is optional
// ═══════════════════════════════════════════════════════════════════════════════

interface GroundPlaneProps {
  preset: GroundPreset
  groundTiles: Record<string, string>
  paintMode: boolean
  customGroundPresets?: GroundPreset[]
}

export function GroundPlane({ preset, groundTiles, paintMode, customGroundPresets = [] }: GroundPlaneProps) {
  const showBase = preset.id !== 'none' && Boolean(preset.assetName || preset.customTextureUrl)
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const terrainBrushPanelOpen = useOasisStore(s => s.terrainBrushPanelOpen)
  const terrainBrushMode = useOasisStore(s => s.terrainBrushMode)
  const reliefActive = hasTerrainRelief(terrainHeights)
  const sculptActive = terrainBrushPanelOpen && terrainBrushMode === 'sculpt'
  const showBrushOverlay = paintMode || sculptActive

  // ░▒▓ Tile cell decode — values are either bare `presetId` (legacy/stretch=1)
  // or `presetId@stretch` (e.g. `grass@4`). Grouping is by `presetId__stretch`
  // so each stretch tier renders as its own InstancedMesh (uniform scale + UV
  // repeat per group). ▓▒░
  const tileGroups = useMemo(() => {
    const groups: Record<string, { presetId: string; stretch: number; tiles: [number, number][] }> = {}
    for (const [key, raw] of Object.entries(groundTiles)) {
      const [xs, zs] = key.split(',')
      const x = parseInt(xs, 10)
      const z = parseInt(zs, 10)
      if (isNaN(x) || isNaN(z)) continue
      const atIdx = raw.indexOf('@')
      const presetId = atIdx >= 0 ? raw.slice(0, atIdx) : raw
      const stretchParsed = atIdx >= 0 ? parseInt(raw.slice(atIdx + 1), 10) : 1
      const stretch = Number.isFinite(stretchParsed) && stretchParsed > 0 ? stretchParsed : 1
      const groupKey = `${presetId}__${stretch}`
      if (!groups[groupKey]) groups[groupKey] = { presetId, stretch, tiles: [] }
      groups[groupKey].tiles.push([x, z])
    }
    return groups
  }, [groundTiles])

  return (
    <group>
      {/* ░▒▓ Base ground — the default texture for unpainted areas ▓▒░ */}
      {reliefActive ? <ReliefGround preset={preset} heights={terrainHeights} /> : showBase && <BaseGround preset={preset} />}

      {/* ░▒▓ Painted tiles — one stable InstancedMesh per (preset, stretch) ▓▒░ */}
      {Object.entries(tileGroups).map(([groupKey, { presetId, stretch, tiles }]) => {
        // Search both built-in and custom presets
        const tilePreset = GROUND_PRESETS.find(p => p.id === presetId)
          || customGroundPresets.find(p => p.id === presetId)
        if (!tilePreset || (!tilePreset.assetName && !tilePreset.customTextureUrl)) return null
        return reliefActive ? (
          <ReliefTileGroupRenderer
            key={groupKey}
            preset={tilePreset}
            tiles={tiles}
            heights={terrainHeights}
            stretch={stretch}
          />
        ) : (
          <TileGroupRenderer
            key={groupKey}
            preset={tilePreset}
            tiles={tiles}
            stretch={stretch}
          />
        )
      })}

      {/* ░▒▓ Paint mode overlays ▓▒░ */}
      {showBrushOverlay && <PaintGridOverlay />}
      {showBrushOverlay && <PaintOverlay texturePaintActive={paintMode} sculptActive={sculptActive} />}
    </group>
  )
}

// ▓▓▓▓【G̸R̸O̸U̸N̸D̸】▓▓▓▓ॐ▓▓▓▓【P̸L̸A̸N̸E̸】▓▓▓▓ॐ▓▓▓▓【T̸I̸L̸E̸S̸】▓▓▓▓
