// Agents cast their world changes (the owner, 2026-11-20, first recording 23:09-26:50): when an agent places an object
// or changes the sky or the ground through a world tool, its body plays Spell Simple enter, idle, shoot and exit, the
// owner's own incantation sounds from where it stands, and the change lands on the shoot ("we must sync that with
// the physical change of whatever they are changing").
//
// Timeline, from the moment the agent calls the tool (its `tool.start` reaches the page):
//   0          Enter (0.53 s) and the incantation starts (4.75 s; his voice, 24:09 take, last word ends at 4.65 s)
//   0.53 s     the charging loop (Spell Simple Idle) for as long as he speaks
//   4.45 s     Shoot (0.5 s), once the change has come in (or the tool has ended); a slow tool keeps it charging,
//              at most 20 s
//   +0.2 s     the release: the held world change is applied now (a sky then melts over its own 3 s)
//   +0.5 s     Exit (0.43 s), then back to its idle
// The page holds the world events that arrive while a cast is charging (useWorldEvents) and lets them go at the release.
//
// Settings > Agents: "Embodied agent actions" off means no cast and no hold (changes land at once, as the switch says).
// The "conjure duration" slider is replaced here by the incantation's own length; walk speed does not apply (an agent
// casts where it stands; where it should stand when it also needs the owner is his open question).

export type CastPhase = 'enter' | 'charge' | 'shoot' | 'exit'

export const CAST = {
  enterMs: 530,
  /** Shoot starts here at the earliest: its release then lands on the incantation's last word. */
  shootStartMs: 4450,
  releaseAfterShootMs: 200,
  shootMs: 500,
  exitMs: 430,
  maxChargeMs: 20_000,
} as const

export const CAST_CLIPS: Record<CastPhase, string> = {
  enter: 'ual-spell-enter',
  charge: 'ual-spell-idle',
  shoot: 'ual-spell-shoot',
  exit: 'ual-spell-exit',
}

export const INCANTATION_URL = '/audio/spells/conjuration-incantation.mp3'

/** World tools that change the world (by name, after the MCP prefix). Looking, listing and generating media do not. */
const WORLD_CHANGE_TOOLS = new Set([
  'place_object', 'modify_object', 'remove_object', 'set_sky', 'set_ground_preset', 'paint_ground_tiles', 'add_light',
  'modify_light', 'craft_scene', 'self_craft_scene', 'place_conjured_asset', 'conjure_asset', 'conjure_framed_picture',
  'text_to_pic_building', 'place_media', 'create_spatial_web_object', 'place_browser_window', 'place_agent_window',
  'set_behavior', 'clear_world',
])

/** World events that a cast holds until its release (the visible changes). */
export const HELD_EVENT_TYPES = new Set([
  'object_added', 'conjured_asset_added', 'scene_crafted', 'object_modified', 'object_removed', 'conjured_asset_removed',
  'sky_changed', 'ground_changed', 'tiles_painted', 'light_added', 'light_modified', 'agent_window_added',
  'generated_image_added',
])

export function isWorldChangeTool(name: string): boolean {
  const bare = name.includes('__') ? name.slice(name.lastIndexOf('__') + 2) : name
  return WORLD_CHANGE_TOOLS.has(bare)
}

interface Cast {
  agentId: string
  toolId: string
  startedAt: number
  /** The change came in, or the tool ended: it may shoot once the words are said. */
  ready: boolean
  /** The tool failed: no shoot, straight to the exit. */
  failed: boolean
  shootAt: number | null
  released: boolean
}

/** The casts in progress, the events they hold, and the clock that moves them on. Pure apart from `now`. */
export class CastBoard {
  private casts = new Map<string, Cast>()
  private held: Array<() => void> = []

  get active(): boolean { return this.casts.size > 0 }

  /** An agent called a world tool. A cast already going on for it carries on (one spell for a burst of calls). */
  start(agentId: string, toolId: string, now: number): boolean {
    if (this.casts.has(agentId)) return false
    this.casts.set(agentId, { agentId, toolId, startedAt: now, ready: false, failed: false, shootAt: null, released: false })
    return true
  }

  /** Its tool ended (`failed`: with an error). */
  toolEnded(toolId: string, failed: boolean): void {
    for (const cast of this.casts.values()) {
      if (cast.toolId !== toolId || cast.shootAt !== null) continue
      cast.ready = true
      cast.failed = cast.failed || failed
    }
  }

  /** Is a cast between its start and its release (a world change arriving now waits for it)? */
  charging(now: number): boolean {
    for (const cast of this.casts.values()) {
      if (!cast.released && (cast.shootAt === null || now < cast.shootAt + CAST.releaseAfterShootMs)) return true
    }
    return false
  }

  /**
   * A world change came in: held for the release when a cast is charging (true), else apply it now (false). The
   * oldest charging cast takes it as its own (the change it was waiting for).
   */
  hold(apply: () => void, now: number): boolean {
    if (!this.charging(now)) return false
    this.held.push(apply)
    let oldest: Cast | null = null
    for (const cast of this.casts.values()) {
      if (cast.shootAt === null && (!oldest || cast.startedAt < oldest.startedAt)) oldest = cast
    }
    if (oldest) oldest.ready = true
    return true
  }

  /** Move the casts on. Returns true when some agent's phase may have changed. */
  tick(now: number): boolean {
    let changed = false
    for (const cast of [...this.casts.values()]) {
      if (cast.shootAt === null) {
        const due = cast.startedAt + CAST.shootStartMs
        if ((cast.ready && now >= due) || now >= cast.startedAt + CAST.maxChargeMs) {
          // A failed tool skips the shoot: its exit starts now.
          cast.shootAt = cast.failed ? now - CAST.shootMs : now
          changed = true
        }
      }
      if (cast.shootAt !== null && !cast.released && now >= cast.shootAt + CAST.releaseAfterShootMs) {
        cast.released = true
        this.flush()
      }
      if (cast.shootAt !== null && now >= cast.shootAt + CAST.shootMs + CAST.exitMs) {
        this.casts.delete(cast.agentId)
        changed = true
      }
    }
    // Nothing left to wait for: whatever is still held goes now.
    if (!this.charging(now)) this.flush()
    return changed || this.casts.size > 0
  }

  phase(agentId: string, now: number): CastPhase | null {
    const cast = this.casts.get(agentId)
    if (!cast) return null
    if (cast.shootAt === null) return now < cast.startedAt + CAST.enterMs ? 'enter' : 'charge'
    if (now < cast.shootAt + CAST.shootMs) return 'shoot'
    if (now < cast.shootAt + CAST.shootMs + CAST.exitMs) return 'exit'
    return null
  }

  /** Every event still held, applied in the order they came. */
  flush(): void {
    const held = this.held
    this.held = []
    for (const apply of held) {
      try { apply() } catch (error) { console.warn('[agent-cast] held world event failed', error) }
    }
  }

  clear(): void {
    this.casts.clear()
    this.flush()
  }
}
