// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// useThumbnailGenerator — Client-side GLB → JPEG thumbnail generator
// ─═̷─═̷─📸─═̷─═̷─ Every creation deserves a face in the gallery ─═̷─═̷─📸─═̷─═̷─
//
// Uses an offscreen WebGLRenderer + scene to render each GLB at a fixed
// camera angle, then converts the canvas to JPEG and uploads to the server.
//
// Two modes:
//   1. Conjured assets: auto-runs on mount, saves to /conjured/{id}_thumb.jpg
//   2. Catalog assets:  triggered manually, saves to /thumbs/{id}.jpg
//
// Runs in the background, one at a time, to avoid GPU contention.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useRef, useCallback, useState } from 'react'
import { useOasisStore } from '../store/oasisStore'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ASSET_CATALOG } from '../components/scene-lib/constants'
import type { CraftedScene, CraftedPrimitive, PrimitiveType } from '../lib/conjure/types'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const THUMB_SIZE = 256                              // px — square thumbnail
const QUALITY = 0.85                                // JPEG quality
const MAX_PER_SESSION = 50                          // conjured assets per session cap

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED RENDERING RIG — The Portrait Studio
// ─═̷─═̷─ One renderer to rule them all, one lighting rig to find them ─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

function createRenderingRig() {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setSize(THUMB_SIZE, THUMB_SIZE)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x2a2a3e)

  // ░▒▓ Studio lighting — bright 3-point + strong ambient ▓▒░
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5)
  keyLight.position.set(2, 4, 3)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xaabbff, 1.2)
  fillLight.position.set(-3, 2, -1)
  scene.add(fillLight)
  const rimLight = new THREE.DirectionalLight(0xffa500, 0.8)
  rimLight.position.set(0, -1, -3)
  scene.add(rimLight)
  scene.add(new THREE.AmbientLight(0x888899, 1.5))

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100)
  const loader = new GLTFLoader()

  return { renderer, scene, camera, loader }
}

/** Render a single model and return JPEG blob */
async function renderModelToBlob(
  rig: ReturnType<typeof createRenderingRig>,
  modelUrl: string,
): Promise<Blob | null> {
  const { renderer, scene, camera, loader } = rig

  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    loader.load(modelUrl, resolve, undefined, reject)
  })

  const model = gltf.scene
  const box = new THREE.Box3().setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)

  if (maxDim === 0) { disposeModel(model); return null }

  const fov = camera.fov * (Math.PI / 180)
  const dist = maxDim / (2 * Math.tan(fov / 2)) * 1.5

  // ░▒▓ Dynamic far plane — large models need camera further than default far=100 ▓▒░
  camera.far = Math.max(100, dist * 3)
  camera.updateProjectionMatrix()

  camera.position.set(
    center.x + dist * 0.6,
    center.y + dist * 0.4,
    center.z + dist * 0.8,
  )
  camera.lookAt(center)

  scene.add(model)
  renderer.render(scene, camera)
  scene.remove(model)

  const dataUrl = renderer.domElement.toDataURL('image/jpeg', QUALITY)
  disposeModel(model)

  return (await fetch(dataUrl)).blob()
}

function disposeModel(model: THREE.Group) {
  model.traverse(child => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      mesh.geometry?.dispose()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach(m => m?.dispose())
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONJURED ASSET THUMBNAILS — auto-generates on mount
// ═══════════════════════════════════════════════════════════════════════════════

export function useThumbnailGenerator() {
  const runningRef = useRef(false)

  useEffect(() => {
    if (runningRef.current) return
    runningRef.current = true

    generateConjuredThumbnails().finally(() => { runningRef.current = false })
  }, [])
}

async function generateConjuredThumbnails() {
  const assets = useOasisStore.getState().conjuredAssets
  const needsThumb = assets.filter(a =>
    a.status === 'ready' && a.glbPath && !a.thumbnailUrl
  ).slice(0, MAX_PER_SESSION)

  if (needsThumb.length === 0) return

  console.log(`[Forge:Thumbs] Generating ${needsThumb.length} conjured thumbnails...`)

  const rig = createRenderingRig()
  let generated = 0

  for (const asset of needsThumb) {
    try {
      const blob = await renderModelToBlob(rig, `${OASIS_BASE}${asset.glbPath}`)
      if (!blob) continue

      const formData = new FormData()
      formData.append('thumbnail', blob, `${asset.id}_thumb.jpg`)

      const res = await fetch(`${OASIS_BASE}/api/conjure/${asset.id}/thumbnail`, {
        method: 'PUT',
        body: formData,
      })

      if (res.ok) {
        const data = await res.json()
        useOasisStore.getState().updateConjuredAsset(asset.id, {
          thumbnailUrl: data.thumbnailUrl,
        })
        generated++
        console.log(`[Forge:Thumbs] Generated ${asset.id}`)
      }
    } catch (err) {
      console.warn(`[Forge:Thumbs] Failed for ${asset.id}:`, err)
    }
  }

  rig.renderer.dispose()
  console.log(`[Forge:Thumbs] Done: ${generated}/${needsThumb.length} conjured thumbnails`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATALOG ASSET THUMBNAILS — renders 100+ library models on demand
// ─═̷─═̷─ The yearbook photographer visits the whole school ─═̷─═̷─
//
// Returns { generate, progress, total, done, running }
// Call generate() to start. Progress updates in real time.
// Saves to /thumbs/{assetId}.jpg via PUT /api/catalog/thumbnail
// ═══════════════════════════════════════════════════════════════════════════════

export function useCatalogThumbnailGenerator() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, skipped: 0 })
  const runningRef = useRef(false)

  const generate = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)

    try {
      // ░▒▓ Check which catalog assets already have thumbnails on disk ▓▒░
      const checkRes = await fetch(`${OASIS_BASE}/api/catalog/thumbnail`)
      const existing: string[] = checkRes.ok ? (await checkRes.json()).existing : []
      const existingSet = new Set(existing)

      const toGenerate = ASSET_CATALOG.filter(a => !existingSet.has(a.id))
      setProgress({ done: 0, total: toGenerate.length, skipped: ASSET_CATALOG.length - toGenerate.length })

      if (toGenerate.length === 0) {
        console.log(`[Forge:Catalog] All ${ASSET_CATALOG.length} catalog thumbnails exist`)
        return
      }

      console.log(`[Forge:Catalog] Generating ${toGenerate.length} catalog thumbnails (${existingSet.size} already exist)...`)

      const rig = createRenderingRig()
      let done = 0

      for (const asset of toGenerate) {
        try {
          const modelUrl = `${OASIS_BASE}${asset.path}`
          const blob = await renderModelToBlob(rig, modelUrl)
          if (!blob) { done++; setProgress(p => ({ ...p, done })); continue }

          const formData = new FormData()
          formData.append('thumbnail', blob, `${asset.id}.jpg`)
          formData.append('id', asset.id)

          await fetch(`${OASIS_BASE}/api/catalog/thumbnail`, {
            method: 'PUT',
            body: formData,
          })

          done++
          setProgress(p => ({ ...p, done }))

          if (done % 10 === 0) {
            console.log(`[Forge:Catalog] ${done}/${toGenerate.length}...`)
          }
        } catch (err) {
          console.warn(`[Forge:Catalog] Failed for ${asset.id}:`, err)
          done++
          setProgress(p => ({ ...p, done }))
        }
      }

      rig.renderer.dispose()
      console.log(`[Forge:Catalog] Done: ${done}/${toGenerate.length} catalog thumbnails generated`)
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [])

  return { generate, running, ...progress }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRAFTED SCENE THUMBNAILS — JSON primitives → JPEG portraits
// ─═̷─═̷─🎨─═̷─═̷─ The offscreen sculptor's darkroom ─═̷─═̷─🎨─═̷─═̷─
//
// Mirrors CraftedSceneRenderer.tsx geometry + material setup EXACTLY,
// but uses imperative Three.js (no React/R3F) since we're off-canvas.
// ═══════════════════════════════════════════════════════════════════════════════

/** Imperative geometry factory — mirrors PrimitiveGeometry from CraftedSceneRenderer.tsx */
function createPrimitiveGeometry(type: PrimitiveType): THREE.BufferGeometry {
  switch (type) {
    case 'box':      return new THREE.BoxGeometry(1, 1, 1)
    case 'sphere':   return new THREE.SphereGeometry(0.5, 32, 32)
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
    case 'cone':     return new THREE.ConeGeometry(0.5, 1, 32)
    case 'torus':    return new THREE.TorusGeometry(0.4, 0.15, 16, 32)
    case 'plane':    return new THREE.PlaneGeometry(1, 1)
    case 'capsule':  return new THREE.CapsuleGeometry(0.3, 0.5, 8, 16)
    default:         return new THREE.BoxGeometry(1, 1, 1)
  }
}

/** Build a Three.js mesh from a CraftedPrimitive — mirrors CraftedPrimitiveMesh exactly */
function createPrimitiveMesh(p: CraftedPrimitive): THREE.Mesh {
  const geo = createPrimitiveGeometry(p.type)
  const hasOpacity = p.opacity !== undefined && p.opacity < 1
  const mat = new THREE.MeshStandardMaterial({
    color: p.color,
    metalness: p.metalness ?? 0,
    roughness: p.roughness ?? 0.7,
    emissive: new THREE.Color(p.emissive || '#000000'),
    emissiveIntensity: p.emissiveIntensity ?? 0,
    transparent: hasOpacity,
    opacity: p.opacity ?? 1,
    depthWrite: !hasOpacity,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(...p.position)
  if (p.rotation) mesh.rotation.set(...p.rotation)
  mesh.scale.set(...p.scale)
  return mesh
}

/** Render a CraftedScene's primitives to a JPEG blob — the darkroom's main exposure */
async function renderCraftedSceneToBlob(
  rig: ReturnType<typeof createRenderingRig>,
  objects: CraftedPrimitive[],
): Promise<Blob | null> {
  const { renderer, scene, camera } = rig

  // ░▒▓ Build the scene imperatively — no React, no R3F, pure Three.js ▓▒░
  const group = new THREE.Group()
  for (const p of objects) {
    group.add(createPrimitiveMesh(p))
  }

  // Auto-frame: fit camera around the entire composition
  const box = new THREE.Box3().setFromObject(group)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)

  if (maxDim === 0) {
    disposeCraftedGroup(group)
    return null
  }

  const fov = camera.fov * (Math.PI / 180)
  const dist = maxDim / (2 * Math.tan(fov / 2)) * 1.5

  // ░▒▓ Dynamic far plane — Giant Mountain Range (87u bounding box) was getting
  //     clipped at camera.far=100 when the camera needed to be 179u away ▓▒░
  camera.far = Math.max(100, dist * 3)
  camera.updateProjectionMatrix()

  camera.position.set(
    center.x + dist * 0.6,
    center.y + dist * 0.4,
    center.z + dist * 0.8,
  )
  camera.lookAt(center)

  scene.add(group)
  renderer.render(scene, camera)
  scene.remove(group)

  const dataUrl = renderer.domElement.toDataURL('image/jpeg', QUALITY)
  disposeCraftedGroup(group)

  return (await fetch(dataUrl)).blob()
}

function disposeCraftedGroup(group: THREE.Group) {
  group.traverse(child => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      mesh.geometry?.dispose()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach(m => m?.dispose())
    }
  })
}

/** Fire-and-forget: generate a single crafted scene thumbnail + upload + update store + library */
export async function generateSingleCraftedThumbnail(scene: CraftedScene): Promise<void> {
  try {
    const rig = createRenderingRig()
    const blob = await renderCraftedSceneToBlob(rig, scene.objects)
    rig.renderer.dispose()

    if (!blob) return

    const formData = new FormData()
    formData.append('thumbnail', blob, `${scene.id}.jpg`)
    formData.append('id', scene.id)

    const res = await fetch(`${OASIS_BASE}/api/craft/thumbnail`, {
      method: 'PUT',
      body: formData,
    })

    if (res.ok) {
      const data = await res.json()
      useOasisStore.getState().updateCraftedScene(scene.id, {
        thumbnailUrl: data.thumbnailUrl,
      })
      // Also persist to global scene library so it survives world switches
      persistThumbnailToLibrary(scene.id, data.thumbnailUrl)
      console.log(`[Forge:CraftedThumb] Generated thumbnail for "${scene.name}"`)
    }
  } catch (err) {
    console.warn(`[Forge:CraftedThumb] Failed for ${scene.id}:`, err)
  }
}

/** Persist thumbnailUrl to the global scene library JSON */
async function persistThumbnailToLibrary(sceneId: string, thumbnailUrl: string): Promise<void> {
  try {
    const libRes = await fetch(`${OASIS_BASE}/api/worlds/scene-library`)
    if (!libRes.ok) return
    const library: CraftedScene[] = await libRes.json()
    const scene = library.find(s => s.id === sceneId)
    if (!scene || scene.thumbnailUrl) return // already has one or not in library
    scene.thumbnailUrl = thumbnailUrl
    await fetch(`${OASIS_BASE}/api/worlds/scene-library`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(library),
    })
  } catch { /* non-critical — display falls back to computed URL */ }
}

/** Mount-time hook — catches any crafted scenes that don't have thumbnails yet */
export function useCraftedThumbnailGenerator() {
  const runningRef = useRef(false)

  useEffect(() => {
    if (runningRef.current) return
    runningRef.current = true

    generateCraftedThumbnails().finally(() => { runningRef.current = false })
  }, [])
}

async function generateCraftedThumbnails() {
  // Merge per-world + global library scenes, dedupe by ID
  const perWorld = useOasisStore.getState().craftedScenes
  const library = useOasisStore.getState().sceneLibrary
  const seen = new Set<string>()
  const all: CraftedScene[] = []
  for (const s of [...perWorld, ...library]) {
    if (!seen.has(s.id)) { seen.add(s.id); all.push(s) }
  }

  const needsThumb = all.filter(s => !s.thumbnailUrl).slice(0, MAX_PER_SESSION)

  if (needsThumb.length === 0) return

  console.log(`[Forge:CraftedThumb] Generating ${needsThumb.length} crafted thumbnails...`)

  const rig = createRenderingRig()
  let generated = 0

  for (const scene of needsThumb) {
    try {
      const blob = await renderCraftedSceneToBlob(rig, scene.objects)
      if (!blob) continue

      const formData = new FormData()
      formData.append('thumbnail', blob, `${scene.id}.jpg`)
      formData.append('id', scene.id)

      const res = await fetch(`${OASIS_BASE}/api/craft/thumbnail`, {
        method: 'PUT',
        body: formData,
      })

      if (res.ok) {
        const data = await res.json()
        useOasisStore.getState().updateCraftedScene(scene.id, {
          thumbnailUrl: data.thumbnailUrl,
        })
        // Persist to global library
        persistThumbnailToLibrary(scene.id, data.thumbnailUrl)
        generated++
      }
    } catch (err) {
      console.warn(`[Forge:CraftedThumb] Failed for ${scene.id}:`, err)
    }
  }

  rig.renderer.dispose()
  console.log(`[Forge:CraftedThumb] Done: ${generated}/${needsThumb.length} crafted thumbnails`)
}

// ▓▓▓▓【T̸H̸U̸M̸B̸S̸】▓▓▓▓ॐ▓▓▓▓【D̸A̸R̸K̸R̸O̸O̸M̸】▓▓▓▓
