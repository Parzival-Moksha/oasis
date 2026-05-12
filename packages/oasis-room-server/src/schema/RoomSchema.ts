import { Schema, MapSchema, type } from '@colyseus/schema'

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
}

export class WorldRoomState extends Schema {
  @type('string') worldId = ''
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>()
  @type('number') tick = 0
}
