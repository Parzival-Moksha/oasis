/**
 * Relay wire protocol — every envelope that crosses the OpenClaw relay
 * (`openclaw.04515.xyz` in production, the dev sidecar locally) MUST validate
 * against schemas exported from this file. Single source of truth.
 *
 * Imported by:
 *   - browser bridge          → src/hooks/useOpenclawRelayBridge.ts
 *   - dev relay sidecar       → scripts/openclaw-relay-dev.mjs (validates at boundaries)
 *   - hosted relay sidecar    → scripts/openclaw-relay.mjs (future)
 *   - OpenClaw-side bridge    → scripts/openclaw-oasis-bridge.mjs
 *
 * Decisions baked in:
 *   - Strict objects: unknown fields are rejected. Renames must be deliberate.
 *   - Discriminated union on `type`: unknown types are rejected.
 *   - Default 8 MiB frame cap. Screenshots can ride the relay for now; larger
 *     media should still move to a future URL/object-store path.
 *   - IDs are plain strings at runtime; brand them in TS callers if mixing
 *     becomes a real bug, not preemptively.
 */

import { z } from 'zod'

// ────────────────────────────────────────────────────────────────────────────
// Limits
// ────────────────────────────────────────────────────────────────────────────

export const RELAY_FRAME_MAX_BYTES = 8 * 1024 * 1024
const MAX_TEXT_LEN        = 16_000
const MAX_TOOL_NAME_LEN   = 128
const MAX_AGENT_LABEL_LEN = 128
const MAX_TOKEN_LEN       = 4_096
const MAX_ERROR_MSG_LEN   = 2_048
const MAX_SESSION_TITLE_LEN = 256

const idString = (max = 128) => z.string().min(1).max(max)

// ────────────────────────────────────────────────────────────────────────────
// Scopes — what a paired device is allowed to do.
// Add new scopes here AND in the relay's authorization table.
// ────────────────────────────────────────────────────────────────────────────

export const ScopeSchema = z.enum([
  'world.read',
  'world.write.safe',
  'screenshot.request',
  'chat.stream',
  'voice.realtime',
])
export type Scope = z.infer<typeof ScopeSchema>

// ────────────────────────────────────────────────────────────────────────────
// Common shapes
// ────────────────────────────────────────────────────────────────────────────

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

// `envelopeBase` is the universal wrapper. Every variant in the discriminated
// union extends from it — `relaySessionId` lives here so callers can stamp it
// on any envelope without each variant having to redeclare the field.
const envelopeBase = z.object({
  messageId:      idString(),
  sentAt:         z.number().int().nonnegative(),
  relaySessionId: idString().optional(),
})

// ────────────────────────────────────────────────────────────────────────────
// Hello / pairing
// ────────────────────────────────────────────────────────────────────────────

export const BrowserHelloSchema = envelopeBase.extend({
  type:             z.literal('browser.hello'),
  browserSessionId: idString(),
  worldId:          idString(),
  roomId:           idString(),
}).strict()

export const BrowserReadySchema = envelopeBase.extend({
  type:           z.literal('browser.ready'),
  worldId:        idString(),
  availableTools: z.array(z.string().min(1).max(MAX_TOOL_NAME_LEN)).max(256),
}).strict()

export const AgentHelloSchema = envelopeBase.extend({
  type:         z.literal('agent.hello'),
  pairingCode:  idString(64).optional(),
  deviceToken:  z.string().min(1).max(MAX_TOKEN_LEN).optional(),
  agentLabel:   z.string().min(1).max(MAX_AGENT_LABEL_LEN),
  agentVersion: z.string().min(1).max(64).optional(),
}).strict()
// Cross-field check (pairingCode || deviceToken) is enforced in parseRelayMessage
// because .refine wraps schemas in ZodEffects which breaks discriminatedUnion.

export const PairingApprovedSchema = envelopeBase.extend({
  type:        z.literal('pairing.approved'),
  deviceToken: z.string().min(1).max(MAX_TOKEN_LEN),
  scopes:      z.array(ScopeSchema).min(1),
}).strict()

// ────────────────────────────────────────────────────────────────────────────
// Chat
// ────────────────────────────────────────────────────────────────────────────

export const ChatUserSchema = envelopeBase.extend({
  type:      z.literal('chat.user'),
  sessionId: idString(),
  text:      z.string().min(1).max(MAX_TEXT_LEN),
}).strict()

export const ChatAgentDeltaSchema = envelopeBase.extend({
  type:      z.literal('chat.agent.delta'),
  sessionId: idString(),
  text:      z.string().max(MAX_TEXT_LEN),
}).strict()

export const ChatAgentFinalSchema = envelopeBase.extend({
  type:      z.literal('chat.agent.final'),
  sessionId: idString(),
  text:      z.string().max(MAX_TEXT_LEN),
}).strict()

// ────────────────────────────────────────────────────────────────────────────
// Session sync
// ────────────────────────────────────────────────────────────────────────────

export const RelaySessionSummarySchema = z.object({
  id:           idString(256),
  title:        z.string().min(1).max(MAX_SESSION_TITLE_LEN),
  preview:      z.string().max(MAX_TEXT_LEN).optional(),
  source:       z.enum(['draft', 'gateway', 'cache']).optional(),
  createdAt:    z.number().nonnegative(),
  updatedAt:    z.number().nonnegative(),
  messageCount: z.number().int().nonnegative(),
}).strict()

export const SessionSyncRequestSchema = envelopeBase.extend({
  type:              z.literal('session.sync.request'),
  limit:             z.number().int().min(1).max(200).optional(),
  includeMessages:   z.boolean().optional(),
  selectedSessionId: idString(256).optional(),
}).strict()

export const SessionSyncResponseSchema = envelopeBase.extend({
  type:              z.literal('session.sync.response'),
  sessions:          z.array(RelaySessionSummarySchema).max(200),
  selectedSessionId: idString(256).optional(),
  messagesBySessionId: z.record(z.string(), z.array(z.unknown()).max(500)).optional(),
  error: z.object({
    code:    z.string().min(1).max(64),
    message: z.string().min(1).max(MAX_ERROR_MSG_LEN),
  }).optional(),
}).strict()

// ────────────────────────────────────────────────────────────────────────────
// Tools — MCP-shaped semantically; WSS on the wire.
// The browser bridge is the executor; it dispatches `toolName` against the
// existing internal route surface and returns `tool.result`.
// ────────────────────────────────────────────────────────────────────────────

export const ToolCallSchema = envelopeBase.extend({
  type:     z.literal('tool.call'),
  callId:   idString(),
  toolName: z.string().min(1).max(MAX_TOOL_NAME_LEN),
  args:     z.record(z.string(), z.unknown()).default({}),
  scope:    ScopeSchema,
}).strict()

export const ToolResultSchema = envelopeBase.extend({
  type:   z.literal('tool.result'),
  callId: idString(),
  ok:     z.boolean(),
  data:   z.unknown().optional(),
  error:  z.object({
    code:    z.string().min(1).max(64),
    message: z.string().min(1).max(MAX_ERROR_MSG_LEN),
  }).optional(),
}).strict()

// ────────────────────────────────────────────────────────────────────────────
// Presence / portals
// ────────────────────────────────────────────────────────────────────────────

export const PresenceUpdateSchema = envelopeBase.extend({
  type:     z.literal('presence.update'),
  actorId:  idString(),
  kind:     z.enum(['human', 'agent']),
  position: Vec3Schema.optional(),
  rotation: Vec3Schema.optional(),
}).strict()

export const PortalEnterSchema = envelopeBase.extend({
  type:          z.literal('portal.enter'),
  worldId:       idString(),
  portalId:      idString(),
  targetWorldId: idString(),
  targetSpawn:   Vec3Schema.optional(),
}).strict()

// ────────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────────

export const ErrorSchema = envelopeBase.extend({
  type:      z.literal('error'),
  code:      z.string().min(1).max(64),
  message:   z.string().min(1).max(MAX_ERROR_MSG_LEN),
  retryable: z.boolean().optional(),
}).strict()

// ────────────────────────────────────────────────────────────────────────────
// Discriminated union — the wire's complete vocabulary.
// New variants go here; the parser rejects everything else.
// ────────────────────────────────────────────────────────────────────────────

export const RelayMessageSchema = z.discriminatedUnion('type', [
  BrowserHelloSchema,
  BrowserReadySchema,
  AgentHelloSchema,
  PairingApprovedSchema,
  ChatUserSchema,
  ChatAgentDeltaSchema,
  ChatAgentFinalSchema,
  SessionSyncRequestSchema,
  SessionSyncResponseSchema,
  ToolCallSchema,
  ToolResultSchema,
  PresenceUpdateSchema,
  PortalEnterSchema,
  ErrorSchema,
])
export type RelayMessage = z.infer<typeof RelayMessageSchema>

export type RelayMessageType = RelayMessage['type']

// ────────────────────────────────────────────────────────────────────────────
// Parse helpers — the only blessed ingress points.
// ────────────────────────────────────────────────────────────────────────────

export class RelayProtocolError extends Error {
  constructor(message: string, public readonly code: string = 'protocol_error') {
    super(message)
    this.name = 'RelayProtocolError'
  }
}

export function parseRelayMessage(raw: unknown): RelayMessage {
  const result = RelayMessageSchema.safeParse(raw)
  if (!result.success) {
    throw new RelayProtocolError(
      `invalid relay message: ${result.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')}`,
      'invalid_envelope',
    )
  }
  const msg = result.data
  if (msg.type === 'agent.hello' && !msg.pairingCode && !msg.deviceToken) {
    throw new RelayProtocolError('agent.hello requires pairingCode or deviceToken', 'agent_hello_missing_credential')
  }
  return msg
}

export function safeParseRelayMessage(raw: unknown):
  | { ok: true;  msg: RelayMessage }
  | { ok: false; error: RelayProtocolError } {
  try {
    return { ok: true, msg: parseRelayMessage(raw) }
  } catch (err) {
    if (err instanceof RelayProtocolError) return { ok: false, error: err }
    return { ok: false, error: new RelayProtocolError(String((err as Error)?.message ?? err)) }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Construction helpers — fill in messageId and sentAt at the boundary.
// ────────────────────────────────────────────────────────────────────────────

type EnvelopeFields = 'messageId' | 'sentAt'
export type RelayMessageInput =
  | (Omit<BrowserHello,      EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<BrowserReady,      EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<AgentHello,        EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<PairingApproved,   EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<ChatUser,          EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<ChatAgentDelta,    EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<ChatAgentFinal,    EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<SessionSyncRequest,  EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<SessionSyncResponse, EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<ToolCall,          EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<ToolResult,        EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<PresenceUpdate,    EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<PortalEnter,       EnvelopeFields> & { messageId?: string; sentAt?: number })
  | (Omit<RelayErrorMessage, EnvelopeFields> & { messageId?: string; sentAt?: number })

let messageIdCounter = 0
function nextMessageId(): string {
  // Unique within a process; the relay re-stamps if it cares about global uniqueness.
  // Avoids a `crypto` import path that breaks in the browser.
  messageIdCounter = (messageIdCounter + 1) & 0xffffffff
  return `m_${Date.now().toString(36)}_${messageIdCounter.toString(36)}`
}

export function buildRelayMessage(input: RelayMessageInput): RelayMessage {
  // Spread input FIRST, then assign defaults — otherwise an explicit
  // `messageId: undefined` from the caller would overwrite the generated id.
  const filled = {
    ...input,
    messageId: input.messageId ?? nextMessageId(),
    sentAt:    input.sentAt    ?? Date.now(),
  }
  return parseRelayMessage(filled)
}

// ────────────────────────────────────────────────────────────────────────────
// Per-variant convenience types
// ────────────────────────────────────────────────────────────────────────────

export type BrowserHello      = z.infer<typeof BrowserHelloSchema>
export type BrowserReady      = z.infer<typeof BrowserReadySchema>
export type AgentHello        = z.infer<typeof AgentHelloSchema>
export type PairingApproved   = z.infer<typeof PairingApprovedSchema>
export type ChatUser          = z.infer<typeof ChatUserSchema>
export type ChatAgentDelta    = z.infer<typeof ChatAgentDeltaSchema>
export type ChatAgentFinal    = z.infer<typeof ChatAgentFinalSchema>
export type RelaySessionSummary = z.infer<typeof RelaySessionSummarySchema>
export type SessionSyncRequest  = z.infer<typeof SessionSyncRequestSchema>
export type SessionSyncResponse = z.infer<typeof SessionSyncResponseSchema>
export type ToolCall          = z.infer<typeof ToolCallSchema>
export type ToolResult        = z.infer<typeof ToolResultSchema>
export type PresenceUpdate    = z.infer<typeof PresenceUpdateSchema>
export type PortalEnter       = z.infer<typeof PortalEnterSchema>
export type RelayErrorMessage = z.infer<typeof ErrorSchema>
