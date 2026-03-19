// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Post-Processing Route
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   ╔═══════════════════════════════════════════════════════════════╗
//   ║  POST /api/conjure/[id]/process                               ║
//   ║                                                               ║
//   ║  The second pass of the sculptor.                             ║
//   ║  A raw form already exists — now refine it.                   ║
//   ║                                                               ║
//   ║  texture: breathe PBR materials onto untextured clay (Meshy)  ║
//   ║  remesh:  retopologize for animation or game-readiness        ║
//   ║  rig:     auto-rig for animation (biped + 7 creature types)   ║
//   ║  animate: apply motion presets to rigged characters           ║
//   ║                                                               ║
//   ║  Supported: Meshy + Tripo (provider-aware pipelines)          ║
//   ║                                                               ║
//   ║  Each step creates a NEW asset linked to its parent,          ║
//   ║  forming a lineage: draft → textured → remeshed → rigged     ║
//   ╚═══════════════════════════════════════════════════════════════╝
//
// ░▒▓█ POST-PROCESS ROUTE █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync, mkdirSync, statSync } from 'fs'
import { getAssetById, addAsset, updateAsset } from '@/lib/conjure/registry'
import { MeshyClient } from '@/lib/conjure/meshy'
import { TripoClient } from '@/lib/conjure/tripo'
import { POST_PROCESS_COSTS } from '@/lib/conjure/types'
import type { ConjuredAsset, ProcessRequest, ConjureStatus, ProviderName } from '@/lib/conjure/types'
import { getLocalUserId } from '@/lib/local-auth'
import { getServerSupabase } from '@/lib/supabase'

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER-AWARE CLIENT INTERFACE — Both Meshy + Tripo implement these
// ─═̷─═̷─ Same soul, different bodies ─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════

interface PostProcessClient {
  downloadResult(url: string, dest: string): Promise<void>
  // Rig
  rig(sourceTaskId: string, options?: Record<string, unknown>): Promise<{ taskId: string }>
  checkRigStatus(taskId: string): Promise<{ status: ConjureStatus; progress: number; resultUrl?: string }>
  // Remesh
  remesh(sourceTaskId: string, options: { topology: 'quad' | 'triangle'; targetPolycount: number }): Promise<{ taskId: string }>
  checkRemeshStatus(taskId: string): Promise<{ status: ConjureStatus; progress: number; resultUrl?: string }>
  // Animate
  animate(riggedTaskId: string, presetId: string | string[]): Promise<{ taskId: string }>
  checkAnimateStatus(taskId: string): Promise<{ status: ConjureStatus; progress: number; resultUrl?: string }>
}

function getPostProcessClient(provider: ProviderName): PostProcessClient {
  switch (provider) {
    case 'meshy': return new MeshyClient()
    case 'tripo': return new TripoClient()
    default: throw new Error(`[Forge:Process] Provider "${provider}" does not support post-processing`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function generateAssetId(): string {
  return 'conj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function ensureConjuredDir(): string {
  const dir = join(process.cwd(), 'public', 'conjured')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

const POLL_INTERVAL_MS = 5000
const MAX_PIPELINE_MS = 20 * 60_000  // 20 min absolute ceiling — no pipeline should run longer

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Providers that support each action */
const SUPPORTED_PROVIDERS: Record<string, ProviderName[]> = {
  texture: ['meshy'],                    // Tripo textures during generation (pbr: true)
  remesh:  ['meshy', 'tripo'],
  rig:     ['meshy', 'tripo'],
  animate: ['meshy', 'tripo'],
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC POLL-UNTIL-TERMINAL — The heartbeat of every pipeline
// ─═̷─═̷─ Start job → poll → download → done ─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════

async function runGenericPipeline(
  assetId: string,
  actionLabel: string,
  client: PostProcessClient,
  startFn: () => Promise<{ taskId: string }>,
  pollFn: (taskId: string) => Promise<{ status: ConjureStatus; progress: number; resultUrl?: string; thumbnailUrl?: string }>,
): Promise<void> {
  const startTime = Date.now()

  try {
    console.log(`[Forge:Process] ${actionLabel} pipeline started for ${assetId}`)
    updateAsset(assetId, { status: 'generating', progress: 0 })

    const { taskId } = await startFn()
    updateAsset(assetId, { providerTaskId: taskId })

    let terminal = false
    let readyButNoUrlRetries = 0  // ░▒▓ Anti-infinite-loop: track "ready but no URL" hits ▓▒░

    while (!terminal) {
      await sleep(POLL_INTERVAL_MS)

      // ░▒▓ ABSOLUTE TIMEOUT — no pipeline should haunt us forever ▓▒░
      const elapsed = Date.now() - startTime
      if (elapsed > MAX_PIPELINE_MS) {
        const mins = Math.round(elapsed / 60_000)
        console.error(`[Forge:Process] ${assetId} ${actionLabel} TIMED OUT after ${mins}min — killing pipeline`)
        updateAsset(assetId, {
          status: 'failed',
          progress: 0,
          errorMessage: `Pipeline timed out after ${mins} minutes`,
          completedAt: new Date().toISOString(),
        })
        return
      }

      const result = await pollFn(taskId)
      console.log(`[Forge:Process] ${assetId} ${actionLabel.toLowerCase()} — ${result.status} ${result.progress}%`)

      if (result.status === 'ready' && result.resultUrl) {
        updateAsset(assetId, { status: 'downloading', progress: 95 })

        const conjuredDir = ensureConjuredDir()
        const destPath = join(conjuredDir, `${assetId}.glb`)
        await client.downloadResult(result.resultUrl, destPath)

        const finalElapsed = Date.now() - startTime
        const fileSizeBytes = existsSync(destPath) ? statSync(destPath).size : undefined
        updateAsset(assetId, {
          status: 'ready',
          progress: 100,
          glbPath: `/conjured/${assetId}.glb`,
          thumbnailUrl: result.thumbnailUrl || undefined,
          completedAt: new Date().toISOString(),
          metadata: { generationTimeMs: finalElapsed, fileSizeBytes },
        })
        console.log(`[Forge:Process] ${assetId} ${actionLabel.toUpperCase()} in ${(finalElapsed / 1000).toFixed(1)}s`)
        terminal = true

      } else if (result.status === 'ready' && !result.resultUrl) {
        // ░▒▓ GHOST STATE — provider says "ready" but gave no download URL ▓▒░
        // Give it 3 retries (15s) in case the CDN is lagging, then declare dead
        readyButNoUrlRetries++
        console.warn(`[Forge:Process] ${assetId} ${actionLabel} — READY but NO resultUrl (attempt ${readyButNoUrlRetries}/3)`)
        if (readyButNoUrlRetries >= 3) {
          console.error(`[Forge:Process] ${assetId} ${actionLabel} — provider returned ready without download URL 3x, marking failed`)
          updateAsset(assetId, {
            status: 'failed',
            progress: 0,
            errorMessage: `${actionLabel} completed but provider returned no download URL — ghost state`,
            completedAt: new Date().toISOString(),
          })
          terminal = true
        }

      } else if (result.status === 'failed') {
        updateAsset(assetId, {
          status: 'failed',
          progress: 0,
          errorMessage: `${actionLabel} failed`,
          completedAt: new Date().toISOString(),
        })
        terminal = true

      } else {
        updateAsset(assetId, {
          progress: result.progress,
          thumbnailUrl: result.thumbnailUrl || undefined,
        })
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[Forge:Process] ${assetId} ${actionLabel.toLowerCase()} error:`, errorMessage)
    updateAsset(assetId, {
      status: 'failed',
      progress: 0,
      errorMessage,
      completedAt: new Date().toISOString(),
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXTURE PIPELINE — Meshy-only (Tripo textures at generation time)
// ░▒▓ Refine a preview into a PBR-textured model ▓▒░
// ═══════════════════════════════════════════════════════════════════════════

async function runTexturePipeline(
  assetId: string,
  sourceProviderTaskId: string,
  texturePrompt?: string,
): Promise<void> {
  const client = new MeshyClient()
  const startTime = Date.now()

  try {
    console.log(`[Forge:Process] Texture pipeline started for ${assetId}`)
    updateAsset(assetId, { status: 'refining', progress: 0 })

    const { taskId } = await client.refineFromPreview(sourceProviderTaskId, texturePrompt)
    updateAsset(assetId, { providerTaskId: taskId })

    let terminal = false
    let readyButNoUrlRetries = 0

    while (!terminal) {
      await sleep(POLL_INTERVAL_MS)

      // ░▒▓ ABSOLUTE TIMEOUT ▓▒░
      const elapsed = Date.now() - startTime
      if (elapsed > MAX_PIPELINE_MS) {
        const mins = Math.round(elapsed / 60_000)
        console.error(`[Forge:Process] ${assetId} texture TIMED OUT after ${mins}min`)
        updateAsset(assetId, {
          status: 'failed', progress: 0,
          errorMessage: `Texture pipeline timed out after ${mins} minutes`,
          completedAt: new Date().toISOString(),
        })
        return
      }

      const result = await client.checkStatus(taskId)
      console.log(`[Forge:Process] ${assetId} texture — ${result.status} ${result.progress}%`)

      if (result.status === 'ready' && result.resultUrl) {
        updateAsset(assetId, { status: 'downloading', progress: 95 })

        const conjuredDir = ensureConjuredDir()
        const destPath = join(conjuredDir, `${assetId}.glb`)
        await client.downloadResult(result.resultUrl, destPath)

        const finalElapsed = Date.now() - startTime
        const fileSizeBytes = existsSync(destPath) ? statSync(destPath).size : undefined
        updateAsset(assetId, {
          status: 'ready',
          progress: 100,
          glbPath: `/conjured/${assetId}.glb`,
          thumbnailUrl: result.thumbnailUrl,
          completedAt: new Date().toISOString(),
          metadata: { generationTimeMs: finalElapsed, fileSizeBytes },
        })
        console.log(`[Forge:Process] ${assetId} TEXTURED in ${(finalElapsed / 1000).toFixed(1)}s`)
        terminal = true

      } else if (result.status === 'ready' && !result.resultUrl) {
        readyButNoUrlRetries++
        console.warn(`[Forge:Process] ${assetId} texture — READY but NO resultUrl (attempt ${readyButNoUrlRetries}/3)`)
        if (readyButNoUrlRetries >= 3) {
          updateAsset(assetId, {
            status: 'failed', progress: 0,
            errorMessage: 'Texture completed but provider returned no download URL',
            completedAt: new Date().toISOString(),
          })
          terminal = true
        }

      } else if (result.status === 'failed') {
        updateAsset(assetId, {
          status: 'failed', progress: 0,
          errorMessage: 'Texture refine failed',
          completedAt: new Date().toISOString(),
        })
        terminal = true

      } else {
        updateAsset(assetId, {
          progress: result.progress,
          thumbnailUrl: result.thumbnailUrl || undefined,
        })
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[Forge:Process] ${assetId} texture error:`, errorMessage)
    updateAsset(assetId, {
      status: 'failed', progress: 0, errorMessage,
      completedAt: new Date().toISOString(),
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FREE ANIMATION PIPELINE — Meshy rig includes walk/run GLBs at no cost
// ░▒▓ Re-query rig status to get animation URLs, download directly ▓▒░
// ═══════════════════════════════════════════════════════════════════════════

async function runFreeAnimationPipeline(
  assetId: string,
  rigProviderTaskId: string,
  presetId: string,  // 'free:walk' or 'free:run'
): Promise<void> {
  const client = new MeshyClient()
  try {
    console.log(`[Forge:Process] Free animation pipeline for ${assetId} (${presetId})`)
    updateAsset(assetId, { status: 'generating', progress: 50 })

    // Re-query the rig to get animation URLs
    const rigStatus = await client.checkRigStatus(rigProviderTaskId)
    if (!rigStatus.rigResult) {
      updateAsset(assetId, { status: 'failed', progress: 0, errorMessage: 'Rig result not found — cannot extract free animation', completedAt: new Date().toISOString() })
      return
    }

    const animType = presetId.replace('free:', '')  // 'walk' or 'run'
    const animUrl = animType === 'run' ? rigStatus.rigResult.runAnimUrl : rigStatus.rigResult.walkAnimUrl
    if (!animUrl) {
      updateAsset(assetId, { status: 'failed', progress: 0, errorMessage: `Free ${animType} animation URL not found in rig result`, completedAt: new Date().toISOString() })
      return
    }

    updateAsset(assetId, { status: 'downloading', progress: 80 })
    const conjuredDir = ensureConjuredDir()
    const destPath = join(conjuredDir, `${assetId}.glb`)
    await client.downloadResult(animUrl, destPath)

    const fileSizeBytes = existsSync(destPath) ? statSync(destPath).size : undefined
    updateAsset(assetId, {
      status: 'ready',
      progress: 100,
      glbPath: `/conjured/${assetId}.glb`,
      completedAt: new Date().toISOString(),
      metadata: { fileSizeBytes },
    })
    console.log(`[Forge:Process] ${assetId} FREE ${animType} animation downloaded`)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[Forge:Process] ${assetId} free animation error:`, errorMessage)
    updateAsset(assetId, { status: 'failed', progress: 0, errorMessage, completedAt: new Date().toISOString() })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/conjure/[id]/process — The sculptor's second pass
//
// Body: { action: 'texture' | 'remesh' | 'rig' | 'animate', options?: { ... } }
// Returns: { id: string, status: 'queued', sourceAssetId: string }
//
// Supports BOTH Meshy and Tripo assets. Provider auto-detected from source.
// Creates a NEW asset linked to the source, fires the pipeline,
// and returns immediately. Poll GET /api/conjure/[newId] for progress.
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sourceId } = await params
    const body = (await request.json()) as ProcessRequest

    // ░▒▓ Validate the request ▓▒░
    if (!body.action || !['texture', 'remesh', 'rig', 'animate'].includes(body.action)) {
      return NextResponse.json(
        { error: 'Missing or invalid "action". Expected: texture | remesh | rig | animate' },
        { status: 400 },
      )
    }

    // ░▒▓ Find the source asset ▓▒░
    const source = getAssetById(sourceId)
    if (!source) {
      return NextResponse.json(
        { error: `Source asset "${sourceId}" not found` },
        { status: 404 },
      )
    }

    if (source.status !== 'ready') {
      return NextResponse.json(
        { error: `Source asset is not ready (status: ${source.status}). Wait for it to complete.` },
        { status: 400 },
      )
    }

    // ░▒▓ Validate provider supports this action ▓▒░
    const supportedProviders = SUPPORTED_PROVIDERS[body.action] || []
    if (!supportedProviders.includes(source.provider)) {
      return NextResponse.json(
        { error: `"${body.action}" is not supported for ${source.provider} assets. Supported providers: ${supportedProviders.join(', ')}` },
        { status: 400 },
      )
    }

    if (!source.providerTaskId) {
      return NextResponse.json(
        { error: 'Source asset has no provider task ID — cannot post-process' },
        { status: 400 },
      )
    }

    // ░▒▓ Texture-specific validation (Meshy only) ▓▒░
    if (body.action === 'texture' && source.action === 'texture') {
      return NextResponse.json(
        { error: 'This asset is already textured. Try remeshing instead.' },
        { status: 400 },
      )
    }

    // ░▒▓ CREDIT CHECK — post-processing also costs credits ▓▒░
    const _uid = await getLocalUserId()

    // Free Meshy animations (walk/run bundled with rig) cost nothing
    const isFreeAnim = body.action === 'animate' && body.options?.animationPresetId?.startsWith('free:')
    const creditCost = isFreeAnim ? 0 : (POST_PROCESS_COSTS[body.action] ?? 1)

    if (creditCost > 0) {
      const sb = getServerSupabase()
      const { data: profile } = await sb
        .from('profiles')
        .select('credits')
        .eq('id', _uid)
        .single()

      const currentCredits = profile?.credits ?? 0
      if (currentCredits < creditCost) {
        return NextResponse.json(
          { error: 'Insufficient credits', credits: currentCredits, required: creditCost },
          { status: 402 },
        )
      }

      const newBalance = Math.round((currentCredits - creditCost) * 100) / 100
      const { error: deductError } = await sb
        .from('profiles')
        .update({ credits: newBalance })
        .eq('id', _uid)
        .gte('credits', creditCost)

      if (deductError) {
        console.error('[Forge:Process] Credit deduction failed:', deductError.message)
        return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 })
      }

      console.log(`[Forge:Process] Deducted ${creditCost} credit(s) for ${body.action} from ${_uid} (${currentCredits} → ${newBalance})`)
    } else {
      console.log(`[Forge:Process] Free ${body.action} for ${_uid} (no credit cost)`)
    }

    // ░▒▓ Create the child asset ▓▒░
    const newId = generateAssetId()
    const ACTION_LABELS: Record<string, string> = {
      texture: 'Texturing', remesh: 'Remeshing', rig: 'Rigging', animate: 'Animating',
    }
    const TIER_LABELS: Record<string, string> = {
      texture: 'refine', remesh: 'remesh', rig: 'rig', animate: 'animate',
    }
    const actionLabel = ACTION_LABELS[body.action] || body.action
    const tierLabel = TIER_LABELS[body.action] || body.action

    // Display name: "rigged tripo" / "remeshed meshy" — clean, readable
    const actionPast: Record<string, string> = {
      texture: 'textured', remesh: 'remeshed', rig: 'rigged', animate: 'animated',
    }
    const displayName = `${actionPast[body.action] || body.action} ${source.provider}`

    const childAsset: ConjuredAsset = {
      id: newId,
      prompt: `[${actionLabel}] ${source.prompt}`,
      displayName,
      provider: source.provider,   // ░▒▓ Inherit provider from parent — not hardcoded to meshy ▓▒░
      tier: tierLabel,
      providerTaskId: '',
      status: 'queued' as ConjureStatus,
      progress: 0,
      position: [
        source.position[0] + (Math.random() - 0.5) * 2,
        source.position[1],
        source.position[2] + (Math.random() - 0.5) * 2,
      ],
      scale: source.scale,
      rotation: [...source.rotation] as [number, number, number],
      createdAt: new Date().toISOString(),
      sourceAssetId: sourceId,
      action: body.action,
    }

    addAsset(childAsset)
    console.log(`[Forge:Process] Created ${body.action} asset ${newId} from source ${sourceId} (${source.provider})`)

    // ░▒▓ Fire-and-forget the pipeline ▓▒░
    if (body.action === 'texture') {
      // Texture is Meshy-only — special pipeline (refine from preview)
      runTexturePipeline(newId, source.providerTaskId, body.options?.texturePrompt)
        .catch(err => console.error(`[Forge:Process] Texture pipeline crash for ${newId}:`, err))

    } else if (body.action === 'remesh') {
      const client = getPostProcessClient(source.provider)
      const targetPolycount = body.options?.targetPolycount ?? 30_000
      const topology = body.options?.topology ?? 'quad'
      runGenericPipeline(
        newId, 'Remesh', client,
        () => client.remesh(source.providerTaskId, { targetPolycount, topology }),
        (taskId) => client.checkRemeshStatus(taskId),
      ).catch(err => console.error(`[Forge:Process] Remesh pipeline crash for ${newId}:`, err))

    } else if (body.action === 'rig') {
      const client = getPostProcessClient(source.provider)
      runGenericPipeline(
        newId, 'Rig', client,
        () => client.rig(source.providerTaskId, { heightMeters: body.options?.heightMeters }),
        (taskId) => client.checkRigStatus(taskId),
      ).catch(err => console.error(`[Forge:Process] Rig pipeline crash for ${newId}:`, err))

    } else if (body.action === 'animate') {
      const presetId = body.options?.animationPresetId
      if (!presetId) {
        return NextResponse.json(
          { error: 'Missing "options.animationPresetId" for animate action' },
          { status: 400 },
        )
      }

      // ░▒▓ Meshy FREE animations — download directly from rig result ▓▒░
      if (presetId.startsWith('free:') && source.provider === 'meshy') {
        runFreeAnimationPipeline(newId, source.providerTaskId, presetId)
          .catch(err => console.error(`[Forge:Process] Free anim pipeline crash for ${newId}:`, err))
      } else {
        const client = getPostProcessClient(source.provider)
        runGenericPipeline(
          newId, 'Animate', client,
          () => client.animate(source.providerTaskId, presetId),
          (taskId) => client.checkAnimateStatus(taskId),
        ).catch(err => console.error(`[Forge:Process] Animate pipeline crash for ${newId}:`, err))
      }
    }

    return NextResponse.json(
      {
        id: newId,
        status: 'queued' as const,
        sourceAssetId: sourceId,
        action: body.action,
      },
      { status: 201 },
    )

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[Forge:Process] POST error:', errorMessage)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓ॐ▓▓▓▓【P̸R̸O̸C̸E̸S̸S̸】▓▓▓▓ॐ▓▓▓▓【R̸O̸U̸T̸E̸】▓▓▓▓
