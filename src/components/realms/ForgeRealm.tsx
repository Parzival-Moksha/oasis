// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Where words become matter, worlds become real
// ─═̷─═̷─🔥─═̷─═̷─ Terrain, ground, lighting — the stage for placed objects ─═̷─═̷─🔥─═̷─═̷─
// Object rendering delegated to WorldObjectsRenderer (shared across realms).
// The Forge provides the ENVIRONMENT: terrain, ground texture, warm lighting.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useRef, useCallback, useContext, Suspense } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useOasisStore } from '../../store/oasisStore'
import { GroundPlane } from '../forge/GroundPlane'
import { TerrainMesh } from '../forge/TerrainMesh'
import { WorldObjectsRenderer } from '../forge/WorldObjects'
import { GROUND_PRESETS } from '../../lib/forge/ground-textures'
import { useThumbnailGenerator } from '../../hooks/useThumbnailGenerator'
import { PlayerAvatar } from '../forge/PlayerAvatar'
import { SettingsContext } from '../scene-lib'

// ═══════════════════════════════════════════════════════════════════════════════
// FORGE GROUND — shows when no terrain is loaded (the original conjuring circle)
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// IBL INTENSITY SYNC — sets scene.environmentIntensity from world lights
// drei <Environment> sets the map, this syncs the intensity every frame
// ═══════════════════════════════════════════════════════════════════════════════

import type { WorldLight } from '../../lib/conjure/types'

function EnvironmentIntensitySync({ lights }: { lights: WorldLight[] }) {
  const prevIntensity = useRef<number | null>(null)
  const framesSinceTraverse = useRef(0)

  useFrame(({ scene }) => {
    const env = lights.find(l => l.type === 'environment')
    const target = env?.intensity ?? 0

    // Only traverse when intensity changes OR periodically (every 60 frames) to catch newly loaded meshes
    framesSinceTraverse.current++
    if (target === prevIntensity.current && framesSinceTraverse.current < 60) return
    prevIntensity.current = target
    framesSinceTraverse.current = 0

    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial
        if (std && std.envMapIntensity !== undefined && std.envMapIntensity !== target) {
          std.envMapIntensity = target
        }
      }
    })
  })
  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORGE REALM — Terrain + Ground + Lighting + WorldObjects
// The Forge's personality: warm orange/red lighting, textured ground, terrain.
// Object rendering is fully shared via WorldObjectsRenderer.
// ═══════════════════════════════════════════════════════════════════════════════

export function ForgeRealm() {
  const groundPresetId = useOasisStore(s => s.groundPresetId)
  const groundPreset = GROUND_PRESETS.find(p => p.id === groundPresetId) || GROUND_PRESETS[0]
  const groundTiles = useOasisStore(s => s.groundTiles)
  const paintMode = useOasisStore(s => s.paintMode)
  const selectObject = useOasisStore(s => s.selectObject)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const worldConjuredAssetIds = useOasisStore(s => s.worldConjuredAssetIds)
  const catalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const conjuredAssets = useOasisStore(s => s.conjuredAssets)
  const worldLights = useOasisStore(s => s.worldLights)
  const avatar3dUrl = useOasisStore(s => s.avatar3dUrl)
  const isViewMode = useOasisStore(s => s.isViewMode)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)
  const terrainParams = useOasisStore(s => s.terrainParams)
  const { settings } = useContext(SettingsContext)

  // ░▒▓ Background thumbnail gen — renders missing thumbnails offscreen ▓▒░
  useThumbnailGenerator()

  // World loading handled by Scene.tsx (useWorldLoader is global, always mounted)

  // Deselect + close inspector on background click
  const handlePointerMissed = useCallback(() => {
    selectObject(null)
    setInspectedObject(null)
  }, [selectObject, setInspectedObject])

  // Empty state detection
  const worldAssets = conjuredAssets.filter(a => worldConjuredAssetIds.includes(a.id))
  const readyAssets = worldAssets.filter(a => a.status === 'ready' && a.glbPath)
  const isEmpty = readyAssets.length === 0 && craftedScenes.length === 0 && catalogAssets.length === 0

  return (
    <group onClick={handlePointerMissed}>
      {/* ░▒▓ LIGHTING — IBL comes from SkyBackground's <Environment> in Scene.tsx ▓▒░ */}
      {/* EnvironmentIntensitySync controls envMapIntensity per-material from worldLights */}
      <EnvironmentIntensitySync lights={worldLights} />

      {/* GROUND — GroundPlane handles base ground + painted tiles + paint mode */}
      <GroundPlane preset={groundPreset} groundTiles={groundTiles} paintMode={paintMode} customGroundPresets={customGroundPresets} />

      {/* TERRAIN — Simplex noise heightmap terrain */}
      {terrainParams && <TerrainMesh params={terrainParams} />}

      {/* ░▒▓ WORLD OBJECTS — shared renderer for all placed assets ▓▒░ */}
      <WorldObjectsRenderer />

      {/* ░▒▓ PLAYER AVATAR — your body in the Oasis ▓▒░ */}
      {/* orbit: idle at spawn. fps: hidden. third-person: WASD moves, camera follows. */}
      {avatar3dUrl && !isViewMode && avatar3dUrl.endsWith('.vrm') && (
        <Suspense fallback={null}>
          <PlayerAvatar
            url={avatar3dUrl}
            controlMode={settings.controlMode}
            moveSpeed={settings.moveSpeed}
            mouseSensitivity={settings.mouseSensitivity}
          />
        </Suspense>
      )}

      {/* Empty state hint */}
      {isEmpty && (
        <Html position={[0, 2, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="text-center select-none pointer-events-none">
            <div className="text-4xl mb-2 opacity-30">🔥</div>
            <div className="text-sm text-gray-500 opacity-50">
              Open the Wizard Console to conjure
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

// ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓ॐ▓▓▓▓【R̸E̸A̸L̸M̸】▓▓▓▓ॐ▓▓▓▓【T̸E̸R̸R̸A̸I̸N̸】▓▓▓▓
