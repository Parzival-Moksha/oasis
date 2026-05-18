import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema'

export class PlayerState extends Schema {
  @type('string') playerId = ''
  @type('string') displayName = ''
  @type('string') avatarUrl = ''
  @type('string') profileAvatarUrl = ''
  @type('string') color = '#38bdf8'

  @type('number') x = 0
  @type('number') y = 0
  @type('number') z = 0
  @type('number') yaw = 0

  @type('number') vx = 0
  @type('number') vz = 0

  @type('string') animState = 'idle'
  @type('number') updatedAt = 0

  // ─═̷─ PvP combat state ─═̷─
  // hp/maxHp/mana/maxMana are room-owned and ephemeral. Initialized from
  // computePlayerStats on join (client passes its own max values; v1 trusts
  // the client — v2 will sign via API callback). Reset to max on respawn.
  // Discarded on world-exit so a player can't camp logout at low HP.
  @type('number') hp = 100
  @type('number') maxHp = 100
  @type('number') mana = 20
  @type('number') maxMana = 20
  @type('boolean') alive = true
  /** ms wall-clock timestamp when respawn fires; 0 if alive. */
  @type('number') respawnAt = 0
  /** Last-known killer sessionId for the death overlay. Cleared on respawn. */
  @type('string') lastKilledBy = ''
}

/**
 * In-flight projectile owned by the room. Clients render geometry
 * deterministically from { ox,oy,oz, dx,dy,dz, speed, seed } — the room
 * does NOT step the projectile each frame; it just keeps the cast record
 * around long enough for reportHit messages to reference it, then retires it.
 */
export class ActiveBolt extends Schema {
  @type('string') id = ''
  @type('string') casterSessionId = ''
  /** 'firebolt' | 'lightning-bolt' | 'ice-bolt' */
  @type('string') spell = ''
  /** 'A' | 'B' | 'C' | 'D' */
  @type('string') design = 'A'
  @type('number') ox = 0
  @type('number') oy = 0
  @type('number') oz = 0
  @type('number') dx = 0
  @type('number') dy = 0
  @type('number') dz = 0
  @type('number') speed = 24
  @type('number') damage = 14
  @type('number') spawnedAt = 0
  @type('number') seed = 0
}

export class WorldRoomState extends Schema {
  @type('string') worldId = ''
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>()
  @type([ ActiveBolt ]) bolts = new ArraySchema<ActiveBolt>()
  @type('number') tick = 0
  /** Mirrors World.pvpEnabled from DB. First-joiner value wins for v1. */
  @type('boolean') pvpEnabled = false
}
