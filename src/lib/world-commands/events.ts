import type { WorldCommandEnvelope, WorldEventEnvelope, WorldEventKind } from './types'

interface WorldEventContext {
  id?: string
  acceptedAt?: string
  revision: number
  source?: WorldEventEnvelope['source']
  durable?: boolean
  error?: string
}

export function makeCommandAcceptedEvent(
  command: WorldCommandEnvelope,
  context: WorldEventContext,
): WorldEventEnvelope {
  return makeWorldEvent('command.accepted', command, context)
}

export function makeCommandRejectedEvent(
  command: WorldCommandEnvelope,
  context: WorldEventContext & { error: string },
): WorldEventEnvelope {
  return makeWorldEvent('command.rejected', command, context)
}

export function makeSnapshotCompactedEvent(args: {
  worldId: string
  revision: number
  acceptedAt?: string
  id?: string
}): WorldEventEnvelope {
  return {
    id: args.id || makeWorldEventId('snapshot.compacted'),
    kind: 'snapshot.compacted',
    worldId: args.worldId,
    acceptedAt: args.acceptedAt || new Date().toISOString(),
    revision: args.revision,
  }
}

export function isAcceptedWorldEvent(event: WorldEventEnvelope | null | undefined): boolean {
  return event?.kind === 'command.accepted'
}

function makeWorldEvent(
  kind: WorldEventKind,
  command: WorldCommandEnvelope,
  context: WorldEventContext,
): WorldEventEnvelope {
  return {
    id: context.id || makeWorldEventId(kind),
    kind,
    worldId: command.worldId,
    commandId: command.id,
    actorId: command.actorId,
    acceptedAt: context.acceptedAt || new Date().toISOString(),
    revision: context.revision,
    ...(context.source ? { source: context.source } : {}),
    ...(context.durable !== undefined ? { durable: context.durable } : {}),
    ...(context.error ? { error: context.error } : {}),
    command,
  }
}

function makeWorldEventId(kind: WorldEventKind): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `world-event-${kind.replace(/\./g, '-')}-${suffix}`
}
