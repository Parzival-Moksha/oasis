import { createHmac, timingSafeEqual } from 'node:crypto'

import type { NextRequest } from 'next/server'

export const ADMIN_SESSION_COOKIE_NAME = 'oasis_admin_session'
export const ADMIN_SESSION_MAX_AGE_S = 60 * 60 * 12
export const HOSTED_ADMIN_USER_ID = 'hosted-admin'

export interface AdminSessionPayload {
  role: 'admin'
  sub: string
  iat: number
  exp: number
}

type EnvLike = {
  [key: string]: string | undefined
  OASIS_ADMIN_TOKEN?: string
  OASIS_ADMIN_SESSION_KEY?: string
  OASIS_ADMIN_USER_ID?: string
  RELAY_SIGNING_KEY?: string
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64url')
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

function hmac(key: string, message: string): Buffer {
  return createHmac('sha256', key).update(message).digest()
}

function constantTimeStringEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null
  let lastValue: string | null = null
  for (const piece of cookieHeader.split(';')) {
    const trimmed = piece.trim()
    if (!trimmed.startsWith(`${name}=`)) continue
    const rawValue = trimmed.slice(name.length + 1)
    if (rawValue) lastValue = rawValue
  }
  if (!lastValue) return null
  try {
    return decodeURIComponent(lastValue)
  } catch {
    return null
  }
}

function getAdminToken(env: EnvLike = process.env): string | null {
  const token = env.OASIS_ADMIN_TOKEN?.trim()
  return token ? token : null
}

function getAdminSessionKey(env: EnvLike = process.env): string | null {
  return env.OASIS_ADMIN_SESSION_KEY?.trim() || env.RELAY_SIGNING_KEY?.trim() || getAdminToken(env)
}

export function getAdminUserId(env: EnvLike = process.env): string {
  return env.OASIS_ADMIN_USER_ID?.trim() || HOSTED_ADMIN_USER_ID
}

export function isAdminUserId(userId: string | null | undefined, env: EnvLike = process.env): boolean {
  return Boolean(userId && userId === getAdminUserId(env))
}

export function isAdminAuthConfigured(env: EnvLike = process.env): boolean {
  return Boolean(getAdminToken(env) && getAdminSessionKey(env))
}

export function verifyAdminLoginToken(input: string, env: EnvLike = process.env): boolean {
  const expected = getAdminToken(env)
  if (!expected || !input) return false
  return constantTimeStringEq(input, expected)
}

export function signAdminSession(
  subject = getAdminUserId(),
  now = Date.now(),
  env: EnvLike = process.env,
): string {
  const key = getAdminSessionKey(env)
  if (!key) throw new Error('OASIS_ADMIN_TOKEN or OASIS_ADMIN_SESSION_KEY is required')
  const payload: AdminSessionPayload = {
    role: 'admin',
    sub: subject,
    iat: now,
    exp: now + ADMIN_SESSION_MAX_AGE_S * 1000,
  }
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const sigB64 = base64UrlEncode(hmac(key, payloadB64))
  return `${payloadB64}.${sigB64}`
}

export function verifyAdminSession(
  token: string,
  now = Date.now(),
  env: EnvLike = process.env,
): AdminSessionPayload | null {
  const key = getAdminSessionKey(env)
  if (!key || !token) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sigB64] = parts
  if (!payloadB64 || !sigB64) return null
  const expected = base64UrlEncode(hmac(key, payloadB64))
  if (!constantTimeStringEq(expected, sigB64)) return null

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as AdminSessionPayload
    if (payload.role !== 'admin') return null
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null
    if (now >= payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export function readAdminSessionFromCookieHeader(
  cookieHeader: string | null | undefined,
  now = Date.now(),
): AdminSessionPayload | null {
  const token = readCookie(cookieHeader, ADMIN_SESSION_COOKIE_NAME)
  return token ? verifyAdminSession(token, now) : null
}

export function readAdminSession(request: Request | NextRequest): AdminSessionPayload | null {
  return readAdminSessionFromCookieHeader(request.headers.get('cookie'))
}
