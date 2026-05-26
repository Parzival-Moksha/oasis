import { createHmac, timingSafeEqual } from 'node:crypto'

export interface RoomJoinClaimPayload {
  type: 'oasis-room-join-v1'
  worldId: string
  userId: string
  canRead: boolean
  canWrite: boolean
  pvpEnabled: boolean
  admin?: boolean
  iat: number
  exp: number
}

export interface RoomAccess {
  userId: string
  canRead: boolean
  canWrite: boolean
  pvpEnabled: boolean
  admin: boolean
}

function getRoomSigningKey(): string {
  const explicit = process.env.OASIS_ROOM_SIGNING_KEY || process.env.RELAY_SIGNING_KEY
  if (explicit) return explicit
  if (process.env.OASIS_MODE === 'hosted') {
    throw new Error('OASIS_ROOM_SIGNING_KEY or RELAY_SIGNING_KEY is required in hosted mode')
  }
  return 'oasis-room-dev-key-do-not-use-in-production'
}

export function shouldRequireRoomJoinClaim(): boolean {
  if (process.env.OASIS_ROOM_REQUIRE_JOIN_CLAIM === '0') return false
  if (process.env.OASIS_ROOM_REQUIRE_JOIN_CLAIM === '1') return true
  return process.env.OASIS_MODE === 'hosted'
}

function signPayload(encodedPayload: string, key: string): string {
  return createHmac('sha256', key).update(encodedPayload).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}

export function verifyRoomJoinClaim(
  token: unknown,
  expectedWorldId: string,
  now = Date.now(),
): RoomAccess {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('room join claim required')
  }
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) throw new Error('invalid room join claim')
  const expected = signPayload(encodedPayload, getRoomSigningKey())
  if (!safeEqual(expected, signature)) throw new Error('invalid room join claim signature')
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as RoomJoinClaimPayload
  if (payload.type !== 'oasis-room-join-v1') throw new Error('invalid room join claim type')
  if (payload.worldId !== expectedWorldId) throw new Error('room join claim world mismatch')
  if (!payload.userId) throw new Error('room join claim missing user')
  if (!payload.canRead) throw new Error('room join claim cannot read world')
  if (typeof payload.exp !== 'number' || now >= payload.exp) throw new Error('room join claim expired')
  return {
    userId: payload.userId,
    canRead: payload.canRead,
    canWrite: payload.canWrite === true,
    pvpEnabled: payload.pvpEnabled === true,
    admin: payload.admin === true,
  }
}

export function fallbackRoomAccess(options: { userId?: unknown; pvpEnabled?: unknown }): RoomAccess {
  return {
    userId: typeof options.userId === 'string' && options.userId.trim()
      ? options.userId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96)
      : 'local-user',
    canRead: true,
    canWrite: true,
    pvpEnabled: options.pvpEnabled === true,
    admin: process.env.OASIS_MODE !== 'hosted',
  }
}
