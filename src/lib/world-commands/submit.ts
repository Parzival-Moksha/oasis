import type { WorldState } from '@/lib/forge/world-persistence'

import { applyWorldCommand } from './reducer'
import { makeWorldCommand } from './legacy-map'
import { makeCommandAcceptedEvent, makeCommandRejectedEvent } from './events'
import type {
  WorldCommandEnvelope,
  WorldCommandKind,
  WorldCommandPayloadByKind,
  WorldEventEnvelope,
} from './types'
import { validateWorldCommandEnvelope } from './validators'

export interface WorldCommandSubmitContext {
  worldId: string
  actorId: string
  actorDisplayName?: string
  clientId?: string
  createdAt?: string
  commandId?: string
  expectedRevision?: number
  idempotencyKey?: string
}

export interface WorldCommandTransport {
  sendCommand(command: WorldCommandEnvelope): Promise<WorldEventEnvelope> | WorldEventEnvelope
}

export interface SubmitWorldCommandOptions {
  currentState?: WorldState
  currentRevision?: number
  transport?: WorldCommandTransport
  optimistic?: boolean
}

export interface SubmitWorldCommandResult {
  command: WorldCommandEnvelope
  event: WorldEventEnvelope
  accepted: boolean
  state?: WorldState
  changed: boolean
  optimisticApplied: boolean
  error?: string
}

export async function submitWorldCommand<K extends WorldCommandKind>(
  kind: K,
  payload: WorldCommandPayloadByKind[K],
  context: WorldCommandSubmitContext,
  options: SubmitWorldCommandOptions = {},
): Promise<SubmitWorldCommandResult> {
  const command = makeWorldCommand(kind, payload, {
    id: context.commandId,
    worldId: context.worldId,
    actorId: context.actorId,
    actorDisplayName: context.actorDisplayName,
    clientId: context.clientId,
    createdAt: context.createdAt,
  })
  command.expectedRevision = context.expectedRevision
  command.idempotencyKey = context.idempotencyKey

  const validation = validateWorldCommandEnvelope(command)
  if (!validation.ok) {
    return rejected(command, validation.error, options.currentState, options.currentRevision)
  }

  if (options.transport) {
    let optimisticState = options.currentState
    let optimisticChanged = false
    if (options.optimistic && options.currentState) {
      const applied = applyWorldCommand(options.currentState, command)
      optimisticState = applied.state
      optimisticChanged = applied.changed
    }

    try {
      const event = await options.transport.sendCommand(command)
      if (event.kind !== 'command.accepted') {
        return {
          command,
          event,
          accepted: false,
          state: options.currentState,
          changed: false,
          optimisticApplied: false,
          ...(event.error ? { error: event.error } : {}),
        }
      }
      return {
        command,
        event,
        accepted: true,
        state: optimisticState,
        changed: optimisticChanged,
        optimisticApplied: optimisticChanged,
        ...(event.error ? { error: event.error } : {}),
      }
    } catch (error) {
      return rejected(
        command,
        error instanceof Error ? error.message : String(error),
        options.currentState,
        options.currentRevision,
      )
    }
  }

  if (!options.currentState) {
    return rejected(command, 'no command transport or local world state', undefined, options.currentRevision)
  }

  const applied = applyWorldCommand(options.currentState, command)
  const revision = (options.currentRevision || 0) + (applied.changed ? 1 : 0)
  return {
    command,
    event: makeCommandAcceptedEvent(command, {
      revision,
      acceptedAt: command.createdAt,
    }),
    accepted: true,
    state: applied.state,
    changed: applied.changed,
    optimisticApplied: false,
  }
}

function rejected(
  command: WorldCommandEnvelope,
  error: string,
  state?: WorldState,
  currentRevision = 0,
  optimisticApplied = false,
): SubmitWorldCommandResult {
  return {
    command,
    event: makeCommandRejectedEvent(command, {
      error,
      revision: currentRevision,
      acceptedAt: new Date().toISOString(),
    }),
    accepted: false,
    state,
    changed: false,
    optimisticApplied,
    error,
  }
}
