// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANIMATION STATE MACHINE — Character animation transitions
// ─═̷─═̷─ॐ─═̷─═̷─ Idle → Walk → Run → any custom animation ─═̷─═̷─ॐ─═̷─═̷─
//
// Used by both PlayerAvatar and VRM catalog characters.
// Each character gets its own AnimationController instance.
// The controller owns the mixer, clips, active action, and transition logic.
//
// States:
//   idle   — breathing/standing still (default)
//   walk   — slow movement
//   run    — fast movement
//   custom — any animation from the library (dance, combat, emote)
//
// Transitions are crossfaded over a configurable duration.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { loadAnimationClip, retargetClipForVRM, retargetUALClipForVRM, isUALAnimation, getClipTravel } from './forge/animation-library'
import { buildAuthoredClip, isAuthoredClip } from './forge/authored-clips'
import { locomotionClipId } from './forge/locomotion-set'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type AnimState = 'idle' | 'walk' | 'run' | 'sprint' | 'custom'

export interface AnimationControllerConfig {
  crossfadeDuration?: number  // seconds, default 0.3
  walkSpeedThreshold?: number // velocity magnitude below which we idle
  runSpeedThreshold?: number  // velocity magnitude above which we run
  sprintSpeedThreshold?: number // velocity above which we sprint
  runTimeScale?: number       // animation playback speed for run (default 1)
  sprintTimeScale?: number    // animation playback speed for sprint (default 1)
}

const DEFAULT_CONFIG: Required<AnimationControllerConfig> = {
  crossfadeDuration: 0.3,
  walkSpeedThreshold: 0.5,
  runSpeedThreshold: 3.0,
  sprintSpeedThreshold: 7.0,
  runTimeScale: 1,
  sprintTimeScale: 1,
}

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATION CONTROLLER — one per character
// ═══════════════════════════════════════════════════════════════════════════

export class AnimationController {
  private mixer: THREE.AnimationMixer
  private vrm: VRM
  private config: Required<AnimationControllerConfig>
  private vrmCacheKey: string  // unique per VRM skeleton (prevents cross-avatar cache poisoning)

  // Clip cache (loaded + retargeted)
  private clips: Map<string, THREE.AnimationClip> = new Map()
  private loadingClips: Set<string> = new Set()

  // State
  private currentState: AnimState = 'idle'
  private currentAction: THREE.AnimationAction | null = null
  private customAnimId: string | null = null
  private disposed = false
  // Root motion (see consumeRootMotion): the hips' place when a dance was cut short, handed over
  // to the character's position as that dance fades out.
  /**
   * Root motion is for dances the owner of this controller started on purpose. Off (the default: remote
   * players, and custom clips such as a spell cast or the mana recharge), a clip moves the hips but never
   * the character.
   */
  public rootMotionEnabled = false
  private rootAbsorb: { x: number; z: number; givenX: number; givenZ: number; age: number } | null = null
  private transitionGeneration = 0  // increments on each transition, prevents stale async callbacks

  // Ready flag — true when at least idle clip is loaded
  public ready = false

  constructor(vrm: VRM, config?: AnimationControllerConfig) {
    this.vrm = vrm
    this.mixer = new THREE.AnimationMixer(vrm.scene)
    this.config = { ...DEFAULT_CONFIG, ...config }

    // VRM-specific cache key from hips bone — prevents T-pose on avatar switch
    const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips' as any)
    this.vrmCacheKey = hipsNode?.name || `vrm-${Date.now()}`

    // Pre-load locomotion clips
    this.loadClip('idle')
    this.loadClip('walk')
    this.loadClip('run')
    this.loadClip('sprint')
  }

  // ── CLIP LOADING ─────────────────────────────────────────────────────

  private async loadClip(animId: string): Promise<THREE.AnimationClip | null> {
    if (this.clips.has(animId)) return this.clips.get(animId)!
    if (this.loadingClips.has(animId)) return null // already loading

    this.loadingClips.add(animId)

    try {
      if (isAuthoredClip(animId)) {
        const built = buildAuthoredClip(animId, this.vrm)
        this.loadingClips.delete(animId)
        if (!built) return null
        this.clips.set(animId, built)
        return built
      }
      // walk / run / sprint come from the set picked in Settings > Experiments (Mixamo or the free Quaternius loops)
      const sourceId = locomotionClipId(animId)
      const rawClip = await loadAnimationClip(sourceId)
      if (!rawClip) {
        console.warn(`[AnimController] Failed to load clip: ${animId}`)
        this.loadingClips.delete(animId)
        return null
      }

      // UAL clips use UE skeleton → need UE→VRM retargeting. Mixamo clips use Mixamo→VRM.
      const retargeted = isUALAnimation(sourceId)
        ? retargetUALClipForVRM(rawClip, this.vrm, `${this.vrmCacheKey}__${sourceId}`)
        : retargetClipForVRM(rawClip, this.vrm, `${this.vrmCacheKey}__${sourceId}`)
      if (!retargeted || retargeted.tracks.length === 0) {
        console.warn(`[AnimController] Retarget produced empty clip: ${animId}`)
        this.loadingClips.delete(animId)
        return null
      }

      this.clips.set(animId, retargeted)
      this.loadingClips.delete(animId)

      // Mark ready when idle is loaded
      if (animId === 'idle') {
        this.ready = true
        // Auto-play idle if nothing is playing
        if (!this.currentAction) {
          this.transitionTo('idle')
        }
      }

      return retargeted
    } catch (err) {
      console.error(`[AnimController] Error loading ${animId}:`, err)
      this.loadingClips.delete(animId)
      return null
    }
  }

  /** Load these clips again (the walk set changed): the next transition uses the new ones. */
  reloadClips(ids: string[]): void {
    for (const id of ids) {
      this.clips.delete(id)
      void this.loadClip(id).then(() => {
        // The state that is playing now picks the new clip up at once.
        if (this.currentState === id) { const state = this.currentState; this.currentState = 'idle'; this.transitionTo(state) }
      })
    }
  }

  /** Pre-load a custom animation clip (dance, combat, emote) */
  async preloadClip(animId: string): Promise<boolean> {
    const clip = await this.loadClip(animId)
    return clip !== null
  }

  // ── STATE TRANSITIONS ────────────────────────────────────────────────

  /** Transition to a new animation state with crossfade */
  transitionTo(state: AnimState, customAnimId?: string, options?: { loop?: boolean }): void {
    if (this.disposed) return

    // Determine the clip ID
    let clipId: string
    if (state === 'custom' && customAnimId) {
      clipId = customAnimId
    } else {
      clipId = state
    }

    // Get the clip
    const clip = this.clips.get(clipId)
    if (!clip) {
      // Clip not loaded — async load with generation guard (prevents stale callback)
      const gen = ++this.transitionGeneration
      if (state === 'custom' && customAnimId) {
        this.loadClip(customAnimId).then(loaded => {
          if (loaded && !this.disposed && this.transitionGeneration === gen) {
            this.transitionTo(state, customAnimId)
          }
        })
      }
      // Fallback chain: walk→idle, run→walk→idle, custom→idle
      if (state === 'walk') {
        if (this.clips.has('idle')) { this.transitionTo('idle'); return }
      } else if (state === 'run') {
        if (this.clips.has('walk')) { this.transitionTo('walk'); return }
        if (this.clips.has('idle')) { this.transitionTo('idle'); return }
      }
      return
    }

    // Already playing this state? Skip.
    if (this.currentAction && this.currentState === state && (state !== 'custom' || this.customAnimId === customAnimId)) {
      return
    }

    // Update state BEFORE crossfade
    this.customAnimId = state === 'custom' ? (customAnimId || null) : null
    this.transitionGeneration++

    this.beginRootAbsorb()

    // Crossfade
    const newAction = this.mixer.clipAction(clip)
    newAction.reset()
    const loopOnce = state === 'custom' && options?.loop === false
    newAction.setLoop(loopOnce ? THREE.LoopOnce : THREE.LoopRepeat, loopOnce ? 1 : Infinity)
    newAction.clampWhenFinished = loopOnce
    // Adjust animation playback speed per state for foot sync
    newAction.timeScale = state === 'run' ? this.config.runTimeScale
      : state === 'sprint' ? this.config.sprintTimeScale : 1
    if (!this.currentAction) {
      newAction.setEffectiveWeight(1)
      newAction.play()
      this.mixer.update(0)
    } else {
      newAction.fadeIn(this.config.crossfadeDuration)
      newAction.play()
      this.currentAction.fadeOut(this.config.crossfadeDuration)
    }

    this.currentAction = newAction
    this.currentState = state
  }

  // ── ROOT MOTION ──────────────────────────────────────────────────────

  /** Where the animation holds the hips right now, relative to the character, in its own axes (x right, z forward). */
  private hipsOffset(): { x: number; z: number } {
    const node = this.vrm.humanoid.getNormalizedBoneNode('hips' as any)
    const rest = (this.vrm.humanoid as unknown as { normalizedRestPose?: { hips?: { position?: number[] } } }).normalizedRestPose?.hips?.position
    if (!node || !rest || rest.length < 3) return { x: 0, z: 0 }
    // VRM 0.x scenes are turned half round, so the rig's x and z run the other way.
    const sign = (this.vrm.meta as any)?.metaVersion === '0' ? -1 : 1
    return { x: sign * (node.position.x - rest[0]), z: sign * (node.position.z - rest[2]) }
  }

  /** A custom clip (a dance) is being left: its hips' place is to become the character's place. */
  private beginRootAbsorb(): void {
    if (this.rootAbsorb) {
      // Already handing over (walk turning into run a moment later): the same hand-over goes on.
      this.rootAbsorb.age = 0
      return
    }
    if (!this.rootMotionEnabled || this.currentState !== 'custom' || !this.currentAction) return
    const now = this.hipsOffset()
    if (Math.hypot(now.x, now.z) < 0.01) return
    this.rootAbsorb = { x: now.x, z: now.z, givenX: 0, givenZ: 0, age: 0 }
  }

  /**
   * How far the animation moved the character since the last call, in the character's own axes
   * (x to its right, z forward), metres. Add it to the character's position.
   *   - A dance with steady travel in it carries the character along.
   *   - When a dance is cut short, the place its hips had reached becomes the character's place:
   *     every frame the character takes exactly what the fading dance has let go of, so the body
   *     neither snaps back nor slides, whatever the blend does. That part is also returned as
   *     `shift`, for a camera that wants to follow it softly.
   */
  consumeRootMotion(delta: number): { x: number; z: number; shiftX: number; shiftZ: number } {
    let x = 0
    let z = 0
    if (this.rootMotionEnabled && this.currentState === 'custom' && this.currentAction) {
      const travel = getClipTravel(this.currentAction.getClip())
      if (travel.x !== 0 || travel.z !== 0) {
        const amount = delta * this.currentAction.getEffectiveWeight() * this.currentAction.getEffectiveTimeScale()
        x += travel.x * amount
        z += travel.z * amount
      }
    }
    let shiftX = 0
    let shiftZ = 0
    const absorb = this.rootAbsorb
    if (absorb) {
      const now = this.hipsOffset()
      shiftX = absorb.x - now.x - absorb.givenX
      shiftZ = absorb.z - now.z - absorb.givenZ
      absorb.givenX += shiftX
      absorb.givenZ += shiftZ
      absorb.age += delta
      // The fade is over a moment after the crossfade time; what the new clip does with the hips is its own.
      if (absorb.age > this.config.crossfadeDuration * 1.5) this.rootAbsorb = null
    }
    return { x: x + shiftX, z: z + shiftZ, shiftX, shiftZ }
  }

  /**
   * Where the hips are held away from the character while a dance plays or is being handed over.
   * While this is not zero, turning the character would swing the body around its origin; the
   * owner of the position turns it about the hips instead.
   */
  getRootResidual(): { x: number; z: number } {
    if (this.currentState !== 'custom' && !this.rootAbsorb) return { x: 0, z: 0 }
    return this.hipsOffset()
  }

  getClipDuration(animId: string): number | null {
    return this.clips.get(animId)?.duration ?? null
  }

  // ── VELOCITY-BASED AUTO-TRANSITION ───────────────────────────────────

  /** Call every frame with the character's velocity magnitude.
   *  Automatically transitions between idle/walk/run. */
  updateFromVelocity(speed: number): void {
    // Movement cancels custom animations (e.g., dance interrupted by WASD)
    if (this.currentState === 'custom' && speed < this.config.walkSpeedThreshold) return

    let targetState: AnimState
    if (speed < this.config.walkSpeedThreshold) {
      targetState = 'idle'
    } else if (speed < this.config.runSpeedThreshold) {
      targetState = 'walk'
    } else if (speed < this.config.sprintSpeedThreshold) {
      targetState = 'run'
    } else {
      targetState = 'sprint'
    }

    // Fallback chain: sprint→run→walk→idle
    if (targetState === 'sprint' && !this.clips.has('sprint')) {
      targetState = this.clips.has('run') ? 'run' : this.clips.has('walk') ? 'walk' : 'idle'
    }
    if (targetState === 'walk' && !this.clips.has('walk')) {
      targetState = speed > 1.5 ? (this.clips.has('run') ? 'run' : 'idle') : 'idle'
    }
    if (targetState === 'run' && !this.clips.has('run')) {
      targetState = this.clips.has('walk') ? 'walk' : 'idle'
    }

    if (targetState !== this.currentState) {
      this.transitionTo(targetState)
    }
  }

  // ── UPDATE (call every frame) ────────────────────────────────────────

  /** Update the mixer. Call every frame with delta time. */
  update(delta: number): void {
    this.mixer.update(delta)
  }

  // ── CLEANUP ──────────────────────────────────────────────────────────

  /** Stop all animations and clean up. Call on unmount. */
  dispose(): void {
    this.disposed = true
    this.mixer.stopAllAction()
    // Uncache from Three.js internal arrays to allow GC
    for (const clip of this.clips.values()) {
      this.mixer.uncacheClip(clip)
    }
    this.mixer.uncacheRoot(this.vrm.scene)
    this.clips.clear()
    this.currentAction = null
    this.currentState = 'idle'
    this.ready = false
  }

  // ── GETTERS ──────────────────────────────────────────────────────────

  get state(): AnimState { return this.currentState }
  get customAnimationId(): string | null { return this.customAnimId }
  get isReady(): boolean { return this.ready }
  get loadedClips(): string[] { return Array.from(this.clips.keys()) }
  get getMixer(): THREE.AnimationMixer { return this.mixer }
}
