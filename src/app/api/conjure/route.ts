// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Conjure API Route
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   ╔═══════════════════════════════════════════════════════════════════╗
//   ║                                                                   ║
//   ║    POST /api/conjure  — Speak a prompt, ignite the furnace        ║
//   ║    GET  /api/conjure  — See all that has been conjured            ║
//   ║                                                                   ║
//   ║    This is the threshold between language and geometry.           ║
//   ║    Words enter. Polygons emerge.                                  ║
//   ║                                                                   ║
//   ║    "In the beginning was the Word,                                ║
//   ║     and the Word was with GLB,                                    ║
//   ║     and the Word was GLB."                                        ║
//   ║                                     — Gospel of The Forge, 1:1    ║
//   ║                                                                   ║
//   ╚═══════════════════════════════════════════════════════════════════╝
//
// ░▒▓█ CONJURE ROUTE █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import { getProvider } from '@/lib/conjure/providers'
import { addAsset, getAssetById, getAllAssets, updateAsset, markStaleAssets, rescueOrphanGlbs } from '@/lib/conjure/registry'
import { MeshyClient } from '@/lib/conjure/meshy'
import { TripoClient } from '@/lib/conjure/tripo'
import { PROVIDERS } from '@/lib/conjure/types'
import type { ConjureRequest, ConjuredAsset, ProviderName, ConjureStatus, RigResult } from '@/lib/conjure/types'

// ═══════════════════════════════════════════════════════════════════════════
// ID GENERATION — every conjured object gets a unique soul-stamp
// ═══════════════════════════════════════════════════════════════════════════

function generateAssetId(): string {
  return 'conj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// ═══════════════════════════════════════════════════════════════════════════
// CONJURED OUTPUT DIRECTORY — ensure public/conjured/ exists
// GLBs land here so Next.js can serve them as static files
// ═══════════════════════════════════════════════════════════════════════════

function ensureConjuredDir(): string {
  const dir = join(process.cwd(), 'public', 'conjured')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log('[Forge] Created public/conjured/ directory')
  }
  return dir
}

// ═══════════════════════════════════════════════════════════════════════════
// POLL INTERVAL — how often we ask the provider "is it done yet?"
// Like a child on a road trip: "Are we there yet? Are we there yet?"
// ═══════════════════════════════════════════════════════════════════════════

const POLL_INTERVAL_MS = 5000

// ═══════════════════════════════════════════════════════════════════════════
// THUMBNAIL PERSISTENCE — download external thumbnails to local JPEG
// Provider CDN URLs expire (Meshy: 3 days). Save locally so gallery keeps
// working forever. File: public/conjured/{id}_thumb.jpg
// ═══════════════════════════════════════════════════════════════════════════

async function persistThumbnail(assetId: string, externalUrl: string): Promise<string | null> {
  try {
    if (!externalUrl || !externalUrl.startsWith('http')) return null
    const dir = ensureConjuredDir()
    const localPath = join(dir, `${assetId}_thumb.jpg`)
    if (existsSync(localPath)) return `/conjured/${assetId}_thumb.jpg`  // already saved

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    const res = await fetch(externalUrl, { signal: controller.signal }).finally(() => clearTimeout(timer))
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > 10 * 1024 * 1024) return null  // 10MB max for provider thumbnails
    writeFileSync(localPath, buffer)
    console.log(`[Forge] Thumbnail saved: ${assetId} (${(buffer.length / 1024).toFixed(0)} KB)`)
    return `/conjured/${assetId}_thumb.jpg`
  } catch (err) {
    console.warn(`[Forge] Thumbnail download failed for ${assetId}:`, err)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ORPHAN RECOVERY — Resume pipelines that died when the dev server restarted
//
// When Next.js hot-reloads or the server crashes, fire-and-forget pipelines
// vanish mid-flight. The registry still has the asset with status='generating'
// and a valid providerTaskId, but nobody's polling anymore.
//
// This function runs once on the first GET /api/conjure (page load).
// It finds orphaned non-terminal assets, checks the provider for their
// current status, and resumes from Phase 2 (polling → download → ready).
//
// Like a search party finding lost travelers and guiding them home.
// ═══════════════════════════════════════════════════════════════════════════

const ORPHAN_RECOVERY_KEY = '__forge_orphan_recovery_done__'

function resumeOrphanedPipelines(): void {
  // Only run once per server lifetime — same pattern as rescueOrphanGlbs
  if ((globalThis as Record<string, unknown>)[ORPHAN_RECOVERY_KEY]) return
  ;(globalThis as Record<string, unknown>)[ORPHAN_RECOVERY_KEY] = true

  const TERMINAL = ['ready', 'failed']
  const assets = getAllAssets()
  const orphans = assets.filter(a => !TERMINAL.includes(a.status) && a.providerTaskId)

  if (orphans.length === 0) return

  console.log(`[Forge:Recovery] Found ${orphans.length} orphaned pipeline(s) — resuming...`)

  for (const orphan of orphans) {
    console.log(`[Forge:Recovery] Resuming ${orphan.id} (${orphan.provider}/${orphan.tier}, task: ${orphan.providerTaskId})`)
    resumeOrphanPipeline(orphan)
      .catch(err => console.error(`[Forge:Recovery] ${orphan.id} resume failed:`, err))
  }
}

async function resumeOrphanPipeline(asset: ConjuredAsset): Promise<void> {
  const startTime = Date.now()
  try {
    const client = getProvider(asset.provider)
    updateAsset(asset.id, { status: 'generating' })

    // ░▒▓ Pick up from Phase 2 — poll the existing provider task ▓▒░
    let terminal = false
    while (!terminal) {
      await sleep(POLL_INTERVAL_MS)

      const statusResult = await client.checkStatus(asset.providerTaskId)
      console.log(`[Forge:Recovery] ${asset.id} — status: ${statusResult.status}, progress: ${statusResult.progress}%`)

      const updates: Partial<ConjuredAsset> = { progress: statusResult.progress }

      if (statusResult.thumbnailUrl) {
        const localThumb = await persistThumbnail(asset.id, statusResult.thumbnailUrl)
        updates.thumbnailUrl = localThumb || statusResult.thumbnailUrl
      }

      if (statusResult.status === 'ready' && statusResult.resultUrl) {
        updates.status = 'downloading'
        updates.progress = 95
        updateAsset(asset.id, updates)

        console.log(`[Forge:Recovery] ${asset.id} — downloading result...`)
        const conjuredDir = ensureConjuredDir()
        const destPath = join(conjuredDir, `${asset.id}.glb`)

        try {
          await client.downloadResult(statusResult.resultUrl, destPath)
        } catch (dlErr) {
          const dlMsg = dlErr instanceof Error ? dlErr.message : String(dlErr)
          console.error(`[Forge:Recovery] ${asset.id} download failed: ${dlMsg}`)
          updateAsset(asset.id, { status: 'failed', progress: 0, errorMessage: `Download failed: ${dlMsg}`, completedAt: new Date().toISOString() })
          return
        }

        const elapsed = Date.now() - startTime
        const fileSizeBytes = existsSync(destPath) ? statSync(destPath).size : undefined
        updateAsset(asset.id, {
          status: 'ready', progress: 100,
          glbPath: `/conjured/${asset.id}.glb`,
          completedAt: new Date().toISOString(),
          metadata: { generationTimeMs: elapsed, fileSizeBytes },
        })
        console.log(`[Forge:Recovery] ${asset.id} RECOVERED in ${(elapsed / 1000).toFixed(1)}s (${fileSizeBytes ? (fileSizeBytes / 1024).toFixed(0) + ' KB' : 'size unknown'})`)
        terminal = true

      } else if (statusResult.status === 'ready' && !statusResult.resultUrl) {
        updateAsset(asset.id, { status: 'failed', progress: 100, errorMessage: 'Provider completed but returned no download URL', completedAt: new Date().toISOString() })
        terminal = true

      } else if (statusResult.status === 'failed') {
        updateAsset(asset.id, { status: 'failed', progress: 0, errorMessage: 'Provider returned failed status', completedAt: new Date().toISOString() })
        terminal = true

      } else {
        updateAsset(asset.id, updates)
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[Forge:Recovery] ${asset.id} pipeline error:`, errorMessage)
    updateAsset(asset.id, { status: 'failed', progress: 0, errorMessage, completedAt: new Date().toISOString() })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ASYNC GENERATION PIPELINE
// Fire-and-forget: starts the provider, polls until terminal, downloads GLB.
// This runs OUTSIDE the request lifecycle — the POST returns immediately.
//
// The flow:
//   queued → generating → downloading → ready
//                └── or ──→ failed
//
// A mother sends her child into the world and watches from the registry.
// ═══════════════════════════════════════════════════════════════════════════

async function runConjurationPipeline(assetId: string, prompt: string, provider: ProviderName, tier: string, genOptions?: Record<string, unknown>, pipelineOptions?: { autoRig?: boolean; autoAnimate?: boolean; animationPreset?: string }): Promise<void> {
  const startTime = Date.now()

  try {
    // ░▒▓ Phase 1: Start generation with the provider ▓▒░
    console.log(`[Forge] Pipeline started for ${assetId} via ${provider}/${tier}`)
    updateAsset(assetId, { status: 'generating', progress: 0 })

    const client = getProvider(provider)
    const { taskId } = await client.startGeneration(prompt, tier, genOptions as never)

    // Store the provider's task ID so we can track it
    updateAsset(assetId, { providerTaskId: taskId })
    console.log(`[Forge] Provider task ID: ${taskId}`)

    // ░▒▓ Phase 2: Poll until terminal state ▓▒░
    let terminal = false
    while (!terminal) {
      await sleep(POLL_INTERVAL_MS)

      const statusResult = await client.checkStatus(taskId)
      console.log(`[Forge] ${assetId} — status: ${statusResult.status}, progress: ${statusResult.progress}%`)

      // Update registry with latest progress
      const updates: Partial<ConjuredAsset> = {
        progress: statusResult.progress,
      }

      if (statusResult.thumbnailUrl) {
        // ░▒▓ Persist thumbnail locally — CDN URLs expire, local JPEGs don't ▓▒░
        const localThumb = await persistThumbnail(assetId, statusResult.thumbnailUrl)
        updates.thumbnailUrl = localThumb || statusResult.thumbnailUrl
      }

      if (statusResult.status === 'ready' && statusResult.resultUrl) {
        // ░▒▓ Phase 3: Download the GLB ▓▒░
        updates.status = 'downloading'
        updates.progress = 95
        updateAsset(assetId, updates)

        console.log(`[Forge] ${assetId} — downloading result...`)
        const conjuredDir = ensureConjuredDir()
        const destPath = join(conjuredDir, `${assetId}.glb`)

        try {
          await client.downloadResult(statusResult.resultUrl, destPath)
        } catch (dlErr) {
          // ░▒▓ Download failed — mark as failed, don't stall ▓▒░
          const dlMsg = dlErr instanceof Error ? dlErr.message : String(dlErr)
          console.error(`[Forge] ${assetId} download failed: ${dlMsg}`)
          updateAsset(assetId, {
            status: 'failed',
            progress: 0,
            errorMessage: `Download failed: ${dlMsg}`,
            completedAt: new Date().toISOString(),
          })
          terminal = true
          continue
        }

        // ░▒▓ Phase 4: Mark as ready — the word became flesh (well, GLB) ▓▒░
        const elapsed = Date.now() - startTime
        const fileSizeBytes = existsSync(destPath) ? statSync(destPath).size : undefined
        updateAsset(assetId, {
          status: 'ready',
          progress: 100,
          glbPath: `/conjured/${assetId}.glb`,
          completedAt: new Date().toISOString(),
          metadata: {
            generationTimeMs: elapsed,
            fileSizeBytes,
          },
        })

        console.log(`[Forge] ${assetId} READY in ${(elapsed / 1000).toFixed(1)}s (${fileSizeBytes ? (fileSizeBytes / 1024).toFixed(0) + ' KB' : 'size unknown'})`)
        terminal = true

        // ░▒▓ AUTO-PIPELINE — chain rig → animate if flags are set ▓▒░
        if (pipelineOptions?.autoRig) {
          runAutoRigPipeline(assetId, provider, taskId, pipelineOptions)
            .catch(err => console.error(`[Forge:AutoRig] Pipeline crash for ${assetId}:`, err))
        }

      } else if (statusResult.status === 'ready' && !statusResult.resultUrl) {
        // ░▒▓ Provider says done but gave no download URL — can't recover ▓▒░
        console.error(`[Forge] ${assetId} — provider returned ready but NO result URL!`)
        updateAsset(assetId, {
          status: 'failed',
          progress: 100,
          errorMessage: 'Provider completed but returned no download URL',
          completedAt: new Date().toISOString(),
        })
        terminal = true

      } else if (statusResult.status === 'failed') {
        // ░▒▓ Failure — the furnace went cold ▓▒░
        updateAsset(assetId, {
          status: 'failed',
          progress: 0,
          errorMessage: 'Provider returned failed status',
          completedAt: new Date().toISOString(),
        })

        console.log(`[Forge] ${assetId} FAILED`)
        terminal = true

      } else {
        // ░▒▓ Still cooking — update progress and keep polling ▓▒░
        updateAsset(assetId, updates)
      }
    }

  } catch (err) {
    // ░▒▓ Catch-all: any unhandled error marks the asset as failed ▓▒░
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[Forge] ${assetId} pipeline error:`, errorMessage)

    updateAsset(assetId, {
      status: 'failed',
      progress: 0,
      errorMessage,
      completedAt: new Date().toISOString(),
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-PIPELINE — Chain rig → animate after generation completes
// ░▒▓ Creates child assets in the registry, polls until terminal ▓▒░
// ═══════════════════════════════════════════════════════════════════════════

async function runAutoRigPipeline(
  parentAssetId: string,
  provider: ProviderName,
  parentProviderTaskId: string,
  pipelineOptions: { autoRig?: boolean; autoAnimate?: boolean; animationPreset?: string },
): Promise<void> {
  const parentAsset = getAssetById(parentAssetId)
  if (!parentAsset) return

  // ░▒▓ PHASE 1: Auto-rig ▓▒░
  const rigId = generateAssetId()
  const rigAsset: ConjuredAsset = {
    id: rigId,
    prompt: `[Rigging] ${parentAsset.prompt}`,
    displayName: `rigged ${provider}`,
    provider,
    tier: 'rig',
    providerTaskId: '',
    status: 'queued' as ConjureStatus,
    progress: 0,
    position: [...parentAsset.position] as [number, number, number],
    scale: parentAsset.scale,
    rotation: [...parentAsset.rotation] as [number, number, number],
    createdAt: new Date().toISOString(),
    sourceAssetId: parentAssetId,
    action: 'rig',
    characterMode: true,
    // Pass animate flags forward so we can chain after rig
    ...(pipelineOptions.autoAnimate ? { autoAnimate: true, animationPreset: pipelineOptions.animationPreset } : {}),
  }
  addAsset(rigAsset)
  console.log(`[Forge:AutoRig] Created rig asset ${rigId} from parent ${parentAssetId}`)

  try {
    updateAsset(rigId, { status: 'generating', progress: 0 })
    const client = provider === 'meshy' ? new MeshyClient() : new TripoClient()
    const { taskId: rigTaskId } = await client.rig(parentProviderTaskId)
    updateAsset(rigId, { providerTaskId: rigTaskId })

    // Poll rig until terminal
    let rigTerminal = false
    while (!rigTerminal) {
      await sleep(POLL_INTERVAL_MS)
      const result = await client.checkRigStatus(rigTaskId)
      console.log(`[Forge:AutoRig] ${rigId} rig — ${result.status} ${result.progress}%`)

      if (result.status === 'ready' && result.resultUrl) {
        updateAsset(rigId, { status: 'downloading', progress: 95 })
        const conjuredDir = ensureConjuredDir()
        const destPath = join(conjuredDir, `${rigId}.glb`)
        await client.downloadResult(result.resultUrl, destPath)

        const fileSizeBytes = existsSync(destPath) ? statSync(destPath).size : undefined
        updateAsset(rigId, {
          status: 'ready', progress: 100,
          glbPath: `/conjured/${rigId}.glb`,
          completedAt: new Date().toISOString(),
          metadata: { fileSizeBytes },
        })
        console.log(`[Forge:AutoRig] ${rigId} RIGGED`)
        rigTerminal = true

        // ░▒▓ PHASE 2: Auto-animate if flagged ▓▒░
        if (pipelineOptions.autoAnimate && pipelineOptions.animationPreset) {
          runAutoAnimatePipeline(rigId, provider, rigTaskId, pipelineOptions.animationPreset, parentAsset.prompt, result.rigResult)
            .catch(err => console.error(`[Forge:AutoAnimate] Pipeline crash for ${rigId}:`, err))
        }
      } else if (result.status === 'failed') {
        updateAsset(rigId, { status: 'failed', progress: 0, errorMessage: 'Auto-rig failed', completedAt: new Date().toISOString() })
        rigTerminal = true
      } else {
        updateAsset(rigId, { progress: result.progress })
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Forge:AutoRig] ${rigId} error:`, msg)
    updateAsset(rigId, { status: 'failed', progress: 0, errorMessage: msg, completedAt: new Date().toISOString() })
  }
}

async function runAutoAnimatePipeline(
  riggedAssetId: string,
  provider: ProviderName,
  riggedProviderTaskId: string,
  animationPreset: string,
  originalPrompt: string,
  rigResult?: RigResult,
): Promise<void> {
  // ░▒▓ Meshy free animations — walk AND run GLBs from the rig result ▓▒░
  // The base rigged GLB is T-pose only. The actual walking/running models are at
  // rigResult.walkAnimUrl and rigResult.runAnimUrl. Download BOTH as separate assets.
  if (provider === 'meshy' && animationPreset.startsWith('free:')) {
    const riggedAsset = getAssetById(riggedAssetId)
    const client = new MeshyClient()
    const conjuredDir = ensureConjuredDir()

    // ░▒▓ CONSOLIDATION — only download walk animation to reduce asset clutter ▓▒░
    // Previously downloaded both walk + run as separate assets (4 total per character).
    // For beta, just the walking model is enough. Run can be added later per-request.
    const freeAnims: { type: string; label: string; url: string | undefined }[] = [
      { type: 'walk', label: 'Walking', url: rigResult?.walkAnimUrl },
    ]

    for (const anim of freeAnims) {
      if (!anim.url) {
        console.warn(`[Forge:AutoAnimate] Meshy free:${anim.type} — no URL in rig result, skipping`)
        continue
      }

      const animId = generateAssetId()
      addAsset({
        id: animId,
        prompt: `[${anim.label}] ${originalPrompt}`,
        provider,
        tier: 'animate',
        providerTaskId: '',
        status: 'downloading' as ConjureStatus,
        progress: 90,
        position: riggedAsset ? [...riggedAsset.position] as [number, number, number] : [0, 0, 0],
        scale: riggedAsset?.scale || 1,
        rotation: riggedAsset ? [...riggedAsset.rotation] as [number, number, number] : [0, 0, 0],
        createdAt: new Date().toISOString(),
        sourceAssetId: riggedAssetId,
        action: 'animate',
        characterMode: true,
      })

      console.log(`[Forge:AutoAnimate] Downloading Meshy free:${anim.type} GLB → ${animId}`)
      try {
        const destPath = join(conjuredDir, `${animId}.glb`)
        await client.downloadResult(anim.url, destPath)

        const fileSizeBytes = existsSync(destPath) ? statSync(destPath).size : undefined
        updateAsset(animId, {
          status: 'ready', progress: 100,
          glbPath: `/conjured/${animId}.glb`,
          completedAt: new Date().toISOString(),
          metadata: { fileSizeBytes },
        })
        console.log(`[Forge:AutoAnimate] ${animId} Meshy free:${anim.type} READY (${fileSizeBytes ? (fileSizeBytes / 1024).toFixed(0) + ' KB' : 'size unknown'})`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[Forge:AutoAnimate] ${animId} free:${anim.type} download failed:`, msg)
        updateAsset(animId, { status: 'failed', progress: 0, errorMessage: msg, completedAt: new Date().toISOString() })
      }
    }
    return
  }

  // ░▒▓ Tripo/paid Meshy animations — start a provider animate task ▓▒░
  // Tripo: multi-preset → one GLB with idle+walk+run clips for click-to-switch UX
  // Meshy paid: single preset per API call (different architecture)
  // ░▒▓ Tripo only supports SINGLE animation preset per task (animations: [] is NOT a valid API param).
  // Multi-preset array caused tasks to stall at 99% then fail. Use "preset:walk" as default.
  // Additional animations come from external Mixamo FBX files applied client-side.
  const resolvedPreset: string = (provider === 'tripo')
    ? 'walk'  // auto-prefixed to "preset:walk" by tripo.ts normalize()
    : animationPreset

  const animId = generateAssetId()
  const riggedAsset = getAssetById(riggedAssetId)
  const animAsset: ConjuredAsset = {
    id: animId,
    prompt: `[Animated] ${originalPrompt}`,
    provider,
    tier: 'animate',
    providerTaskId: '',
    status: 'queued' as ConjureStatus,
    progress: 0,
    position: riggedAsset ? [...riggedAsset.position] as [number, number, number] : [0, 0, 0],
    scale: riggedAsset?.scale || 1,
    rotation: riggedAsset ? [...riggedAsset.rotation] as [number, number, number] : [0, 0, 0],
    createdAt: new Date().toISOString(),
    sourceAssetId: riggedAssetId,
    action: 'animate',
    characterMode: true,
  }
  addAsset(animAsset)
  console.log(`[Forge:AutoAnimate] Created animate asset ${animId} from rig ${riggedAssetId} (preset: ${resolvedPreset})`)

  try {
    updateAsset(animId, { status: 'generating', progress: 0 })
    const client = provider === 'meshy' ? new MeshyClient() : new TripoClient()
    const { taskId: animTaskId } = await client.animate(riggedProviderTaskId, resolvedPreset)
    updateAsset(animId, { providerTaskId: animTaskId })

    let animTerminal = false
    while (!animTerminal) {
      await sleep(POLL_INTERVAL_MS)
      const result = await client.checkAnimateStatus(animTaskId)
      console.log(`[Forge:AutoAnimate] ${animId} animate — ${result.status} ${result.progress}%`)

      if (result.status === 'ready' && result.resultUrl) {
        updateAsset(animId, { status: 'downloading', progress: 95 })
        const conjuredDir = ensureConjuredDir()
        const destPath = join(conjuredDir, `${animId}.glb`)
        await client.downloadResult(result.resultUrl, destPath)

        const fileSizeBytes = existsSync(destPath) ? statSync(destPath).size : undefined
        updateAsset(animId, {
          status: 'ready', progress: 100,
          glbPath: `/conjured/${animId}.glb`,
          completedAt: new Date().toISOString(),
          metadata: { fileSizeBytes },
        })
        console.log(`[Forge:AutoAnimate] ${animId} ANIMATED`)
        animTerminal = true
      } else if (result.status === 'failed') {
        updateAsset(animId, { status: 'failed', progress: 0, errorMessage: 'Auto-animate failed', completedAt: new Date().toISOString() })
        animTerminal = true
      } else {
        updateAsset(animId, { progress: result.progress })
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Forge:AutoAnimate] ${animId} error:`, msg)
    updateAsset(animId, { status: 'failed', progress: 0, errorMessage: msg, completedAt: new Date().toISOString() })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/conjure — Ignite the furnace
//
// Body: { prompt: string, provider: ProviderName, tier: string }
// Returns: { id: string, status: 'queued' }
//
// The request returns IMMEDIATELY. The pipeline runs in the background.
// Poll GET /api/conjure/[id] for status updates.
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConjureRequest

    // ░▒▓ Validate the request ▓▒░
    if (!body.prompt || typeof body.prompt !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "prompt" field' },
        { status: 400 },
      )
    }

    if (!body.provider || typeof body.provider !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "provider" field' },
        { status: 400 },
      )
    }

    // ░▒▓ Validate provider exists ▓▒░
    const providerDef = PROVIDERS.find(p => p.name === body.provider)
    if (!providerDef) {
      return NextResponse.json(
        { error: `Unknown provider: "${body.provider}". Known: meshy, tripo, rodin` },
        { status: 400 },
      )
    }

    // ░▒▓ Validate API key is configured ▓▒░
    const apiKey = process.env[providerDef.envKey]
    if (!apiKey) {
      return NextResponse.json(
        { error: `API key not configured for ${providerDef.name}. See .env.example` },
        { status: 500 },
      )
    }

    // ░▒▓ Validate tier exists for this provider ▓▒░
    const tier = body.tier || providerDef.tiers[0].id
    const tierDef = providerDef.tiers.find(t => t.id === tier)
    if (!tierDef) {
      const validTiers = providerDef.tiers.map(t => t.id).join(', ')
      return NextResponse.json(
        { error: `Unknown tier "${tier}" for ${body.provider}. Valid: ${validTiers}` },
        { status: 400 },
      )
    }

    // Local mode — no credits, no paywall. Bring your own API keys.
    const creditCost = tierDef.creditCost
    console.log(`[Forge] Conjuring (local mode, no credit check). Would cost ${creditCost} credits on hosted version.`)

    // ░▒▓ Create the asset entry in the registry ▓▒░
    const id = generateAssetId()
    const asset: ConjuredAsset = {
      id,
      prompt: body.prompt,
      provider: body.provider as ProviderName,
      tier,
      providerTaskId: '',   // will be set when provider returns
      status: 'queued',
      progress: 0,
      position: [0, 0, 0],              // neutral — client owns placement position
      scale: 1,
      rotation: [0, 0, 0],
      createdAt: new Date().toISOString(),
      // ░▒▓ Character mode flag — enables Rig button in UI when ready ▓▒░
      ...(body.characterMode ? { characterMode: true } : {}),
      // ░▒▓ Auto-pipeline flags — chain rig → animate after generation ▓▒░
      ...(body.autoRig ? { autoRig: true } : {}),
      ...(body.autoAnimate ? { autoAnimate: true, animationPreset: body.animationPreset } : {}),
    }

    addAsset(asset)
    console.log(`[Forge] Asset ${id} created — ${body.provider}/${tier}: "${body.prompt.slice(0, 50)}..."`)

    // ░▒▓ Build genOptions — character mode + image-to-3D ▓▒░
    const genOptions: Record<string, unknown> = {}
    if (body.imageUrl) genOptions.imageUrl = body.imageUrl
    if (body.characterMode && body.characterOptions) {
      Object.assign(genOptions, body.characterOptions)
    } else if (body.characterMode) {
      // ░▒▓ Sensible defaults for character mode: A-pose, quad, symmetric ▓▒░
      genOptions.poseMode = 'a-pose'
      genOptions.topology = 'quad'
      genOptions.symmetry = true
    }

    // ░▒▓ Fire-and-forget the pipeline ▓▒░
    // This Promise runs in the background. The client polls for updates.
    // Like sending a child off to school — you trust the process.
    const pipelineOpts = (body.autoRig || body.autoAnimate)
      ? { autoRig: body.autoRig, autoAnimate: body.autoAnimate, animationPreset: body.animationPreset }
      : undefined
    runConjurationPipeline(id, body.prompt, body.provider as ProviderName, tier, Object.keys(genOptions).length > 0 ? genOptions : undefined, pipelineOpts)
      .catch(err => console.error(`[Forge] Background pipeline crash for ${id}:`, err))

    // ░▒▓ Return immediately ▓▒░
    return NextResponse.json(
      {
        id,
        status: 'queued' as const,
        estimatedSeconds: tierDef.estimatedSeconds,
      },
      { status: 201 },
    )

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[Forge] POST /api/conjure error:', errorMessage)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/conjure — See all that has been conjured
//
// Returns: ConjuredAsset[] (newest first)
// ═══════════════════════════════════════════════════════════════════════════

export async function GET() {
  try {
    // ░▒▓ Rescue orphan GLBs — bring back GLBs that lost their registry entries ▓▒░
    // Only runs once per server lifetime (after that, cache has them)
    rescueOrphanGlbs()

    // ░▒▓ Resume orphaned pipelines — pick up conjurations that died with the server ▓▒░
    // Only runs once per server lifetime (globalThis flag prevents double-resume)
    resumeOrphanedPipelines()

    // ░▒▓ Reap the dead — mark stale assets before returning ▓▒░
    // Cheap in-memory scan, only touches disk if ghosts were found
    markStaleAssets()

    const assets = getAllAssets()

    // ░▒▓ Sort newest first — most recent conjurations on top ▓▒░
    const sorted = [...assets].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

    return NextResponse.json(sorted)

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[Forge] GET /api/conjure error:', errorMessage)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓ॐ▓▓▓▓【C̸O̸N̸J̸U̸R̸E̸】▓▓▓▓ॐ▓▓▓▓【R̸O̸U̸T̸E̸】▓▓▓▓
