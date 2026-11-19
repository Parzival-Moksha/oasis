// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// UNIFIED THUMBNAIL QUEUE — Opt-in thumbnail builder
// ─═̷─═̷─📸─═̷─═̷─ Replaces the per-tab autoGenTriggered scatter ─═̷─═̷─📸─═̷─═̷─
//
// Scans ASSET_CATALOG + conjuredAssets. For every asset without a thumbnail,
// queues a render + upload. Concurrency=1 to avoid GPU contention. Updates
// the thumbnail store as it goes; consumers re-render with cache-bust
// suffixes when their asset goes 'ready'.
//
// Crafted scenes are NOT handled here — they have a separate generator
// (`useCraftedThumbnailGenerator`) that renders from procedural primitives
// (not GLB files) and mounts inside AssetsTab. The two pipelines do not
// share GPU rigs; both can run concurrently safely.
//
// On by default since 2026-11-19 (the owner, walkthrough 8:37: "the little thumbnail JPEG should auto-generate
// like on the first load. Like it should never happen."). It waits until the Wizard console's Catalog is first
// shown (requestCatalogThumbnails), renders only the catalog models with no picture on disk, the category in
// view first, and stays idle when nothing is missing. Off: localStorage oasis-thumbnail-queue = '0'; hosted
// visitors never render (the hosted server gets its pictures from the package).
// Survives a single mount, persists for the session.
// Cancellation: if the page unloads, in-flight renders are abandoned.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ASSET_CATALOG } from '../components/scene-lib/constants'
import { useOasisStore } from '../store/oasisStore'
import { useThumbnailStore } from '../lib/thumbnail-store'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const THUMB_SIZE = 192
const QUALITY = 0.82
const SCAN_INTERVAL_MS = 4000  // re-scan for new assets every 4s

interface RenderRig {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  loader: GLTFLoader
}

function shouldRunUnifiedThumbnailQueue(): boolean {
  if (process.env.NEXT_PUBLIC_OASIS_THUMBNAIL_QUEUE === '1') return true
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('thumbQueue') === '1') return true
    if (params.get('thumbQueue') === '0') return false
    if (window.localStorage.getItem('oasis-thumbnail-queue') === '0') return false
  } catch {
    return false
  }
  return process.env.NEXT_PUBLIC_OASIS_MODE !== 'hosted'
}

// ░▒▓ First sight: the catalog asks for its pictures; the ids it shows go first ▓▒░
const SEEN_EVENT = 'oasis:catalog-thumbnails-wanted'
let catalogSeen = false
let priorityIds: string[] = []

/** The catalog is on screen: start rendering missing pictures, these ids first. */
export function requestCatalogThumbnails(ids: string[]): void {
  priorityIds = ids
  if (catalogSeen) return
  catalogSeen = true
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SEEN_EVENT))
}

function waitForCatalogSeen(cancelled: () => boolean): Promise<boolean> {
  if (catalogSeen) return Promise.resolve(true)
  return new Promise(resolve => {
    const on = () => { window.removeEventListener(SEEN_EVENT, on); resolve(!cancelled()) }
    window.addEventListener(SEEN_EVENT, on)
  })
}

function createRig(): RenderRig {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  })
  renderer.setSize(THUMB_SIZE, THUMB_SIZE)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x2a2a3e)
  const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(2, 4, 3); scene.add(key)
  const fill = new THREE.DirectionalLight(0xaabbff, 1.2); fill.position.set(-3, 2, -1); scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffa500, 0.8); rim.position.set(0, -1, -3); scene.add(rim)
  scene.add(new THREE.AmbientLight(0x888899, 1.5))

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100)
  return { renderer, scene, camera, loader: new GLTFLoader() }
}

function disposeModel(model: THREE.Group) {
  model.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach(m => m?.dispose())
    }
  })
}

async function renderModelToBlob(rig: RenderRig, modelUrl: string): Promise<Blob | null> {
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    rig.loader.load(modelUrl, resolve, undefined, reject)
  })
  const model = gltf.scene
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  if (maxDim === 0) { disposeModel(model); return null }
  const center = box.getCenter(new THREE.Vector3())
  const fov = rig.camera.fov * (Math.PI / 180)
  const dist = maxDim / (2 * Math.tan(fov / 2)) * 1.5
  rig.camera.far = Math.max(100, dist * 3)
  rig.camera.updateProjectionMatrix()
  rig.camera.position.set(center.x + dist * 0.6, center.y + dist * 0.4, center.z + dist * 0.8)
  rig.camera.lookAt(center)
  rig.scene.add(model)
  rig.renderer.render(rig.scene, rig.camera)
  rig.scene.remove(model)
  const dataUrl = rig.renderer.domElement.toDataURL('image/jpeg', QUALITY)
  disposeModel(model)
  return (await fetch(dataUrl)).blob()
}

/** Single-mount orchestrator. Returns nothing — drives state through the store. */
export function useUnifiedThumbnailQueue() {
  const cancelledRef = useRef(false)
  const inFlightRef = useRef<Set<string>>(new Set())
  const failureCountsRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!shouldRunUnifiedThumbnailQueue()) return

    // ░▒▓ Global single-instance guard (StrictMode + HMR safe) ▓▒░
    // useRef is per-component-instance, which React 18 StrictMode double-
    // mounts on purpose and HMR can also double-mount across reloads. Pin
    // to globalThis so only one drain loop ever exists per process.
    const GLOBAL_KEY = '__oasis_thumb_queue_running__' as const
    if ((globalThis as Record<string, unknown>)[GLOBAL_KEY]) return
    ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = true
    cancelledRef.current = false
    const store = useThumbnailStore.getState()
    let rig: RenderRig | null = null

    // ░▒▓ Seed from server: which catalog thumbnails already exist on disk? ▓▒░
    // Without this list every model would look missing and be rendered again: no list, no rendering.
    async function seedExisting(): Promise<boolean> {
      try {
        const res = await fetch(`${OASIS_BASE}/api/catalog/thumbnail`)
        if (!res.ok) return false
        const data = await res.json() as { existing?: string[] }
        if (!Array.isArray(data.existing)) return false
        useThumbnailStore.getState().seedKnown(data.existing)
        return true
      } catch { return false }
    }

    async function processOne(id: string, modelUrl: string, putUrl: string): Promise<boolean> {
      if (cancelledRef.current) return false
      if (inFlightRef.current.has(id)) return false
      inFlightRef.current.add(id)
      useThumbnailStore.getState().markPending(id)
      if (!rig) rig = createRig()
      try {
        const blob = await renderModelToBlob(rig, modelUrl)
        if (!blob) {
          failureCountsRef.current[id] = (failureCountsRef.current[id] || 0) + 1
          useThumbnailStore.getState().markFailed(id)
          return false
        }
        const formData = new FormData()
        formData.append('thumbnail', blob, `${id}.jpg`)
        formData.append('id', id)
        const res = await fetch(putUrl, { method: 'PUT', body: formData })
        if (!res.ok) {
          failureCountsRef.current[id] = (failureCountsRef.current[id] || 0) + 1
          useThumbnailStore.getState().markFailed(id)
          return false
        }
        delete failureCountsRef.current[id]
        // Shown from memory this session: a production server may not serve the new file until it restarts.
        useThumbnailStore.getState().setLocalUrl(id, URL.createObjectURL(blob))
        useThumbnailStore.getState().markReady(id)
        return true
      } catch (err) {
        console.warn(`[ThumbQueue] failed for ${id}:`, err)
        failureCountsRef.current[id] = (failureCountsRef.current[id] || 0) + 1
        useThumbnailStore.getState().markFailed(id)
        return false
      } finally {
        inFlightRef.current.delete(id)
      }
    }

    async function drainQueue() {
      while (!cancelledRef.current) {
        const s = useThumbnailStore.getState()

        // Catalog scan
        const catalog = ASSET_CATALOG.filter(a => {
          const st = s.status[a.id]
          return !st || st === 'missing' || (st === 'failed' && (failureCountsRef.current[a.id] || 0) < 2)
        })

        // Conjured scan
        const conjured = useOasisStore.getState().conjuredAssets.filter(a => {
          if (a.status !== 'ready' || !a.glbPath || a.thumbnailUrl) return false
          const st = s.status[a.id]
          return !st || st === 'missing' || (st === 'failed' && (failureCountsRef.current[a.id] || 0) < 2)
        })

        const allTargets: Array<{ id: string; modelUrl: string; putUrl: string }> = [
          ...catalog.map(a => ({
            id: a.id,
            modelUrl: `${OASIS_BASE}${a.path}`,
            putUrl: `${OASIS_BASE}/api/catalog/thumbnail`,
          })),
          ...conjured.map(a => ({
            id: a.id,
            modelUrl: `${OASIS_BASE}${a.glbPath}`,
            putUrl: `${OASIS_BASE}/api/conjure/${a.id}/thumbnail`,
          })),
        ]

        if (allTargets.length === 0) {
          // Nothing to do — sleep and rescan.
          await new Promise(r => setTimeout(r, SCAN_INTERVAL_MS))
          continue
        }

        // The ids the catalog shows go first. Up to 50 before re-scanning (keeps store reactive to additions).
        const first = new Set(priorityIds)
        allTargets.sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)))
        const chunk = allTargets.slice(0, 50)
        for (const t of chunk) {
          if (cancelledRef.current) break
          await processOne(t.id, t.modelUrl, t.putUrl)
        }
      }
    }

    void (async () => {
      if (!(await waitForCatalogSeen(() => cancelledRef.current))) return
      if (!(await seedExisting())) return
      await drainQueue()
    })()

    return () => {
      cancelledRef.current = true
      try { rig?.renderer.dispose() } catch {}
      delete (globalThis as Record<string, unknown>)[GLOBAL_KEY]
    }
  }, [])
}
