// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANIMATION LIBRARY — Local dance moves, no API calls, infinite groove
// ─═̷─═̷─ॐ─═̷─═̷─ The dancefloor was built. Now we turn on the music. ─═̷─═̷─ॐ─═̷─═̷─
//
// Mixamo FBX files (downloaded without skin) → loaded with FBXLoader →
// AnimationClips extracted → retargeted to any rigged character.
//
// Providers rig differently:
//   Meshy: bone names like "Hips", "Spine", "LeftArm" (no prefix)
//   Tripo: bone names like "mixamorigHips", "mixamorigSpine" (mixamorig prefix)
//   Mixamo FBX: tracks like "mixamorigHips.quaternion"
//
// The retargetClip() function bridges these worlds.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

const OASIS_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_BASE_PATH || '')
  : ''

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION CATALOG — What's on the jukebox
// ═══════════════════════════════════════════════════════════════════════════════

export type AnimCategory = 'locomotion' | 'dance' | 'combat' | 'emote' | 'acrobatics'

export interface LocalAnimation {
  id: string
  filename: string
  label: string
  category: AnimCategory
}

export const ANIMATION_LIBRARY: LocalAnimation[] = [
  // ░▒▓ Locomotion ▓▒░
  { id: 'idle',        filename: 'Breathing Idle.fbx',               label: 'Idle',          category: 'locomotion' },
  { id: 'walk',        filename: 'Unarmed Walk Forward.fbx',        label: 'Walk',       category: 'locomotion' },
  { id: 'run',         filename: 'Medium Run.fbx',                  label: 'Run',           category: 'locomotion' },
  { id: 'sprint',      filename: 'Running.fbx',                     label: 'Sprint',        category: 'locomotion' },
  { id: 'idle-fight',  filename: 'Standing Idle To Fight Idle.fbx',  label: 'Fight Idle',       category: 'locomotion' },
  { id: 'drunk-walk',  filename: 'Drunk Walk.fbx',                  label: 'Drunk Walk', category: 'locomotion' },
  { id: 'catwalk',     filename: 'Catwalk Walk Turn 180 Tight.fbx', label: 'Catwalk',    category: 'locomotion' },
  { id: 'low-crawl',   filename: 'Low Crawl.fbx',                   label: 'Low Crawl',  category: 'locomotion' },

  // ░▒▓ Dance ▓▒░
  { id: 'breakdance',  filename: 'Breakdance 1990.fbx',             label: 'Breakdance',     category: 'dance' },
  { id: 'freeze',      filename: 'Breakdance Freeze Var 3.fbx',     label: 'Freeze',         category: 'dance' },
  { id: 'twirl',       filename: 'Butterfly Twirl.fbx',             label: 'Butterfly Twirl',category: 'dance' },
  { id: 'capoeira',    filename: 'Capoeira.fbx',                    label: 'Capoeira',       category: 'dance' },
  { id: 'hip-hop',     filename: 'Hip Hop Dancing.fbx',             label: 'Hip Hop',        category: 'dance' },
  { id: 'moonwalk',    filename: 'Moonwalk.fbx',                    label: 'Moonwalk',       category: 'dance' },
  { id: 'shuffling',   filename: 'Shuffling.fbx',                   label: 'Shuffling',      category: 'dance' },
  { id: 'thriller',    filename: 'Thriller Part 3.fbx',             label: 'Thriller',       category: 'dance' },
  { id: 'twerk',       filename: 'Dancing Twerk.fbx',               label: 'Twerk',          category: 'dance' },
  { id: 'twist',       filename: 'Twist Dance.fbx',                 label: 'Twist',          category: 'dance' },

  // ░▒▓ Combat ▓▒░
  { id: 'mma-kick',    filename: 'Mma Kick.fbx',                    label: 'MMA Kick',  category: 'combat' },

  // ░▒▓ Emote ▓▒░
  { id: 'praying',     filename: 'Praying.fbx',                     label: 'Praying',   category: 'emote' },
  { id: 'situps',      filename: 'Situps.fbx',                      label: 'Situps',    category: 'emote' },

  // ░▒▓ Acrobatics ▓▒░
  { id: 'jump',        filename: 'Jump.fbx',                        label: 'Jump',       category: 'acrobatics' },
  { id: 'front-flip',  filename: 'Front Flip.fbx',                  label: 'Front Flip', category: 'acrobatics' },
  { id: 'twist-flip',  filename: 'Front Twist Flip.fbx',            label: 'Twist Flip', category: 'acrobatics' },
]

// Category display order + emoji
export const ANIM_CATEGORIES: { id: AnimCategory; label: string; icon: string }[] = [
  { id: 'locomotion',  label: 'Move',      icon: '🚶' },
  { id: 'dance',       label: 'Dance',     icon: '💃' },
  { id: 'combat',      label: 'Combat',    icon: '⚔' },
  { id: 'emote',       label: 'Emote',     icon: '🙏' },
  { id: 'acrobatics',  label: 'Acrobat',   icon: '🤸' },
]

// ═══════════════════════════════════════════════════════════════════════════════
// BONE NAME MAPPING — The Rosetta Stone of rigged characters
// ░▒▓ Mixamo FBX uses "mixamorigHips", Meshy GLBs use "Hips" ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

// ░▒▓ Meshy spine naming: Spine01/Spine02 instead of Spine1/Spine2 ▓▒░
const SPINE_ALIASES: Record<string, string> = {
  'Spine1': 'Spine01',
  'Spine2': 'Spine02',
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIXAMO → VRM BONE MAPPING — Bridge between Mixamo FBX and VRM humanoid
// ░▒▓ VRM uses its own standard names (hips, spine, chest, leftUpperArm...) ▓▒░
// ░▒▓ Mixamo uses mixamorigHips, mixamorigSpine, mixamorigSpine1... ▓▒░
// The normalized VRM skeleton from @pixiv/three-vrm names bones exactly
// matching VRM standard (lowercase). This table maps Mixamo bare → VRM.
// ═══════════════════════════════════════════════════════════════════════════════

const MIXAMO_TO_VRM: Record<string, string> = {
  // Core
  'Hips': 'hips', 'Spine': 'spine', 'Spine1': 'chest', 'Spine2': 'upperChest',
  'Neck': 'neck', 'Head': 'head',
  // Left arm
  'LeftShoulder': 'leftShoulder', 'LeftArm': 'leftUpperArm',
  'LeftForeArm': 'leftLowerArm', 'LeftHand': 'leftHand',
  // Right arm
  'RightShoulder': 'rightShoulder', 'RightArm': 'rightUpperArm',
  'RightForeArm': 'rightLowerArm', 'RightHand': 'rightHand',
  // Left leg
  'LeftUpLeg': 'leftUpperLeg', 'LeftLeg': 'leftLowerLeg',
  'LeftFoot': 'leftFoot', 'LeftToeBase': 'leftToes',
  // Right leg
  'RightUpLeg': 'rightUpperLeg', 'RightLeg': 'rightLowerLeg',
  'RightFoot': 'rightFoot', 'RightToeBase': 'rightToes',
  // Fingers (left)
  'LeftHandThumb1': 'leftThumbMetacarpal', 'LeftHandThumb2': 'leftThumbProximal', 'LeftHandThumb3': 'leftThumbDistal',
  'LeftHandIndex1': 'leftIndexProximal', 'LeftHandIndex2': 'leftIndexIntermediate', 'LeftHandIndex3': 'leftIndexDistal',
  'LeftHandMiddle1': 'leftMiddleProximal', 'LeftHandMiddle2': 'leftMiddleIntermediate', 'LeftHandMiddle3': 'leftMiddleDistal',
  'LeftHandRing1': 'leftRingProximal', 'LeftHandRing2': 'leftRingIntermediate', 'LeftHandRing3': 'leftRingDistal',
  'LeftHandPinky1': 'leftLittleProximal', 'LeftHandPinky2': 'leftLittleIntermediate', 'LeftHandPinky3': 'leftLittleDistal',
  // Fingers (right)
  'RightHandThumb1': 'rightThumbMetacarpal', 'RightHandThumb2': 'rightThumbProximal', 'RightHandThumb3': 'rightThumbDistal',
  'RightHandIndex1': 'rightIndexProximal', 'RightHandIndex2': 'rightIndexIntermediate', 'RightHandIndex3': 'rightIndexDistal',
  'RightHandMiddle1': 'rightMiddleProximal', 'RightHandMiddle2': 'rightMiddleIntermediate', 'RightHandMiddle3': 'rightMiddleDistal',
  'RightHandRing1': 'rightRingProximal', 'RightHandRing2': 'rightRingIntermediate', 'RightHandRing3': 'rightRingDistal',
  'RightHandPinky1': 'rightLittleProximal', 'RightHandPinky2': 'rightLittleIntermediate', 'RightHandPinky3': 'rightLittleDistal',
}

/**
 * Retarget a Mixamo animation clip for a specific VRM model.
 *
 * WHY THIS NEEDS THE ACTUAL VRM OBJECT:
 * three-vrm creates "normalized" proxy bones named "Normalized_" + ORIGINAL_BONE_NAME,
 * where ORIGINAL_BONE_NAME is the raw GLTF bone name (e.g. "J_Bip_C_Hips" for VRoid,
 * "Hips" for Mixamo-rigged VRMs). This is file-specific — we can't use a static table.
 * The AnimationMixer targets bones by name in the scene. Using a wrong name = silent no-op.
 *
 * This function queries vrm.humanoid.getNormalizedBoneNode(vrmBoneName) to get the actual
 * node for each VRM humanoid bone, reads its .name, and retargets Mixamo tracks to that.
 */
export function retargetClipForVRM(
  clip: THREE.AnimationClip,
  vrm: VRM,
  cacheKey: string,
): THREE.AnimationClip {
  const fullKey = `vrm3__${clip.name}__${cacheKey}`
  if (retargetCache.has(fullKey)) {
    return retargetCache.get(fullKey)!
  }

  // Build per-VRM mapping: Mixamo bare name → actual normalized bone node name
  // e.g. "Hips" → "Normalized_J_Bip_C_Hips" (for VRoid avatars)
  const mixamoToNodeName: Record<string, string> = {}
  for (const [mixamoBare, vrmBoneName] of Object.entries(MIXAMO_TO_VRM)) {
    const node = vrm.humanoid.getNormalizedBoneNode(vrmBoneName as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
    if (node) mixamoToNodeName[mixamoBare] = node.name
  }

  // ░▒▓ REST-POSE COMPENSATION — the key to non-twisted VRM animations ▓▒░
  // Mixamo tracks store ABSOLUTE quaternions (bone's local rotation in that frame).
  // VRM normalized bones expect DELTAS from identity (T-pose = no rotation).
  // Formula: vrmRotation = mixamoRestInverse × mixamoAbsoluteRotation
  const animId = clip.name.replace(LIB_PREFIX, '')
  const restRotations = mixamoRestCache.get(animId)

  let remapped = 0
  let unmapped = 0
  let compensated = 0

  const tracks = clip.tracks.map(track => {
    const dotIdx = track.name.indexOf('.')
    if (dotIdx === -1) return track.clone()

    const boneName = track.name.substring(0, dotIdx)
    const property = track.name.substring(dotIdx)

    // Strip "mixamorig" prefix → bare Mixamo name → actual node name in this VRM
    const bare = boneName.replace(/^mixamorig/, '')
    const nodeName = mixamoToNodeName[bare]

    if (nodeName) {
      remapped++
      const t = track.clone()
      t.name = nodeName + property

      // Apply rest-pose compensation to quaternion tracks
      // This is the difference between "Mixamo says rotate to Q" and "VRM says rotate by delta-Q"
      if (property === '.quaternion' && restRotations) {
        const restQ = restRotations.get(boneName)
        if (restQ) {
          const restInv = restQ.clone().invert()
          const vals = t.values
          const tmpQ = new THREE.Quaternion()
          for (let i = 0; i < vals.length; i += 4) {
            tmpQ.set(vals[i], vals[i + 1], vals[i + 2], vals[i + 3])
            tmpQ.premultiply(restInv)  // result = restInv * animQ
            vals[i] = tmpQ.x; vals[i + 1] = tmpQ.y; vals[i + 2] = tmpQ.z; vals[i + 3] = tmpQ.w
          }
          compensated++
        }
      }

      return t
    }

    unmapped++
    return track.clone()
  })

  const retargeted = new THREE.AnimationClip(clip.name, clip.duration, tracks)
  retargetCache.set(fullKey, retargeted)
  console.log(`[AnimLib:VRM] Retargeted "${clip.name}" (${cacheKey}): ${remapped} mapped, ${compensated} compensated, ${unmapped} unmapped`)
  return retargeted
}

/**
 * Build a mapping from normalized Mixamo track bone names → target skeleton bone names.
 *
 * Our FBX animation tracks are normalized to "mixamorigHips", "mixamorigSpine", etc.
 * Target skeletons come in multiple flavors:
 *   - Tripo:  "mixamorig:Hips" (colon-separated prefix)
 *   - Meshy:  "Hips", "Spine01", "neck" (bare, sometimes different casing/numbering)
 *   - Direct: "mixamorigHips" (rare, would be a perfect match)
 *
 * Rather than iterating a hardcoded bone list, we resolve per-track dynamically.
 */
export function buildBoneMap(targetBoneNames: string[]): Map<string, string> {
  const map = new Map<string, string>()
  const targetSet = new Set(targetBoneNames)

  // Build lookups for fuzzy matching
  const targetLower = new Map<string, string>()  // lowercase → original
  const targetNoColon = new Map<string, string>() // colonless → original (Tripo "mixamorig:Hips")
  for (const name of targetBoneNames) {
    targetLower.set(name.toLowerCase(), name)
    // "mixamorig:Hips" → key "mixamorigHips" → value "mixamorig:Hips"
    targetNoColon.set(name.replace(/:/g, ''), name)
  }

  // Return a lazy-resolving Map: resolves bone names on first access
  const lazyMap: Map<string, string> = {
    get(trackBoneName: string): string | undefined {
      if (map.has(trackBoneName)) return map.get(trackBoneName)
      const resolved = resolveBone(trackBoneName, targetSet, targetLower, targetNoColon)
      if (resolved) map.set(trackBoneName, resolved)
      return resolved
    },
    has(trackBoneName: string): boolean {
      return this.get(trackBoneName) !== undefined
    },
    set(k: string, v: string) { map.set(k, v); return this },
    get size() { return map.size },
    entries() { return map.entries() },
    keys() { return map.keys() },
    values() { return map.values() },
    forEach(cb: (v: string, k: string, m: Map<string, string>) => void) { map.forEach(cb) },
    delete(k: string) { return map.delete(k) },
    clear() { map.clear() },
    [Symbol.iterator]() { return map.entries() },
    [Symbol.toStringTag]: 'BoneMap',
  } as Map<string, string>

  return lazyMap
}

function resolveBone(
  trackBone: string,
  targetSet: Set<string>,
  targetLower: Map<string, string>,
  targetNoColon: Map<string, string>,
): string | undefined {
  // Strategy 1: Direct match ("mixamorigHips" → "mixamorigHips")
  if (targetSet.has(trackBone)) return trackBone

  // Strategy 2: Track bone matches target with colons stripped
  // Our track: "mixamorigHips" → targetNoColon has "mixamorigHips" → "mixamorig:Hips"
  const colonMatch = targetNoColon.get(trackBone)
  if (colonMatch) return colonMatch

  // Strategy 3: Strip "mixamorig" prefix → bare name ("Hips")
  const bare = trackBone.replace(/^mixamorig/, '')
  if (targetSet.has(bare)) return bare

  // Strategy 4: Case-insensitive bare name ("neck" vs "Neck")
  const lowerBare = bare.toLowerCase()
  const lowerMatch = targetLower.get(lowerBare)
  if (lowerMatch) return lowerMatch

  // Strategy 5: Meshy spine aliases (Spine1 → Spine01, Spine2 → Spine02)
  const alias = SPINE_ALIASES[bare]
  if (alias && targetSet.has(alias)) return alias

  // Strategy 6: Case-insensitive on full name
  const lowerFull = trackBone.toLowerCase()
  const fullLowerMatch = targetLower.get(lowerFull)
  if (fullLowerMatch) return fullLowerMatch

  return undefined
}

/**
 * Retarget a library animation clip to match a specific character's bone names.
 * Creates a new clip with remapped track names. Cached per skeleton type.
 */
const retargetCache = new Map<string, THREE.AnimationClip>()

export function retargetClip(
  clip: THREE.AnimationClip,
  targetBoneNames: string[],
  cacheKey: string,
): THREE.AnimationClip {
  const fullKey = `${clip.name}__${cacheKey}`
  if (retargetCache.has(fullKey)) {
    return retargetCache.get(fullKey)!
  }

  const boneMap = buildBoneMap(targetBoneNames)
  let remapped = 0
  let unmapped = 0

  const remappedTracks = clip.tracks.map(track => {
    const dotIdx = track.name.indexOf('.')
    if (dotIdx === -1) return track.clone()

    const boneName = track.name.substring(0, dotIdx)
    const property = track.name.substring(dotIdx)

    const mappedBone = boneMap.get(boneName)
    if (mappedBone) {
      if (mappedBone !== boneName) remapped++
      const newTrack = track.clone()
      newTrack.name = mappedBone + property
      return newTrack
    }
    // No mapping found — keep original (will be silently ignored by mixer)
    unmapped++
    return track.clone()
  })

  const retargeted = new THREE.AnimationClip(
    clip.name,
    clip.duration,
    remappedTracks,
  )

  console.log(`[AnimLib] Retargeted "${clip.name}" for "${cacheKey}": ${remapped} remapped, ${unmapped} unmapped, ${clip.tracks.length} total tracks`)

  retargetCache.set(fullKey, retargeted)
  return retargeted
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION CLIP CACHE — Load once, reuse forever
// ░▒▓ FBXLoader extracts clips from Mixamo "without skin" files ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const clipCache = new Map<string, THREE.AnimationClip>()
const loadingPromises = new Map<string, Promise<THREE.AnimationClip | null>>()

// ░▒▓ MIXAMO REST ROTATIONS — per-bone T-pose quaternions extracted from FBX skeleton ▓▒░
// VRM normalized bones expect rotations relative to identity (T-pose = no rotation).
// Mixamo tracks store ABSOLUTE rotations. To convert:
//   VRM_normalized = MixamoRestInverse × MixamoAbsolute
// This strips the Mixamo rest frame, leaving only the pure delta.
const mixamoRestCache = new Map<string, Map<string, THREE.Quaternion>>()

/** The lib: prefix indicates a library animation in behavior config */
export const LIB_PREFIX = 'lib:'

/**
 * Load an animation clip from the library by ID.
 * Returns cached clip if already loaded, otherwise fetches + parses the FBX.
 * Clips are stored with Mixamo naming — use retargetClip() to adapt to specific skeletons.
 */
export async function loadAnimationClip(animId: string): Promise<THREE.AnimationClip | null> {
  // Check cache first
  if (clipCache.has(animId)) {
    return clipCache.get(animId)!
  }

  // Dedupe concurrent loads
  if (loadingPromises.has(animId)) {
    return loadingPromises.get(animId)!
  }

  const entry = ANIMATION_LIBRARY.find(a => a.id === animId)
  if (!entry) {
    console.warn(`[AnimLib] Animation "${animId}" not found in library`)
    return null
  }

  const promise = (async () => {
    try {
      // Dynamic import — FBXLoader uses DOM APIs, must be client-side only
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
      const loader = new FBXLoader()

      const url = `${OASIS_BASE}/animations/${encodeURIComponent(entry.filename)}`
      console.log(`[AnimLib] Loading ${animId} from ${url}`)

      const fbx = await new Promise<THREE.Group>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject)
      })

      if (!fbx.animations || fbx.animations.length === 0) {
        console.warn(`[AnimLib] ${animId}: FBX has no animations`)
        return null
      }

      // ░▒▓ Extract Mixamo rest rotations from FBX skeleton ▓▒░
      // "Without skin" FBX still has bones in T-pose. Their .quaternion = rest rotation.
      // We need this to compensate VRM normalized animations later.
      const restRotations = new Map<string, THREE.Quaternion>()
      fbx.traverse((child) => {
        if ((child as THREE.Bone).isBone) {
          let name = child.name
          // Same normalization as track names
          if (name.includes('|')) name = name.split('|').pop()!
          name = name.replace(/:/g, '')
          restRotations.set(name, child.quaternion.clone())
        }
      })
      if (restRotations.size > 0) {
        mixamoRestCache.set(animId, restRotations)
        console.log(`[AnimLib] ${animId}: extracted ${restRotations.size} bone rest rotations`)
      }

      // Extract the first clip
      const rawClip = fbx.animations[0]

      // ░▒▓ TRACK NAME NORMALIZATION ▓▒░
      // Normalize FBX track names to canonical Mixamo format: "mixamorigHips.quaternion"
      // Strip prefixes like "Armature|" and convert colons: "mixamorig:Hips" → "mixamorigHips"
      const sampleTrackNames = rawClip.tracks.slice(0, 3).map(t => t.name)
      console.log(`[AnimLib] ${animId} raw tracks (first 3):`, sampleTrackNames)

      const normalizedTracks: THREE.KeyframeTrack[] = []

      for (const track of rawClip.tracks) {
        const dotIdx = track.name.indexOf('.')
        if (dotIdx === -1) {
          normalizedTracks.push(track.clone())
          continue
        }

        let objectPath = track.name.substring(0, dotIdx)
        const property = track.name.substring(dotIdx)  // includes the dot

        // Strip common prefixes: "Armature|" or namespace separators
        if (objectPath.includes('|')) {
          objectPath = objectPath.split('|').pop()!
        }

        // Normalize Mixamo naming: "mixamorig:Hips" → "mixamorigHips"
        objectPath = objectPath.replace(/:/g, '')

        const normalizedName = objectPath + property

        // ░▒▓ ROOT MOTION — Keep Y-axis bob, zero X/Z drift ▓▒░
        // The hip up-down motion makes walking look natural.
        // X/Z translation would teleport the character off its Oasis position.
        if (objectPath === 'mixamorigHips' && property === '.position') {
          // ░▒▓ ROOT POSITION — strip entirely ▓▒░
          // FBX stores absolute hip positions (e.g. Y=97cm). Applied to a world-space
          // model this teleports it. Stripping the whole track is safest — the skeleton
          // rest pose already positions the hips correctly, and rotation tracks handle
          // the body movement. Keeping Y-bob caused -infinity teleports on Tripo.
          console.log(`[AnimLib] ${animId}: stripped root position track entirely (prevents teleport)`)
          continue  // skip this track
        }

        const newTrack = track.clone()
        newTrack.name = normalizedName
        normalizedTracks.push(newTrack)
      }

      const clip = new THREE.AnimationClip(
        `${LIB_PREFIX}${animId}`,
        rawClip.duration,
        normalizedTracks,
      )

      // Cache it
      clipCache.set(animId, clip)
      console.log(`[AnimLib] ${animId} loaded: ${clip.duration.toFixed(1)}s, ${clip.tracks.length} tracks`)

      // Dispose the FBX scene — we only need the clip
      fbx.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose()
          const mat = child.material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else if (mat) mat.dispose()
        }
      })

      return clip
    } catch (err) {
      console.error(`[AnimLib] Failed to load ${animId}:`, err)
      return null
    } finally {
      loadingPromises.delete(animId)
    }
  })()

  loadingPromises.set(animId, promise)
  return promise
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLTF CLIP EXTRACTION — Steal animations from character GLTFs for VRM avatars
// ░▒▓ Character GLTFs (Leela, Mike, etc.) have proper looping Idle/Walk clips ▓▒░
// ░▒▓ Way better quality than Mixamo FBX transition clips (no snap, clean loops) ▓▒░
// Same retargeting pipeline — rest-pose compensation works identically.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load an animation clip from a character GLTF file (not FBX).
 * Extracts the named clip + skeleton rest rotations → caches both.
 * Track names normalized same as FBX pipeline → compatible with retargetClipForVRM.
 */
export async function loadClipFromGLTF(
  gltfPath: string,
  clipPattern: RegExp,
  animId: string,
): Promise<THREE.AnimationClip | null> {
  if (clipCache.has(animId)) return clipCache.get(animId)!
  if (loadingPromises.has(animId)) return loadingPromises.get(animId)!

  const promise = (async () => {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const loader = new GLTFLoader()

      const url = `${OASIS_BASE}${gltfPath}`
      console.log(`[AnimLib:GLTF] Loading /${clipPattern.source}/ from ${url}`)

      const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
        loader.load(url, resolve as any, undefined, reject)
      })

      if (!gltf.animations || gltf.animations.length === 0) {
        console.warn(`[AnimLib:GLTF] ${gltfPath} has no animations`)
        return null
      }

      // Find clip matching pattern
      const rawClip = gltf.animations.find(a => clipPattern.test(a.name))
      if (!rawClip) {
        console.warn(`[AnimLib:GLTF] No clip matching /${clipPattern.source}/ in ${gltfPath}. Available:`, gltf.animations.map(a => a.name))
        return null
      }

      // ░▒▓ Extract rest rotations from GLTF skeleton — same formula as FBX pipeline ▓▒░
      const restRotations = new Map<string, THREE.Quaternion>()
      gltf.scene.traverse((child) => {
        if ((child as THREE.Bone).isBone) {
          let name = child.name
          if (name.includes('|')) name = name.split('|').pop()!
          name = name.replace(/:/g, '')
          restRotations.set(name, child.quaternion.clone())
        }
      })
      if (restRotations.size > 0) {
        mixamoRestCache.set(animId, restRotations)
        console.log(`[AnimLib:GLTF] ${animId}: ${restRotations.size} rest rotations from ${gltfPath}`)
      }

      // Log first 5 bone names + first 3 track names for debugging
      const boneNames = [...restRotations.keys()].slice(0, 5)
      const trackSample = rawClip.tracks.slice(0, 3).map(t => t.name)
      console.log(`[AnimLib:GLTF] ${animId} bones (first 5):`, boneNames)
      console.log(`[AnimLib:GLTF] ${animId} tracks (first 3):`, trackSample)

      // Normalize tracks — same pipeline as FBX: strip prefixes, remove colons, kill root position
      const normalizedTracks: THREE.KeyframeTrack[] = []
      for (const track of rawClip.tracks) {
        const dotIdx = track.name.indexOf('.')
        if (dotIdx === -1) { normalizedTracks.push(track.clone()); continue }

        let boneName = track.name.substring(0, dotIdx)
        const property = track.name.substring(dotIdx)

        if (boneName.includes('|')) boneName = boneName.split('|').pop()!
        boneName = boneName.replace(/:/g, '')

        // Strip root position — prevents teleporting (same as FBX pipeline)
        if ((boneName === 'Hips' || boneName === 'mixamorigHips') && property === '.position') {
          continue
        }

        const newTrack = track.clone()
        newTrack.name = boneName + property
        normalizedTracks.push(newTrack)
      }

      const clip = new THREE.AnimationClip(
        `${LIB_PREFIX}${animId}`,
        rawClip.duration,
        normalizedTracks,
      )

      clipCache.set(animId, clip)
      console.log(`[AnimLib:GLTF] ${animId} loaded: "${rawClip.name}" ${clip.duration.toFixed(1)}s, ${normalizedTracks.length} tracks`)

      // Dispose GLTF scene — we only needed clips + rest rotations
      gltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.geometry?.dispose()
          const mat = mesh.material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else if (mat) (mat as THREE.Material).dispose()
        }
      })

      return clip
    } catch (err) {
      console.error(`[AnimLib:GLTF] Failed to load from ${gltfPath}:`, err)
      return null
    } finally {
      loadingPromises.delete(animId)
    }
  })()

  loadingPromises.set(animId, promise)
  return promise
}

/**
 * Get a cached clip synchronously — returns null if not yet loaded.
 * Use loadAnimationClip() to trigger loading first.
 */
export function getCachedClip(animId: string): THREE.AnimationClip | null {
  return clipCache.get(animId) || null
}

/**
 * Check if an animation ID refers to the local library (prefixed with "lib:")
 */
export function isLibraryAnimation(clipName: string): boolean {
  return clipName.startsWith(LIB_PREFIX)
}

/**
 * Extract the library animation ID from a clip name
 */
export function getLibraryAnimId(clipName: string): string {
  return clipName.replace(LIB_PREFIX, '')
}

// ▓▓▓▓【A̸N̸I̸M̸】▓▓▓▓ॐ▓▓▓▓【L̸I̸B̸R̸A̸R̸Y̸】▓▓▓▓
