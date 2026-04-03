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
import { loadAnimationClip, retargetClipForVRM, retargetUALClipForVRM, isUALAnimation } from './forge/animation-library'

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
      const rawClip = await loadAnimationClip(animId)
      if (!rawClip) {
        console.warn(`[AnimController] Failed to load clip: ${animId}`)
        this.loadingClips.delete(animId)
        return null
      }

      // UAL clips use UE skeleton → need UE→VRM retargeting. Mixamo clips use Mixamo→VRM.
      const retargeted = isUALAnimation(animId)
        ? retargetUALClipForVRM(rawClip, this.vrm, `${this.vrmCacheKey}__${animId}`)
        : retargetClipForVRM(rawClip, this.vrm, `${this.vrmCacheKey}__${animId}`)
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

  /** Pre-load a custom animation clip (dance, combat, emote) */
  async preloadClip(animId: string): Promise<boolean> {
    const clip = await this.loadClip(animId)
    return clip !== null
  }

  // ── STATE TRANSITIONS ────────────────────────────────────────────────

  /** Transition to a new animation state with crossfade */
  transitionTo(state: AnimState, customAnimId?: string): void {
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
    if (this.currentState === state && (state !== 'custom' || this.customAnimId === customAnimId)) {
      return
    }

    // Update state BEFORE crossfade
    this.customAnimId = state === 'custom' ? (customAnimId || null) : null
    this.transitionGeneration++

    // Crossfade
    const newAction = this.mixer.clipAction(clip)
    newAction.reset()
    newAction.setLoop(THREE.LoopRepeat, Infinity)
    newAction.clampWhenFinished = false
    // Adjust animation playback speed per state for foot sync
    newAction.timeScale = state === 'run' ? this.config.runTimeScale
      : state === 'sprint' ? this.config.sprintTimeScale : 1
    newAction.fadeIn(this.config.crossfadeDuration)
    newAction.play()

    if (this.currentAction) {
      this.currentAction.fadeOut(this.config.crossfadeDuration)
    }

    this.currentAction = newAction
    this.currentState = state
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
  get isReady(): boolean { return this.ready }
  get loadedClips(): string[] { return Array.from(this.clips.keys()) }
  get getMixer(): THREE.AnimationMixer { return this.mixer }
}
