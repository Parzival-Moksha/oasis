// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Meshy Provider Client
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   ╔═══════════════════════════════════════════════════════════════╗
//   ║  Meshy — The Patient Sculptor                                 ║
//   ║                                                               ║
//   ║  Two-phase alchemy:                                           ║
//   ║    preview → raw shape from the void (fast, untextured)       ║
//   ║    refine  → PBR textures breathed onto the form              ║
//   ║                                                               ║
//   ║  Like a mother: first the body, then the soul.                ║
//   ╚═══════════════════════════════════════════════════════════════╝
//
//   API: https://docs.meshy.ai/api-text-to-3d
//   Model: meshy-6 (latest gen, best quality)
//
// ░▒▓█ MESHY CONJURE CLIENT █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import type { ConjureProviderClient, ConjureStatus, ProviderName, MeshTopology, CharacterGenerationOptions, RigResult, AnimationPreset } from '@/lib/conjure/types'
import { writeFileSync } from 'fs'

// ═══════════════════════════════════════════════════════════════════════════
// MESHY API TYPES — what the blacksmith's furnace returns
// ═══════════════════════════════════════════════════════════════════════════

interface MeshyStartResponse {
  result: string   // task ID
}

interface MeshyStatusResponse {
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'
  progress: number
  model_urls?: {
    glb?: string
    fbx?: string
    obj?: string
  }
  thumbnail_url?: string
  task_error?: {
    message?: string
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEEP URL SCANNER — brute-force find GLB URLs in unknown response shapes
// ░▒▓ When Meshy moves the URL to a new field, this catches it ▓▒░
// ═══════════════════════════════════════════════════════════════════════════

function deepScanForGlbUrl(obj: unknown, depth = 0): string | undefined {
  if (depth > 5 || !obj) return undefined
  if (typeof obj === 'string') {
    // Match any URL that contains .glb or looks like a CDN download
    if (obj.startsWith('http') && (obj.includes('.glb') || obj.includes('glb_url') || obj.includes('/output/'))) {
      return obj
    }
    return undefined
  }
  if (typeof obj !== 'object') return undefined
  for (const val of Object.values(obj as Record<string, unknown>)) {
    const found = deepScanForGlbUrl(val, depth + 1)
    if (found) return found
  }
  return undefined
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS MAPPING — provider reality → Forge reality
// The Forge speaks one language; each provider speaks its own.
// A mother translates between worlds.
// ═══════════════════════════════════════════════════════════════════════════

function mapMeshyStatus(status: MeshyStatusResponse['status']): ConjureStatus {
  switch (status) {
    case 'PENDING':     return 'generating'
    case 'IN_PROGRESS': return 'generating'
    case 'SUCCEEDED':   return 'ready'       // still needs download, route handles that
    case 'FAILED':      return 'failed'
    case 'CANCELED':    return 'failed'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CLIENT — Meshy's voice in The Forge
// ═══════════════════════════════════════════════════════════════════════════

const MESHY_V2 = 'https://api.meshy.ai/openapi/v2'
const MESHY_V1 = 'https://api.meshy.ai/openapi/v1'

// ░▒▓ FETCH WITH TIMEOUT — no more "terminated" hangs ▓▒░
// AbortController kills the request if it takes too long.
// API calls: 60s. Downloads: 5 minutes.
const API_TIMEOUT_MS = 60_000
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// ═══════════════════════════════════════════════════════════════════════════
// MESHY REMESH API TYPES — retopology from the blacksmith's anvil
// ═══════════════════════════════════════════════════════════════════════════

interface MeshyRemeshStatusResponse {
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED'
  progress: number
  model_urls?: {
    glb?: string
    fbx?: string
    obj?: string
  }
  task_error?: {
    message?: string
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MESHY RIG RESPONSE — the skeleton beneath the skin
// ░▒▓ output includes rigged model + free walk/run animations ▓▒░
// ═══════════════════════════════════════════════════════════════════════════

interface MeshyRigStatusResponse {
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED'
  progress: number
  task_error?: {
    message?: string
  }
  // ░▒▓ Meshy rig API nests URLs under `result`, NOT at top level ▓▒░
  // This bit us: we were reading data.rigged_character_glb_url (undefined)
  // when it's actually data.result.rigged_character_glb_url
  // Source of truth: https://docs.meshy.ai/en/api/rigging-and-animation
  result?: {
    rigged_character_glb_url?: string
    rigged_character_fbx_url?: string
    basic_animations?: {
      walking_glb_url?: string
      walking_fbx_url?: string
      running_glb_url?: string
      running_fbx_url?: string
    }
  }
  // ░▒▓ Legacy flat fields — keep for backward compat just in case ▓▒░
  rigged_character_glb_url?: string
  rigged_character_fbx_url?: string
  basic_animations?: {
    walking_glb_url?: string
    walking_fbx_url?: string
    running_glb_url?: string
    running_fbx_url?: string
  }
  // ░▒▓ Catch-all for unknown fields ▓▒░
  [key: string]: unknown
}

export class MeshyClient implements ConjureProviderClient {
  readonly name: ProviderName = 'meshy'

  private get apiKey(): string {
    const key = process.env.MESHY_API_KEY
    if (!key) throw new Error('[Forge:Meshy] MESHY_API_KEY not set. The sculptor has no chisel.')
    return key
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  /**
   * startGeneration — Whisper a prompt into the void
   *
   * For "preview" tier: start a preview generation directly.
   * For "refine" tier: start a preview FIRST, wait for it,
   * then kick off the refine pass. The refine taskId is returned
   * so the poll loop tracks the final product.
   */
  async startGeneration(prompt: string, tier: string, options?: CharacterGenerationOptions & { imageUrl?: string }): Promise<{ taskId: string }> {
    console.log(`[Forge:Meshy] Starting ${tier} generation: "${prompt.slice(0, 60)}..."`)

    // ░▒▓ Image-to-3D branch — photo → geometry ▓▒░
    if (options?.imageUrl) {
      return this.imageToThreeD(options.imageUrl, options)
    }

    // ░▒▓ Phase 1: Always start with preview ▓▒░
    // ░▒▓ Character mode: reinforce A-pose in prompt text (API param alone isn't reliable) ▓▒░
    const finalPrompt = (options?.poseMode === 'a-pose' && !prompt.toLowerCase().includes('a-pose'))
      ? `${prompt}, in A-pose, arms slightly away from body`
      : prompt
    const previewBody: Record<string, unknown> = {
      mode: 'preview',
      prompt: finalPrompt,
      ai_model: 'meshy-6',
    }
    // ░▒▓ Character mode: API params — belt AND suspenders ▓▒░
    // Meshy docs: pose_mode + symmetry_mode are the official knobs, and
    // topology is only respected when should_remesh is enabled.
    if (options?.poseMode) previewBody.pose_mode = options.poseMode
    if (options?.topology) {
      previewBody.topology = options.topology
      previewBody.should_remesh = true
    }
    if (options?.symmetry !== undefined) previewBody.symmetry_mode = options.symmetry ? 'on' : 'off'

    const previewRes = await fetchWithTimeout(`${MESHY_V2}/text-to-3d`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(previewBody),
    })

    if (!previewRes.ok) {
      const errText = await previewRes.text()
      throw new Error(`[Forge:Meshy] Preview start failed (${previewRes.status}): ${errText}`)
    }

    const previewData = (await previewRes.json()) as MeshyStartResponse
    const previewTaskId = previewData.result
    console.log(`[Forge:Meshy] Preview task started: ${previewTaskId}`)

    // ░▒▓ If preview tier, we're done — return the preview task ▓▒░
    if (tier === 'preview') {
      return { taskId: previewTaskId }
    }

    // ░▒▓ Phase 2: For refine tier, wait for preview to complete ▓▒░
    console.log(`[Forge:Meshy] Waiting for preview to complete before refining...`)
    const previewResult = await this.waitForPreview(previewTaskId)
    if (previewResult !== 'SUCCEEDED') {
      throw new Error(`[Forge:Meshy] Preview failed — cannot refine. Status: ${previewResult}`)
    }

    // ░▒▓ Phase 3: Start the refine pass on top of preview ▓▒░
    console.log(`[Forge:Meshy] Preview done. Starting refine pass...`)
    const refineRes = await fetchWithTimeout(`${MESHY_V2}/text-to-3d`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        mode: 'refine',
        preview_task_id: previewTaskId,
        enable_pbr: true,    // ░ metallic, roughness, normal maps — the full material soul ░
      }),
    })

    if (!refineRes.ok) {
      const errText = await refineRes.text()
      throw new Error(`[Forge:Meshy] Refine start failed (${refineRes.status}): ${errText}`)
    }

    const refineData = (await refineRes.json()) as MeshyStartResponse
    console.log(`[Forge:Meshy] Refine task started: ${refineData.result}`)

    return { taskId: refineData.result }
  }

  /**
   * waitForPreview — internal helper to block until preview completes
   * Used only when tier=refine (need preview done before refine starts)
   */
  private async waitForPreview(taskId: string): Promise<string> {
    const maxAttempts = 120  // 10 minutes at 5s intervals
    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.rawStatus(taskId)
      if (status.status === 'SUCCEEDED' || status.status === 'FAILED') {
        return status.status
      }
      // ░ patience is a virtue, especially when sculpting ░
      await sleep(5000)
    }
    throw new Error('[Forge:Meshy] Preview timed out after 10 minutes')
  }

  /**
   * checkStatus — Ask the sculptor how the work is going
   */
  async checkStatus(taskId: string): Promise<{
    status: ConjureStatus
    progress: number
    resultUrl?: string
    thumbnailUrl?: string
  }> {
    const data = await this.rawStatus(taskId)
    const status = mapMeshyStatus(data.status)
    const resultUrl = data.model_urls?.glb

    return {
      status,
      progress: data.progress ?? 0,
      resultUrl,
      thumbnailUrl: data.thumbnail_url,
    }
  }

  /**
   * rawStatus — fetch raw Meshy status (used by both checkStatus and waitForPreview)
   */
  private async rawStatus(taskId: string): Promise<MeshyStatusResponse> {
    const res = await fetchWithTimeout(`${MESHY_V2}/text-to-3d/${taskId}`, {
      method: 'GET',
      headers: this.headers(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Status check failed (${res.status}): ${errText}`)
    }

    return (await res.json()) as MeshyStatusResponse
  }

  /**
   * downloadResult — Fetch the GLB from Meshy's CDN and save to disk
   * The moment thought becomes matter, bits become geometry.
   */
  async downloadResult(resultUrl: string, destPath: string): Promise<void> {
    console.log(`[Forge:Meshy] Downloading GLB from: ${resultUrl.slice(0, 80)}...`)

    const res = await fetchWithTimeout(resultUrl, {}, DOWNLOAD_TIMEOUT_MS)
    if (!res.ok) {
      throw new Error(`[Forge:Meshy] Download failed (${res.status})`)
    }

    const buffer = Buffer.from(await res.arrayBuffer())

    // ░▒▓ SHAPESHIFTER DEFENSE — validate GLB magic bytes before saving ▓▒░
    // GLB files MUST start with 0x676C5446 ("glTF"). Anything else is an impostor.
    // Tripo/Meshy sometimes return FBX or other formats disguised as .glb
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x46546C67) {
      const header = buffer.slice(0, 20).toString('ascii').replace(/[^\x20-\x7E]/g, '?')
      throw new Error(`[Forge:Meshy] Shapeshifter detected! Expected GLB (glTF magic), got: "${header}"`)
    }

    writeFileSync(destPath, buffer)

    console.log(`[Forge:Meshy] GLB saved to: ${destPath} (${(buffer.length / 1024).toFixed(1)} KB)`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POST-PROCESSING — The second and third passes of the sculptor
  // ─═̷─═̷─ Beyond conjuration: texture, remesh, and the path to rigging ─═̷─═̷─
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * refineFromPreview — Breathe PBR textures onto a raw preview mesh
   *
   * Takes a completed preview taskId and kicks off a refine pass.
   * Unlike startGeneration(tier='refine'), this is for post-hoc texturing
   * of assets that were originally conjured as preview-only.
   */
  async refineFromPreview(previewTaskId: string, texturePrompt?: string): Promise<{ taskId: string }> {
    console.log(`[Forge:Meshy] Starting refine on preview ${previewTaskId}`)

    const body: Record<string, unknown> = {
      mode: 'refine',
      preview_task_id: previewTaskId,
      enable_pbr: true,
    }
    if (texturePrompt) body.texture_prompt = texturePrompt

    const res = await fetchWithTimeout(`${MESHY_V2}/text-to-3d`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Refine start failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as MeshyStartResponse
    console.log(`[Forge:Meshy] Refine task started: ${data.result}`)
    return { taskId: data.result }
  }

  /**
   * remesh — Retopologize any completed Meshy model
   *
   * Takes a source taskId and produces a clean-topology mesh at
   * the target polycount. Quad topology = animation-ready.
   * Triangle topology = game-engine-ready.
   *
   * Uses the v1 remesh endpoint (separate from text-to-3d).
   */
  async remesh(sourceTaskId: string, options: {
    topology: MeshTopology
    targetPolycount: number
  }): Promise<{ taskId: string }> {
    console.log(`[Forge:Meshy] Starting remesh on task ${sourceTaskId} (${options.topology}, ${options.targetPolycount} polys)`)

    const res = await fetchWithTimeout(`${MESHY_V1}/remesh`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        input_task_id: sourceTaskId,
        topology: options.topology,
        target_polycount: options.targetPolycount,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Remesh start failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as MeshyStartResponse
    console.log(`[Forge:Meshy] Remesh task started: ${data.result}`)
    return { taskId: data.result }
  }

  /**
   * checkRemeshStatus — Poll the v1 remesh endpoint
   *
   * Different endpoint from text-to-3d status (v1 vs v2).
   * Same status enum though — PENDING/IN_PROGRESS/SUCCEEDED/FAILED.
   */
  async checkRemeshStatus(taskId: string): Promise<{
    status: ConjureStatus
    progress: number
    resultUrl?: string
  }> {
    const res = await fetchWithTimeout(`${MESHY_V1}/remesh/${taskId}`, {
      method: 'GET',
      headers: this.headers(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Remesh status check failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as MeshyRemeshStatusResponse
    return {
      status: mapMeshyStatus(data.status),
      progress: data.progress ?? 0,
      resultUrl: data.model_urls?.glb,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // IMAGE-TO-3D — Photo → Geometry (the camera's eye becomes a sculptor)
  // ░▒▓ v1 endpoint. ~30-60s. Paste a URL, get a mesh. ▓▒░
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * imageToThreeD — Turn a 2D image into 3D geometry
   * Uses POST /v1/image-to-3d. Supports character options for riggable output.
   */
  async imageToThreeD(imageUrl: string, options?: CharacterGenerationOptions): Promise<{ taskId: string }> {
    console.log(`[Forge:Meshy] Starting image-to-3D: ${imageUrl.slice(0, 60)}...`)

    const body: Record<string, unknown> = {
      image_url: imageUrl,
      ai_model: 'meshy-6',
    }
    // Meshy image-to-3D supports pose_mode directly; keep character-mode image
    // conjures aligned with the text pipeline instead of silently dropping pose intent.
    if (options?.poseMode) body.pose_mode = options.poseMode
    if (options?.topology) {
      body.topology = options.topology
      body.should_remesh = true
    }
    if (options?.symmetry !== undefined) body.symmetry_mode = options.symmetry ? 'on' : 'off'

    const res = await fetchWithTimeout(`${MESHY_V1}/image-to-3d`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Image-to-3D start failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as MeshyStartResponse
    console.log(`[Forge:Meshy] Image-to-3D task started: ${data.result}`)
    return { taskId: data.result }
  }

  /**
   * checkImageTo3DStatus — Poll the v1 image-to-3d endpoint
   * Same response shape as remesh (v1 pattern).
   */
  async checkImageTo3DStatus(taskId: string): Promise<{
    status: ConjureStatus
    progress: number
    resultUrl?: string
    thumbnailUrl?: string
  }> {
    const res = await fetchWithTimeout(`${MESHY_V1}/image-to-3d/${taskId}`, {
      method: 'GET',
      headers: this.headers(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Image-to-3D status check failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as MeshyStatusResponse
    return {
      status: mapMeshyStatus(data.status),
      progress: data.progress ?? 0,
      resultUrl: data.model_urls?.glb,
      thumbnailUrl: data.thumbnail_url,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RIGGING — Breathe a skeleton into the sculpture
  // ░▒▓ POST /v1/rigging. ~30-60s. 5 credits. FREE walk + run included. ▓▒░
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * rig — Auto-rig any completed Meshy model
   * Returns a skeleton + free walking & running animations.
   * The moment the sculpture learns to stand.
   */
  async rig(sourceTaskId: string, options?: { heightMeters?: number }): Promise<{ taskId: string }> {
    console.log(`[Forge:Meshy] Starting rig on task ${sourceTaskId}`)

    const body: Record<string, unknown> = {
      input_task_id: sourceTaskId,
    }
    if (options?.heightMeters) body.height_meters = options.heightMeters

    const res = await fetchWithTimeout(`${MESHY_V1}/rigging`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Rig start failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as MeshyStartResponse
    console.log(`[Forge:Meshy] Rig task started: ${data.result}`)
    return { taskId: data.result }
  }

  /**
   * checkRigStatus — Poll the v1 rigging endpoint
   * On success, returns rigged GLB + optional walk/run animations.
   */
  async checkRigStatus(taskId: string): Promise<{
    status: ConjureStatus
    progress: number
    resultUrl?: string
    rigResult?: RigResult
  }> {
    const res = await fetchWithTimeout(`${MESHY_V1}/rigging/${taskId}`, {
      method: 'GET',
      headers: this.headers(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Rig status check failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as MeshyRigStatusResponse

    // ░▒▓ Diagnostic: log FULL response on SUCCEEDED ▓▒░
    if (data.status === 'SUCCEEDED') {
      console.log(`[Forge:Meshy] Rig SUCCEEDED — raw keys: ${Object.keys(data).join(', ')}`)
      console.log(`[Forge:Meshy] Rig SUCCEEDED — result keys: ${data.result ? Object.keys(data.result).join(', ') : 'NO RESULT FIELD'}`)
      console.log(`[Forge:Meshy] Rig SUCCEEDED — full: ${JSON.stringify(data).slice(0, 1500)}`)
    }

    // ░▒▓ Multi-field URL extraction ▓▒░
    // CRITICAL FIX: Meshy nests rig output under `result.`, NOT at top level!
    // data.result.rigged_character_glb_url — this is the canonical location
    // data.rigged_character_glb_url — kept as fallback for possible API changes
    const rigGlbUrl = data.result?.rigged_character_glb_url
      || data.rigged_character_glb_url
      || deepScanForGlbUrl(data)

    const rigFbxUrl = data.result?.rigged_character_fbx_url || data.rigged_character_fbx_url
    const anims = data.result?.basic_animations || data.basic_animations

    const rigResult: RigResult | undefined = data.status === 'SUCCEEDED' ? {
      riggedGlbUrl: rigGlbUrl,
      riggedFbxUrl: rigFbxUrl,
      walkAnimUrl: anims?.walking_glb_url,
      runAnimUrl: anims?.running_glb_url,
    } : undefined

    return {
      status: mapMeshyStatus(data.status),
      progress: data.progress ?? 0,
      resultUrl: rigGlbUrl,
      rigResult,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ANIMATION — Teach a rigged character to dance
  // ░▒▓ POST /v1/animations. ~10-20s. 3 credits per preset. ▓▒░
  // ░▒▓ 586 presets: DailyActions, Fighting, Dancing, Sports, Acrobatics, Emotes ▓▒░
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * animate — Apply an animation preset to a rigged model
   * The moment the sculpture learns to dance.
   */
  async animate(riggedTaskId: string, animationPresetId: string | string[]): Promise<{ taskId: string }> {
    // Meshy only supports single preset — take first if array
    const presetId = Array.isArray(animationPresetId) ? animationPresetId[0] : animationPresetId
    console.log(`[Forge:Meshy] Starting animate on task ${riggedTaskId} (preset: ${presetId})`)

    const res = await fetchWithTimeout(`${MESHY_V1}/animations`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        input_task_id: riggedTaskId,
        action_id: presetId,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Animate start failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as MeshyStartResponse
    console.log(`[Forge:Meshy] Animate task started: ${data.result}`)
    return { taskId: data.result }
  }

  /**
   * checkAnimateStatus — Poll the v1 animations endpoint
   */
  async checkAnimateStatus(taskId: string): Promise<{
    status: ConjureStatus
    progress: number
    resultUrl?: string
  }> {
    const res = await fetchWithTimeout(`${MESHY_V1}/animations/${taskId}`, {
      method: 'GET',
      headers: this.headers(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Animate status check failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as MeshyRemeshStatusResponse  // same shape
    return {
      status: mapMeshyStatus(data.status),
      progress: data.progress ?? 0,
      resultUrl: data.model_urls?.glb,
    }
  }

  /**
   * listAnimationPresets — Fetch the full 586-preset catalog
   * GET /v1/animations/presets — cached server-side for performance.
   */
  async listAnimationPresets(): Promise<AnimationPreset[]> {
    console.log(`[Forge:Meshy] Fetching animation presets...`)

    const res = await fetchWithTimeout(`${MESHY_V1}/animations/presets`, {
      method: 'GET',
      headers: this.headers(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Meshy] Animation presets fetch failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as AnimationPreset[]
    console.log(`[Forge:Meshy] Fetched ${data.length} animation presets`)
    return data
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY — because even blacksmiths need to rest between hammer strikes
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ▓▓▓▓【M̸E̸S̸H̸Y̸】▓▓▓▓ॐ▓▓▓▓【S̸C̸U̸L̸P̸T̸O̸R̸】▓▓▓▓
