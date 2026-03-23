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
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { type GroundPreset, GROUND_PRESETS, getTextureUrls } from '../../lib/forge/ground-textures'
import { useOasisStore } from '../../store/oasisStore'
import { DragContext } from '../scene-lib/contexts'

const GROUND_SIZE = 100
const TILE_SIZE = 1
// Max tiles per preset group — covers full 100×100 world (10,000 tiles)
const MAX_TILES_PER_GROUP = 10000

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
  const urls = useMemo(() => getTextureUrls(preset.assetName), [preset.assetName])
  const [diffuse, setDiffuse] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    let cancelled = false
    let activeClone: THREE.Texture | null = null

    // BaseGround needs tiled repeat, so we clone + force GPU re-upload
    loadCachedTexture(urls.diffuse, THREE.SRGBColorSpace).then(tex => {
      if (!cancelled && tex) {
        const clone = tex.clone()
        clone.repeat.set(preset.tileRepeat, preset.tileRepeat)
        clone.needsUpdate = true
        activeClone = clone
        setDiffuse(clone)
      }
    })

    return () => { cancelled = true; activeClone?.dispose() }
  }, [urls, preset.tileRepeat])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
      <meshStandardMaterial
        color={diffuse ? '#ffffff' : preset.color}
        map={diffuse}
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

function TileGroupRenderer({ preset, tiles }: { preset: GroundPreset; tiles: [number, number][] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  // Custom textures bypass the Poly Haven path builder
  const urls = useMemo(() =>
    preset.customTextureUrl
      ? { diffuse: preset.customTextureUrl }
      : getTextureUrls(preset.assetName),
    [preset.assetName, preset.customTextureUrl])
  const [diffuse, setDiffuse] = useState<THREE.Texture | null>(null)

  // Load diffuse texture ONCE — shared reference, no clone needed
  useEffect(() => {
    let cancelled = false
    loadCachedTexture(urls.diffuse, THREE.SRGBColorSpace).then(tex => {
      if (!cancelled && tex) setDiffuse(tex) // direct reference, not clone!
    })
    return () => { cancelled = true }
  }, [urls.diffuse])

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
    for (let i = 0; i < count; i++) {
      const [x, z] = tiles[i]
      dummy.position.set(x + 0.5, 0.001, z + 0.5)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.count = count  // ← only render this many instances
    mesh.instanceMatrix.needsUpdate = true
  }, [tiles])

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
// PAINT GRID OVERLAY — Shows the 1m grid when in paint mode
// ═══════════════════════════════════════════════════════════════════════════════

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

function BrushPreview({ position, size, color }: { position: [number, number, number]; size: number; color: string }) {
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
      position={[position[0], 0.003, position[2]]}
    >
      <planeGeometry args={[size, size]} />
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

function PaintOverlay() {
  const paintGroundArea = useOasisStore(s => s.paintGroundArea)
  const eraseGroundTile = useOasisStore(s => s.eraseGroundTile)
  const paintBrushSize = useOasisStore(s => s.paintBrushSize)
  const paintBrushPresetId = useOasisStore(s => s.paintBrushPresetId)
  const beginUndoBatch = useOasisStore(s => s.beginUndoBatch)
  const commitUndoBatch = useOasisStore(s => s.commitUndoBatch)
  const { setIsDragging } = useContext(DragContext)
  const [hoverPos, setHoverPos] = useState<[number, number, number] | null>(null)
  const isPainting = useRef(false)

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

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation()
    const point = e.point as THREE.Vector3
    // Right-click = erase (single tile, own undo command)
    if (e.button === 2) {
      setIsDragging(true) // Block orbit pan during erase — prevents camera lurch
      beginUndoBatch('Erase tile', '🧽')
      eraseGroundTile(point.x, point.z)
      commitUndoBatch()
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
  }, [paintGroundArea, eraseGroundTile, setIsDragging, beginUndoBatch, commitUndoBatch])

  const handlePointerUp = useCallback(() => {
    isPainting.current = false
    setIsDragging(false)
    // ░▒▓ End paint stroke — commit undo batch ▓▒░
    commitUndoBatch()
  }, [setIsDragging, commitUndoBatch])

  const handlePointerMove = useCallback((e: any) => {
    const point = e.point as THREE.Vector3
    setHoverPos(snapToGrid(point))
    // Drag-painting
    if (isPainting.current) {
      paintGroundArea(point.x, point.z)
    }
  }, [snapToGrid, paintGroundArea])

  return (
    <>
      {/* Invisible click plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.002, 0]}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => { setHoverPos(null); isPainting.current = false; setIsDragging(false); commitUndoBatch() }}
        onContextMenu={(e: any) => e.nativeEvent?.preventDefault?.()}
      >
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Brush preview at cursor */}
      {hoverPos && brushPreset && (
        <BrushPreview
          position={hoverPos}
          size={paintBrushSize}
          color={brushPreset.color}
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
  const showBase = preset.id !== 'none' && !!preset.assetName

  // Group tiles by preset ID for instanced rendering
  const tileGroups = useMemo(() => {
    const groups: Record<string, [number, number][]> = {}
    for (const [key, presetId] of Object.entries(groundTiles)) {
      const [xs, zs] = key.split(',')
      const x = parseInt(xs, 10)
      const z = parseInt(zs, 10)
      if (isNaN(x) || isNaN(z)) continue
      if (!groups[presetId]) groups[presetId] = []
      groups[presetId].push([x, z])
    }
    return groups
  }, [groundTiles])

  return (
    <group>
      {/* ░▒▓ Base ground — the default texture for unpainted areas ▓▒░ */}
      {showBase && <BaseGround preset={preset} />}

      {/* ░▒▓ Painted tiles — one stable InstancedMesh per preset ▓▒░ */}
      {/* Key = presetId only (stable). Tile count changes update buffer, not remount. */}
      {Object.entries(tileGroups).map(([presetId, tiles]) => {
        // Search both built-in and custom presets
        const tilePreset = GROUND_PRESETS.find(p => p.id === presetId)
          || customGroundPresets.find(p => p.id === presetId)
        if (!tilePreset || (!tilePreset.assetName && !tilePreset.customTextureUrl)) return null
        return (
          <TileGroupRenderer
            key={presetId}
            preset={tilePreset}
            tiles={tiles}
          />
        )
      })}

      {/* ░▒▓ Paint mode overlays ▓▒░ */}
      {paintMode && <PaintGridOverlay />}
      {paintMode && <PaintOverlay />}
    </group>
  )
}

// ▓▓▓▓【G̸R̸O̸U̸N̸D̸】▓▓▓▓ॐ▓▓▓▓【P̸L̸A̸N̸E̸】▓▓▓▓ॐ▓▓▓▓【T̸I̸L̸E̸S̸】▓▓▓▓
