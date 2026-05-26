import { createHmac, timingSafeEqual } from 'node:crypto'

import { isHostedOasis } from './oasis-profile'

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

export const ROOM_JOIN_CLAIM_TTL_MS = 5 * 60 * 1000

export function getRoomSigningKey(): string {
  const explicit = process.env.OASIS_ROOM_SIGNING_KEY || process.env.RELAY_SIGNING_KEY
  if (explicit) return explicit
  if (isHostedOasis()) {
    throw new Error('OASIS_ROOM_SIGNING_KEY or RELAY_SIGNING_KEY is required in hosted mode')
  }
  return 'oasis-room-dev-key-do-not-use-in-production'
}

function signPayload(encodedPayload: string, key: string): string {
  return createHmac('sha256', key).update(encodedPayload).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}

export function signRoomJoinClaim(
  payload: RoomJoinClaimPayload,
  key = getRoomSigningKey(),
): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = signPayload(encodedPayload, key)
  return `${encodedPayload}.${signature}`
}

export function verifyRoomJoinClaim(
  token: string,
  key = getRoomSigningKey(),
  now = Date.now(),
): RoomJoinClaimPayload {
  const [encodedPayload, signature] = String(token || '').split('.')
  if (!encodedPayload || !signature) throw new Error('invalid room join claim')
  const expected = signPayload(encodedPayload, key)
  if (!safeEqual(expected, signature)) throw new Error('invalid room join claim signature')
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as RoomJoinClaimPayload
  if (payload.type !== 'oasis-room-join-v1') throw new Error('invalid room join claim type')
  if (!payload.worldId || !payload.userId) throw new Error('invalid room join claim payload')
  if (!payload.canRead) throw new Error('room join claim cannot read world')
  if (typeof payload.exp !== 'number' || now >= payload.exp) throw new Error('room join claim expired')
  return payload
}
