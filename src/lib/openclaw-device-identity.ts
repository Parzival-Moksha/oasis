import 'server-only'

import { createHash, generateKeyPairSync, sign, createPrivateKey } from 'crypto'
import type { KeyObject } from 'crypto'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS DEVICE IDENTITY for OpenClaw Gateway pairing
// ─═̷─═̷─ॐ─═̷─═̷─
//
// OpenClaw's Gateway uses Ed25519 keypairs for device authentication.
// Oasis generates its own keypair ONCE, persists it, and uses it to sign
// the challenge nonce during the `connect` handshake.
//
// Signature format per V3 protocol (bundle-verified):
//   "v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|
//    {signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}"
// Signed with Ed25519 priv key, base64url-encoded.
//
// deviceId = sha256(rawPublicKey32Bytes).hex
// publicKey encoding = base64url of raw 32-byte Ed25519 key (via JWK x field)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export interface DeviceIdentity {
  id: string          // sha256(rawPub32).hex
  publicKey: string   // base64url raw 32 bytes
  privateKey: string  // PKCS#8 PEM (so we can re-import into a KeyObject)
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64url')
}

function rawPublicKeyBase64Url(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' }) as { x?: string }
  if (!jwk?.x) throw new Error('Ed25519 public key JWK missing "x" field')
  return jwk.x
}

function rawPublicKeyBuffer(publicKey: KeyObject): Buffer {
  const b64url = rawPublicKeyBase64Url(publicKey)
  return Buffer.from(b64url, 'base64url')
}

export function generateDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubRaw = rawPublicKeyBuffer(publicKey)
  return {
    id: createHash('sha256').update(pubRaw).digest('hex'),
    publicKey: toBase64Url(pubRaw),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

export function loadPrivateKey(identity: DeviceIdentity): KeyObject {
  return createPrivateKey({ key: identity.privateKey, format: 'pem' })
}

export interface V3SignPayload {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: readonly string[]
  signedAtMs: number
  token: string
  nonce: string
  platform: string
  deviceFamily: string
}

export function buildV3SignedContent(payload: V3SignPayload): string {
  // Server passes connectParams.scopes VERBATIM into the V3 payload builder
  // (no dedupe/imply/sort at signature-time; that only happens at grant-time).
  // So we must sign with scopes EXACTLY as sent in the connect request.
  return [
    'v3',
    payload.deviceId,
    payload.clientId,
    payload.clientMode,
    payload.role,
    payload.scopes.join(','),
    payload.signedAtMs,
    payload.token,
    payload.nonce,
    payload.platform,
    payload.deviceFamily,
  ].join('|')
}

export function signV3(privateKey: KeyObject, payload: V3SignPayload): string {
  const content = buildV3SignedContent(payload)
  const signature = sign(null, Buffer.from(content, 'utf8'), privateKey)
  return toBase64Url(signature)
}
