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
import { loadAnimationClip, retargetClipForVRM } from './forge/animation-library'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type AnimState = 'idle' | 'walk' | 'run' | 'custom'

export interface AnimationControllerConfig {
  crossfadeDuration?: number  // seconds, default 0.3
  walkSpeedThreshold?: number // velocity magnitude below which we idle
  runSpeedThreshold?: number  // velocity magnitude above which we run
}

const DEFAULT_CONFIG: Required<AnimationControllerConfig> = {
  crossfadeDuration: 0.3,
  walkSpeedThreshold: 0.5,
  runSpeedThreshold: 3.0,
}

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATION CONTROLLER — one per character
// ═══════════════════════════════════════════════════════════════════════════

export class AnimationController {
  private mixer: THREE.AnimationMixer
  private vrm: VRM
  private config: Required<AnimationControllerConfig>

  // Clip cache (loaded + retargeted)
  private clips: Map<string, THREE.AnimationClip> = new Map()
  private loadingClips: Set<string> = new Set()

  // State
  private currentState: AnimState = 'idle'
  private currentAction: THREE.AnimationAction | null = null
  private customAnimId: string | null = null

  // Ready flag — true when at least idle clip is loaded
  public ready = false

  constructor(vrm: VRM, config?: AnimationControllerConfig) {
    this.vrm = vrm
    this.mixer = new THREE.AnimationMixer(vrm.scene)
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Pre-load locomotion clips
    this.loadClip('idle')
    this.loadClip('walk')
    this.loadClip('run')
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

      const retargeted = retargetClipForVRM(rawClip, this.vrm, `anim-${animId}`)
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
    // Determine the clip ID
    let clipId: string
    if (state === 'custom' && customAnimId) {
      clipId = customAnimId
      this.customAnimId = customAnimId
    } else {
      clipId = state
      this.customAnimId = null
    }

    // Get the clip
    const clip = this.clips.get(clipId)
    if (!clip) {
      // Clip not loaded yet — try loading it
      if (state === 'custom' && customAnimId) {
        this.loadClip(customAnimId).then(loaded => {
          if (loaded) this.transitionTo(state, customAnimId)
        })
      }
      // Fallback: if walk not loaded, try idle
      if (state === 'walk' && !clip) {
        const idleClip = this.clips.get('idle')
        if (idleClip) { this.transitionTo('idle'); return }
      }
      return
    }

    // Already playing this state? Skip.
    if (this.currentState === state && (state !== 'custom' || this.customAnimId === customAnimId)) {
      return
    }

    // Crossfade
    const newAction = this.mixer.clipAction(clip)
    newAction.reset()
    newAction.setLoop(state === 'custom' ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    newAction.clampWhenFinished = state === 'custom'
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
    if (this.currentState === 'custom') return // don't override custom animations

    let targetState: AnimState
    if (speed < this.config.walkSpeedThreshold) {
      targetState = 'idle'
    } else if (speed < this.config.runSpeedThreshold) {
      targetState = 'walk'
    } else {
      targetState = 'run'
    }

    // Fallback chain: if walk clip not loaded, use idle or run
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
    this.mixer.stopAllAction()
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
