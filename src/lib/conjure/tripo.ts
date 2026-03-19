// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Tripo Provider Client
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   ╔═══════════════════════════════════════════════════════════════╗
//   ║  Tripo — The Quick Sketcher                                   ║
//   ║                                                               ║
//   ║  Three tiers of speed and detail:                             ║
//   ║    draft    → raw shape, fastest in the west                  ║
//   ║    standard → balanced, the goldilocks zone                   ║
//   ║    premium  → maximum vertex luxury                           ║
//   ║                                                               ║
//   ║  A mother who knows when fast is good enough                  ║
//   ║  and when her child deserves the premium pass.                ║
//   ╚═══════════════════════════════════════════════════════════════╝
//
//   API: https://platform.tripo3d.ai/docs/api-reference
//
// ░▒▓█ TRIPO CONJURE CLIENT █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import type { ConjureProviderClient, ConjureStatus, ProviderName, MeshTopology, CharacterGenerationOptions, RigResult } from '@/lib/conjure/types'
import { writeFileSync } from 'fs'

// ═══════════════════════════════════════════════════════════════════════════
// TRIPO API TYPES — the sketcher's pencil marks
// ═══════════════════════════════════════════════════════════════════════════

interface TripoStartResponse {
  code: number
  data: {
    task_id: string
  }
}

interface TripoStatusResponse {
  code: number
  data: {
    status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'unknown'
    progress: number
    output?: {
      // Tripo API returns model as string (old) or { type, url } (v2+)
      model?: string | { type?: string; url?: string }
      rendered_image?: string | { url?: string }
      pbr_model?: string | { type?: string; url?: string }
      // ░▒▓ Rig/animate tasks may return in different fields ▓▒░
      rig?: string | { type?: string; url?: string }
      rigged_model?: string | { type?: string; url?: string }
      [key: string]: unknown  // catch-all for undocumented fields
    }
    result?: {
      model?: {
        url?: string
        type?: string
      }
      rendered_image?: {
        url?: string
      }
    }
  }
}

interface TripoUploadResponse {
  code: number
  data: {
    image_token: string
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIPO RIG TYPES — 8 creature archetypes, from biped to octopod
// ─═̷─═̷─ Where Meshy only rigs humanoids, Tripo rigs the whole animal kingdom ─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════

export type TripoRigType = 'biped' | 'quadruped' | 'hexapod' | 'octopod' | 'avian' | 'serpentine' | 'aquatic' | 'others'
export type TripoRigSpec = 'mixamo' | 'tripo'

/** Tripo animation presets — 16 built-in, per-rig-type */
export const TRIPO_ANIMATION_PRESETS = {
  biped: ['idle', 'walk', 'run', 'dive', 'climb', 'jump', 'slash', 'shoot', 'hurt', 'fall', 'turn'] as const,
  quadruped: ['quadruped:walk'] as const,
  hexapod: ['hexapod:walk'] as const,
  octopod: ['octopod:walk'] as const,
  serpentine: ['serpentine:march'] as const,
  aquatic: ['aquatic:march'] as const,
} as const

// ═══════════════════════════════════════════════════════════════════════════
// STATUS MAPPING — Tripo's language → Forge's language
// ═══════════════════════════════════════════════════════════════════════════

function mapTripoStatus(status: TripoStatusResponse['data']['status']): ConjureStatus {
  switch (status) {
    case 'queued':    return 'generating'
    case 'running':   return 'generating'
    case 'success':   return 'ready'
    case 'failed':    return 'failed'
    case 'cancelled': return 'failed'
    case 'unknown':   return 'generating'   // optimistic — might still be spinning up
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TIER → MODEL VERSION MAPPING
// Each tier maps to a Tripo model version. Higher tier = more polygons.
// ═══════════════════════════════════════════════════════════════════════════

function tierToModelVersion(tier: string): string {
  switch (tier) {
    case 'turbo':    return 'Turbo-v1.0-20250506'    // blazing fast, lower quality — time-sensitive apps
    case 'draft':    return 'v2.0-20240919'          // fast, solid geometry + PBR
    case 'standard': return 'v2.5-20250123'          // balanced speed/quality
    case 'premium':  return 'v3.1-20260211'          // latest gen, sculpture-level precision
    default:         return 'v2.5-20250123'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEEP URL SCANNER — When Tripo hides the download link in an unknown field
// ─═̷─═̷─ Brute-force the response tree for anything shaped like a URL ─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════

function deepScanForUrl(obj: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string' && obj.startsWith('https://')) return obj
    return undefined
  }
  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (typeof val === 'string' && val.startsWith('https://') && (val.includes('.glb') || val.includes('.fbx') || val.includes('model') || val.includes('download'))) {
      return val
    }
    if (typeof val === 'object' && val !== null) {
      // Check for { url: "..." } pattern
      const asObj = val as Record<string, unknown>
      if (typeof asObj.url === 'string' && asObj.url.startsWith('https://')) return asObj.url
      const deeper = deepScanForUrl(val, depth + 1)
      if (deeper) return deeper
    }
  }
  return undefined
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CLIENT — Tripo's voice in The Forge
// ═══════════════════════════════════════════════════════════════════════════

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi'

// ░▒▓ FETCH WITH TIMEOUT — no more "terminated" hangs ▓▒░
const API_TIMEOUT_MS = 60_000
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

export class TripoClient implements ConjureProviderClient {
  readonly name: ProviderName = 'tripo'

  private get apiKey(): string {
    const key = process.env.TRIPO_API_KEY
    if (!key) throw new Error('[Forge:Tripo] TRIPO_API_KEY not set. The sketcher has no pencil.')
    return key
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  /**
   * startGeneration — Sketch a prompt into existence
   *
   * Tier determines model version:
   *   draft    → v2.0 (fastest, solid geometry + PBR)
   *   standard → v2.5 (balanced speed/quality)
   *   premium  → v3.0 (sculpture-level precision)
   *
   * Character mode + image-to-3D supported.
   */
  async startGeneration(prompt: string, tier: string, options?: CharacterGenerationOptions & { imageUrl?: string }): Promise<{ taskId: string }> {
    console.log(`[Forge:Tripo] Starting ${tier} generation: "${prompt.slice(0, 60)}..."`)

    // ░▒▓ Image-to-3D branch — photo → geometry ▓▒░
    if (options?.imageUrl) {
      return this.imageToThreeD(options.imageUrl, tier, options)
    }

    // ░▒▓ A-pose prompt reinforcement — belt AND suspenders (same strategy as Meshy) ▓▒░
    // Tripo has NO explicit pose_mode/symmetry API params, so prompt text is our only lever.
    let reinforcedPrompt = prompt
    if (options?.poseMode === 'a-pose') {
      reinforcedPrompt += ', in A-pose, arms slightly away from body, symmetrical, front-facing'
      console.log(`[Forge:Tripo] Character mode: A-pose prompt reinforcement applied`)
    }
    if (options?.symmetry && !reinforcedPrompt.includes('symmetrical')) {
      reinforcedPrompt += ', symmetrical mesh'
    }

    // ░▒▓ Build the request body ▓▒░
    const body: Record<string, unknown> = {
      type: 'text_to_model',
      prompt: reinforcedPrompt,
      model_version: tierToModelVersion(tier),
      texture: true,
      pbr: true,
      out_format: 'glb',  // ░▒▓ EXPLICIT — never trust defaults after the FBX shapeshifter incident ▓▒░
    }

    // ░▒▓ NOTE: quad topology is NOT a valid param for text_to_model ▓▒░
    // Sending quad=true to Tripo generation tasks causes the API to return FBX
    // instead of GLB (the "shapeshifter" incident). quad is ONLY for smart_low_poly retopo.

    const res = await fetchWithTimeout(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Tripo] Start failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as TripoStartResponse
    const taskId = data.data.task_id
    console.log(`[Forge:Tripo] Task started: ${taskId}`)

    return { taskId }
  }

  /**
   * checkStatus — Ask the sketcher how the drawing is going
   */
  async checkStatus(taskId: string): Promise<{
    status: ConjureStatus
    progress: number
    resultUrl?: string
    thumbnailUrl?: string
  }> {
    const res = await fetchWithTimeout(`${TRIPO_BASE}/task/${taskId}`, {
      method: 'GET',
      headers: this.headers(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Tripo] Status check failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as TripoStatusResponse
    const status = mapTripoStatus(data.data.status)

    // ░▒▓ Tripo nests the model URL differently across API versions ▓▒░
    // v1: output.model = "https://..." (string)
    // v2+: output.model = { type: "glb", url: "https://..." } (object)
    // Some versions: result.model.url = "https://..."
    // PBR variant: output.pbr_model = string | { url }
    const extractUrl = (field: string | { type?: string; url?: string } | undefined): string | undefined => {
      if (!field) return undefined
      if (typeof field === 'string') return field
      if (typeof field === 'object' && field.url) return field.url
      return undefined
    }

    // ░▒▓ Try all known fields — generation, PBR, rig, animate, legacy ▓▒░
    const resultUrl =
      extractUrl(data.data.output?.model) ??
      extractUrl(data.data.output?.pbr_model) ??
      extractUrl(data.data.output?.rig) ??
      extractUrl(data.data.output?.rigged_model) ??
      data.data.result?.model?.url ??
      // ░▒▓ DEEP SCAN — if none of the known fields matched, brute-force scan output for URLs ▓▒░
      (data.data.status === 'success' ? deepScanForUrl(data.data.output) : undefined)

    const thumbnailUrl =
      data.data.result?.rendered_image?.url ??
      extractUrl(data.data.output?.rendered_image)

    // ░▒▓ Diagnostic: ALWAYS log raw response for successful rig/animate tasks ▓▒░
    if (data.data.status === 'success') {
      console.log(`[Forge:Tripo] SUCCESS raw output:`, JSON.stringify(data.data.output ?? data.data.result ?? 'NONE', null, 2))
      if (!resultUrl) {
        console.error(`[Forge:Tripo] STATUS=success but NO model URL found after deep scan!`)
      }
    }

    return {
      status,
      progress: data.data.progress ?? 0,
      resultUrl,
      thumbnailUrl,
    }
  }

  /**
   * downloadResult — Fetch the GLB from Tripo's servers
   * The sketch solidifies into something you can hold.
   */
  async downloadResult(resultUrl: string, destPath: string): Promise<void> {
    console.log(`[Forge:Tripo] Downloading GLB from: ${resultUrl.slice(0, 80)}...`)

    const res = await fetchWithTimeout(resultUrl, {}, DOWNLOAD_TIMEOUT_MS)
    if (!res.ok) {
      throw new Error(`[Forge:Tripo] Download failed (${res.status})`)
    }

    const buffer = Buffer.from(await res.arrayBuffer())

    // ░▒▓ SHAPESHIFTER DEFENSE — validate GLB magic bytes before saving ▓▒░
    // GLB files MUST start with 0x676C5446 ("glTF"). Anything else is an impostor.
    // Tripo has been caught returning FBX files in GLB clothing (conj_mlz4xu768ej6 incident)
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x46546C67) {
      const header = buffer.slice(0, 20).toString('ascii').replace(/[^\x20-\x7E]/g, '?')
      throw new Error(`[Forge:Tripo] Shapeshifter detected! Expected GLB (glTF magic), got: "${header}"`)
    }

    writeFileSync(destPath, buffer)

    console.log(`[Forge:Tripo] GLB saved to: ${destPath} (${(buffer.length / 1024).toFixed(1)} KB)`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // IMAGE-TO-3D — The camera's eye becomes a sculptor
  // ░▒▓ 2-step: upload image → get token → create task ▓▒░
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * uploadImage — Upload an image file to Tripo's STS endpoint
   * Returns a file_token used by image_to_model tasks.
   * Accepts: base64 data URIs, or raw Buffer + filename.
   */
  async uploadImage(imageDataUri: string): Promise<string> {
    console.log(`[Forge:Tripo] Uploading image (${(imageDataUri.length / 1024).toFixed(0)} KB)...`)

    // ░▒▓ Parse data URI: data:image/jpeg;base64,/9j/4AA... ▓▒░
    const match = imageDataUri.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!match) {
      throw new Error('[Forge:Tripo] Invalid image data URI — expected data:image/TYPE;base64,DATA')
    }
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
    const base64Data = match[2]
    const buffer = Buffer.from(base64Data, 'base64')

    // ░▒▓ Build multipart/form-data manually ▓▒░
    const boundary = '----TripoUpload' + Date.now().toString(36)
    const filename = `upload.${ext}`

    const bodyParts: Buffer[] = []
    bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/${ext === 'jpg' ? 'jpeg' : ext}\r\n\r\n`))
    bodyParts.push(buffer)
    bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

    const bodyBuffer = Buffer.concat(bodyParts)

    const res = await fetchWithTimeout(`${TRIPO_BASE}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Tripo] Image upload failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as TripoUploadResponse
    console.log(`[Forge:Tripo] Image uploaded, token: ${data.data.image_token.slice(0, 20)}...`)
    return data.data.image_token
  }

  /**
   * imageToThreeD — Upload image + create image_to_model task
   * Supports base64 data URIs (from drag-and-drop) and public URLs.
   */
  async imageToThreeD(imageUrl: string, tier: string, options?: CharacterGenerationOptions): Promise<{ taskId: string }> {
    console.log(`[Forge:Tripo] Starting image-to-3D: ${imageUrl.slice(0, 60)}...`)

    const body: Record<string, unknown> = {
      type: 'image_to_model',
      model_version: tierToModelVersion(tier),
      texture: true,
      pbr: true,
      out_format: 'glb',  // ░▒▓ EXPLICIT — same shapeshifter defense as text_to_model ▓▒░
    }

    // ░▒▓ Data URI → upload first → file_token. Public URL → direct (if supported) ▓▒░
    if (imageUrl.startsWith('data:')) {
      const fileToken = await this.uploadImage(imageUrl)
      // Detect extension from data URI
      const extMatch = imageUrl.match(/^data:image\/(\w+)/)
      const ext = extMatch ? (extMatch[1] === 'jpeg' ? 'jpg' : extMatch[1]) : 'jpg'
      body.file = { type: ext, file_token: fileToken }
    } else {
      // Public URL — Tripo may support direct URL, but safest path is upload
      // For now, pass as-is and let Tripo handle it
      body.file = { type: 'jpg', url: imageUrl }
    }

    // ░▒▓ NOTE: quad is NOT valid for image_to_model — only for smart_low_poly ▓▒░

    const res = await fetchWithTimeout(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Tripo] Image-to-3D start failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as TripoStartResponse
    console.log(`[Forge:Tripo] Image-to-3D task started: ${data.data.task_id}`)
    return { taskId: data.data.task_id }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RIGGING — Breathe a skeleton into Tripo's sculptures
  // ░▒▓ 8 rig types × 2 specs (mixamo/tripo). Universal creature rigging. ▓▒░
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * rig — Auto-rig a completed Tripo model
   * Unlike Meshy (humanoid only), Tripo rigs bipeds, quadrupeds, birds, fish...
   */
  async rig(sourceTaskId: string, options?: {
    rigType?: TripoRigType
    rigSpec?: TripoRigSpec
    outFormat?: 'glb' | 'fbx'
  }): Promise<{ taskId: string }> {
    const rigType = options?.rigType || 'biped'
    const rigSpec = options?.rigSpec || 'mixamo'
    console.log(`[Forge:Tripo] Starting rig on task ${sourceTaskId} (${rigType}, spec: ${rigSpec})`)

    const body: Record<string, unknown> = {
      type: 'animate_rig',
      original_model_task_id: sourceTaskId,
      out_format: options?.outFormat || 'glb',
    }
    if (rigType) body.rig_type = rigType
    if (rigSpec) body.spec = rigSpec

    const res = await fetchWithTimeout(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Tripo] Rig start failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as TripoStartResponse
    console.log(`[Forge:Tripo] Rig task started: ${data.data.task_id}`)
    return { taskId: data.data.task_id }
  }

  /**
   * checkRigStatus — Poll a rigging task (same endpoint as any task)
   * Tripo uses the same /task/{id} endpoint for ALL task types.
   */
  async checkRigStatus(taskId: string): Promise<{
    status: ConjureStatus
    progress: number
    resultUrl?: string
    rigResult?: RigResult
  }> {
    // ░▒▓ Tripo uses the same status endpoint for everything ▓▒░
    const statusResult = await this.checkStatus(taskId)
    return {
      ...statusResult,
      // Tripo doesn't separate rig output like Meshy does — the GLB IS the rigged model
      rigResult: statusResult.status === 'ready' ? {
        riggedGlbUrl: statusResult.resultUrl,
      } : undefined,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ANIMATION — Teach a rigged sculpture to dance
  // ░▒▓ animate_retarget task. 16 presets per rig type. ▓▒░
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * animate — Apply a single animation preset to a rigged Tripo model
   *
   * Auto-prepends "preset:" if not already present (safety net for bare names like "walk").
   *
   * NOTE: Tripo only supports ONE preset per animate_retarget task.
   * The plural `animations: [...]` param does NOT work (stalls at 99% then fails).
   * Additional animations come from external Mixamo FBX files applied client-side.
   */
  async animate(riggedTaskId: string, animationPresetId: string | string[]): Promise<{ taskId: string }> {
    // ░▒▓ Accept array for interface compat but only use first element ▓▒░
    const raw = Array.isArray(animationPresetId) ? animationPresetId[0] : animationPresetId
    const normalized = raw.startsWith('preset:') ? raw : `preset:${raw}`
    console.log(`[Forge:Tripo] Starting animate on task ${riggedTaskId} (preset: ${normalized})`)

    const body: Record<string, unknown> = {
      type: 'animate_retarget',
      original_model_task_id: riggedTaskId,
      out_format: 'glb',
      bake_animation: true,
      animation: normalized,
    }

    const res = await fetchWithTimeout(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Tripo] Animate start failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as TripoStartResponse
    console.log(`[Forge:Tripo] Animate task started: ${data.data.task_id}`)
    return { taskId: data.data.task_id }
  }

  /**
   * checkAnimateStatus — Poll an animation task (same /task/{id} endpoint)
   */
  async checkAnimateStatus(taskId: string): Promise<{
    status: ConjureStatus
    progress: number
    resultUrl?: string
  }> {
    return this.checkStatus(taskId)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RETOPOLOGY — Clean up the sculpture's wireframe for game engines
  // ░▒▓ smart_low_poly = dedicated retopo engine (8-10s). convert = general. ▓▒░
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * remesh — Retopologize a Tripo model via smart_low_poly
   * The quick retopo engine: ~8-10s, face_limit control, quad/tri toggle.
   */
  async remesh(sourceTaskId: string, options: {
    topology: MeshTopology
    targetPolycount: number
  }): Promise<{ taskId: string }> {
    console.log(`[Forge:Tripo] Starting retopo on task ${sourceTaskId} (${options.topology}, ${options.targetPolycount} faces)`)

    const res = await fetchWithTimeout(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        type: 'smart_low_poly',
        original_model_task_id: sourceTaskId,
        quad: options.topology === 'quad',
        face_limit: options.targetPolycount,
        out_format: 'glb',
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[Forge:Tripo] Retopo start failed (${res.status}): ${errText}`)
    }

    const data = (await res.json()) as TripoStartResponse
    console.log(`[Forge:Tripo] Retopo task started: ${data.data.task_id}`)
    return { taskId: data.data.task_id }
  }

  /**
   * checkRemeshStatus — Poll a retopo task (same /task/{id} endpoint)
   */
  async checkRemeshStatus(taskId: string): Promise<{
    status: ConjureStatus
    progress: number
    resultUrl?: string
  }> {
    return this.checkStatus(taskId)
  }
}

// ▓▓▓▓【T̸R̸I̸P̸O̸】▓▓▓▓ॐ▓▓▓▓【S̸K̸E̸T̸C̸H̸E̸R̸】▓▓▓▓ॐ▓▓▓▓【U̸N̸I̸V̸E̸R̸S̸A̸L̸】▓▓▓▓
