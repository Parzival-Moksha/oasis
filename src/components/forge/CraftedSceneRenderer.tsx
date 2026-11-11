// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CRAFTED SCENE RENDERER — LLM imagination made tangible
// ─═̷─═̷─ॐ─═̷─═̷─ JSON → Primitives → Three.js → Reality ─═̷─═̷─ॐ─═̷─═̷─
// Each primitive is a thought crystallized in geometry.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useRef, useState, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useThree } from '@react-three/fiber'
import { Text3D, Center } from '@react-three/drei'
import * as THREE from 'three'
import type { CraftedScene, CraftedPrimitive } from '../../lib/conjure/types'
import { useOasisStore } from '../../store/oasisStore'
import { extractModelStats } from './ModelPreview'
import { useInputManager } from '../../lib/input-manager'
import { FlameShader, FlagShader, CrystalShader, WaterShader, ParticleEmitterShader, GlowOrbShader, AuroraShader } from './ShaderPrimitives'
import { getCraftTexturePreset, computeAutoTiling, canHaveTexture } from '../../lib/forge/craft-textures'
import { clampText3DInput } from '../../lib/forge/text-3d-object'
import { applyCraftAnimation } from '../../lib/forge/craft-animation'
import { useFrameWhen } from '../../lib/use-frame-when'
import { SharedMaterials } from '../../lib/forge/shared-materials'
import { buildCraftBatchGeometry, craftBaseGeometry, craftBatchMaterialOf, isCraftMergeEnabled, planCraftBatches, raycastCraftBatch, subscribeCraftMerge } from '../../lib/forge/craft-merge'

// ═══════════════════════════════════════════════════════════════════════════════
// PRIMITIVE GEOMETRY — maps type string to Three.js geometry
// ═══════════════════════════════════════════════════════════════════════════════

export function PrimitiveGeometry({ type }: { type: CraftedPrimitive['type'] }) {
  switch (type) {
    case 'box': return <boxGeometry args={[1, 1, 1]} />
    case 'sphere': return <sphereGeometry args={[0.5, 32, 32]} />
    case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
    case 'cone': return <coneGeometry args={[0.5, 1, 32]} />
    case 'torus': return <torusGeometry args={[0.4, 0.15, 16, 32]} />
    case 'plane': return <planeGeometry args={[1, 1]} />
    case 'capsule': return <capsuleGeometry args={[0.3, 0.5, 8, 16]} />
    default: return <boxGeometry args={[1, 1, 1]} />
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRAFT TEXTURE CACHE — Load once, clone per unique repeat value
// Same battle-tested pattern as GroundPlane: shared cache, placeholder,
// retry with exponential backoff, GPU sync before render.
// ═══════════════════════════════════════════════════════════════════════════════

const craftTextureSource = new Map<string, THREE.Texture>()
const craftTextureClones = new Map<string, THREE.Texture>()
const craftFailedUrls = new Set<string>()
const CRAFT_TEX_MAX_RETRIES = 3
const CRAFT_TEX_RETRY_MS = 800

let _craftPlaceholder: THREE.Texture | null = null
function getCraftPlaceholder(): THREE.Texture {
  if (!_craftPlaceholder) {
    if (typeof document === 'undefined') return new THREE.Texture()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#888888'
    ctx.fillRect(0, 0, 1, 1)
    _craftPlaceholder = new THREE.CanvasTexture(canvas)
    _craftPlaceholder.colorSpace = THREE.SRGBColorSpace
  }
  return _craftPlaceholder
}

async function loadCraftTextureSource(url: string): Promise<THREE.Texture | null> {
  const cached = craftTextureSource.get(url)
  if (cached) return cached
  if (craftFailedUrls.has(url)) return null

  for (let attempt = 0; attempt < CRAFT_TEX_MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, CRAFT_TEX_RETRY_MS * Math.pow(2, attempt - 1)))
    const tex = await new Promise<THREE.Texture | null>(resolve => {
      new THREE.TextureLoader().load(url, resolve, undefined, () => resolve(null))
    })
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      craftTextureSource.set(url, tex)
      return tex
    }
  }
  craftFailedUrls.add(url)
  return null
}

/** Hook: resolve preset → load source → clone with computed repeat → GPU sync */
function useCraftTexture(primitive: CraftedPrimitive): THREE.Texture | null {
  const gl = useThree(s => s.gl)
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  const preset = primitive.texturePresetId ? getCraftTexturePreset(primitive.texturePresetId) : undefined
  const wantsTexture = !!preset && canHaveTexture(primitive.type)

  const repeat = useMemo(() => {
    if (!preset) return 1
    if (primitive.textureRepeat) return primitive.textureRepeat
    return computeAutoTiling(primitive.scale, preset.naturalSizeMeters)
  }, [preset, primitive.textureRepeat, primitive.scale])

  useEffect(() => {
    if (!preset || !wantsTexture) { setTexture(null); return }
    let cancelled = false

    const cloneKey = `${preset.texturePath}:${repeat}`
    const existing = craftTextureClones.get(cloneKey)
    if (existing) { setTexture(existing); return }

    loadCraftTextureSource(preset.texturePath).then(source => {
      if (cancelled || !source) return
      const clone = source.clone()
      clone.repeat.set(repeat, repeat)
      clone.needsUpdate = true
      try { gl.initTexture(clone) } catch { /* GL sync optional */ }
      craftTextureClones.set(cloneKey, clone)
      setTexture(clone)
    })

    return () => { cancelled = true }
  }, [preset, wantsTexture, repeat, gl])

  return texture
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED MATERIALS — primitives with the same material values use one material object
// (three re-sends a material's uniforms each time it changes between draws)
// ═══════════════════════════════════════════════════════════════════════════════

const craftMaterials = new SharedMaterials()

/** The shared material for `signature` (null: none wanted). `create` runs only for a signature nobody holds. */
function useSharedCraftMaterial(signature: string | null, create: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial | null {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature says everything `create` reads
  const material = useMemo(() => (signature === null ? null : craftMaterials.get(signature, create)), [signature])
  useEffect(() => (signature === null ? undefined : craftMaterials.retain(signature)), [signature, material])
  return material
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE PRIMITIVE — one atomic piece of a crafted scene
// ═══════════════════════════════════════════════════════════════════════════════

// Shared animation hook — applies to both mesh and text primitives.
// Only a primitive that has an animation joins the frame loop (most have none).
function useAnimation(ref: React.RefObject<THREE.Object3D | null>, primitive: CraftedPrimitive) {
  const anim = primitive.animation
  const base = useRef({
    position: primitive.position,
    rotation: primitive.rotation || [0, 0, 0] as [number, number, number],
    scale: primitive.scale,
  })

  useFrameWhen(!!anim, (state) => {
    if (!ref.current || !anim) return
    applyCraftAnimation(ref.current, anim, base.current, state.clock.elapsedTime)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT PRIMITIVE — Extruded 3D text via drei Text3D (three.js TextGeometry)
// ═══════════════════════════════════════════════════════════════════════════════

const TEXT3D_FONT = '/fonts/helvetiker_regular.typeface.json'

function CraftedTextMesh({ primitive }: { primitive: CraftedPrimitive }) {
  const groupRef = useRef<THREE.Group>(null)
  const hasOpacity = primitive.opacity !== undefined && primitive.opacity < 1
  useAnimation(groupRef, primitive)

  const fontSize = primitive.fontSize ?? 1
  const safeText = clampText3DInput(primitive.text || '').trim() || '?'
  // Extrusion depth proportional to font size — looks solid without being comically thick
  const depth = fontSize * 0.2

  return (
    <group
      ref={groupRef}
      position={primitive.position}
      rotation={primitive.rotation || [0, 0, 0]}
      scale={primitive.scale}
    >
      <Center>
        <Text3D
          font={TEXT3D_FONT}
          size={fontSize}
          height={depth}
          bevelEnabled
          bevelThickness={fontSize * 0.02}
          bevelSize={fontSize * 0.01}
          bevelSegments={3}
          castShadow={!hasOpacity}
          receiveShadow
        >
          {safeText}
          <meshStandardMaterial
            color={primitive.color}
            emissive={primitive.emissive || '#000000'}
            emissiveIntensity={primitive.emissiveIntensity ?? 0}
            metalness={primitive.metalness ?? 0}
            roughness={primitive.roughness ?? 0.5}
            transparent={hasOpacity}
            opacity={primitive.opacity ?? 1}
            depthWrite={!hasOpacity}
          />
        </Text3D>
      </Center>
    </group>
  )
}

// Shader primitive type set — used for routing
const SHADER_TYPES = new Set(['flame', 'flag', 'crystal', 'water', 'particle_emitter', 'glow_orb', 'aurora'])

export function CraftedPrimitiveMesh({ primitive }: { primitive: CraftedPrimitive }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const hasOpacity = primitive.opacity !== undefined && primitive.opacity < 1
  useAnimation(meshRef, primitive)

  // Texture support — preset-based, auto-tiled, cached
  const craftTexture = useCraftTexture(primitive)
  const wantsTexture = !!primitive.texturePresetId && canHaveTexture(primitive.type)
  // Use placeholder when texture is loading (prevents shader recompile flash)
  const textureMap = craftTexture || (wantsTexture ? getCraftPlaceholder() : null)

  const isPlainMesh = primitive.type !== 'text' && !SHADER_TYPES.has(primitive.type)
  const material = useSharedCraftMaterial(
    isPlainMesh
      ? ['mesh', primitive.color, primitive.metalness ?? 0, primitive.roughness ?? 0.7, primitive.emissive || '#000000',
        primitive.emissiveIntensity ?? 0, hasOpacity ? primitive.opacity : 1, textureMap ? textureMap.uuid : ''].join('|')
      : null,
    () => new THREE.MeshStandardMaterial({
      color: primitive.color,
      metalness: primitive.metalness ?? 0,
      roughness: primitive.roughness ?? 0.7,
      emissive: primitive.emissive || '#000000',
      emissiveIntensity: primitive.emissiveIntensity ?? 0,
      transparent: hasOpacity,
      opacity: primitive.opacity ?? 1,
      depthWrite: !hasOpacity,
      map: textureMap,
    }),
  )

  // Text primitives use a separate component
  if (primitive.type === 'text') {
    return <CraftedTextMesh primitive={primitive} />
  }

  // Shader primitives — procedural GLSL effects
  if (SHADER_TYPES.has(primitive.type)) {
    switch (primitive.type) {
      case 'flame': return <FlameShader primitive={primitive} />
      case 'flag': return <FlagShader primitive={primitive} />
      case 'crystal': return <CrystalShader primitive={primitive} />
      case 'water': return <WaterShader primitive={primitive} />
      case 'particle_emitter': return <ParticleEmitterShader primitive={primitive} />
      case 'glow_orb': return <GlowOrbShader primitive={primitive} />
      case 'aurora': return <AuroraShader primitive={primitive} />
    }
  }

  return (
    <mesh
      ref={meshRef}
      position={primitive.position}
      rotation={primitive.rotation || [0, 0, 0]}
      scale={primitive.scale}
      castShadow={!hasOpacity}
      receiveShadow
      material={material ?? undefined}
      // One shared geometry per shape, with its bounding box ready: a hover ray rejects a
      // long thin primitive by its box instead of walking its triangles.
      geometry={craftBaseGeometry(primitive.type)}
    />
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH — a scene's still, solid primitives that share a material, drawn as one mesh
// (src/lib/forge/craft-merge.ts: same triangles and material values, colour on the vertices)
// ═══════════════════════════════════════════════════════════════════════════════

function CraftedBatchMesh({ primitives }: { primitives: CraftedPrimitive[] }) {
  const geometry = useMemo(() => buildCraftBatchGeometry(primitives), [primitives])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = craftBatchMaterialOf(primitives[0])
  // The batch's texture repeats once; each primitive's own repeat is in its UVs.
  const texturePrimitive = useMemo<CraftedPrimitive>(
    () => ({ ...primitives[0], textureRepeat: 1 }),
    [primitives],
  )
  const craftTexture = useCraftTexture(texturePrimitive)
  const textureMap = craftTexture || (material.texturePresetId ? getCraftPlaceholder() : null)

  const shared = useSharedCraftMaterial(
    ['batch', material.metalness, material.roughness, material.emissive, material.emissiveIntensity, textureMap ? textureMap.uuid : ''].join('|'),
    () => new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: '#ffffff',
      metalness: material.metalness,
      roughness: material.roughness,
      emissive: material.emissive,
      emissiveIntensity: material.emissiveIntensity,
      map: textureMap,
    }),
  )

  // Pointer rays test only the primitives whose box they enter (raycastCraftBatch), not every triangle of the batch.
  return <mesh geometry={geometry} material={shared ?? undefined} raycast={raycastCraftBatch} castShadow receiveShadow />
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRAFTED SCENE — the full composition
// ═══════════════════════════════════════════════════════════════════════════════

interface CraftedSceneRendererProps {
  scene: CraftedScene
  onDelete?: (id: string) => void
}

export function CraftedSceneRenderer({ scene, onDelete: _onDelete }: CraftedSceneRendererProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  const spawnProgress = useRef(0)
  const spawnDone = useRef(false)
  const [spawning, setSpawning] = useState(true)

  // Still, solid primitives that share a material draw as one mesh; the rest as before.
  const mergeEnabled = useSyncExternalStore(subscribeCraftMerge, isCraftMergeEnabled, isCraftMergeEnabled)
  const plan = useMemo(() => {
    if (!mergeEnabled) return { loose: scene.objects.map((_, i) => i), batches: [] as Array<{ key: string; primitives: CraftedPrimitive[] }> }
    const planned = planCraftBatches(scene.objects)
    return { loose: planned.loose, batches: planned.batches.map(batch => ({ key: batch.key, primitives: batch.indexes.map(i => scene.objects[i]) })) }
  }, [scene.objects, mergeEnabled])

  // ░▒▓ Mesh stats — push to Zustand so ObjectInspector can display ▓▒░
  const setObjectMeshStats = useOasisStore(s => s.setObjectMeshStats)
  const statsReported = useRef(false)
  useEffect(() => {
    if (!groupRef.current || statsReported.current) return
    // Wait one frame for geometry to be created by R3F
    const raf = requestAnimationFrame(() => {
      if (!groupRef.current) return
      const stats = extractModelStats(groupRef.current, [])
      setObjectMeshStats(scene.id, stats)
      statsReported.current = true
    })
    return () => cancelAnimationFrame(raf)
  }, [scene.id, scene.objects.length, setObjectMeshStats])

  // Spawn animation — scales up then YIELDS to TransformControls
  // Position is managed by parent SelectableWrapper, NOT here
  // (Leaves the frame loop once the spawn is over.)
  useFrameWhen(spawning, (_, delta) => {
    if (!groupRef.current || spawnDone.current) return
    if (spawnProgress.current < 1) {
      spawnProgress.current = Math.min(1, spawnProgress.current + delta * 3)
      const t = spawnProgress.current
      const s = t === 1 ? 1 : 1 - Math.pow(2, -10 * t) * Math.cos((t * 10 - 0.75) * ((2 * Math.PI) / 3))
      groupRef.current.scale.setScalar(s)
    } else {
      groupRef.current.scale.setScalar(1)
      spawnDone.current = true // Never touch scale again — TransformControls owns it now
      setSpawning(false)
    }
  })

  return (
    <group
      ref={groupRef}
      onPointerOver={(e) => {
        e.stopPropagation()
        if (useInputManager.getState().pointerLocked) return
        setHovered(true)
      }}
      onPointerOut={(e) => {
        e.stopPropagation()
        if (useInputManager.getState().pointerLocked) return
        setHovered(false)
      }}
    >
      {plan.loose.map(i => (
        <CraftedPrimitiveMesh key={`${scene.id}-${i}`} primitive={scene.objects[i]} />
      ))}
      {plan.batches.map(batch => (
        <CraftedBatchMesh key={`${scene.id}-batch-${batch.key}`} primitives={batch.primitives} />
      ))}

      {/* Hover glow base */}
      {hovered && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[3, 3.5, 32]} />
          <meshBasicMaterial color="#3B82F6" transparent opacity={0.2} />
        </mesh>
      )}

    </group>
  )
}

// ▓▓▓▓【C̸R̸A̸F̸T̸E̸D̸】▓▓▓▓ॐ▓▓▓▓【S̸C̸E̸N̸E̸】▓▓▓▓
