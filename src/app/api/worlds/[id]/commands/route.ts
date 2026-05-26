import { NextResponse } from 'next/server'

import {
  loadWorld,
  loadWorldCommandEvent,
  nextWorldCommandRevision,
  saveWorldWithCommandEvent,
} from '@/lib/forge/world-server'
import { WorldAccessError } from '@/lib/forge/world-access'
import { getRequiredOasisUserId } from '@/lib/session'
import { getRoomSigningKey } from '@/lib/room-join-claim'
import { withWorldMutationLock } from '@/lib/world-mutation-lock'
import { makeCommandAcceptedEvent, makeCommandRejectedEvent } from '@/lib/world-commands/events'
import { applyWorldCommand } from '@/lib/world-commands/reducer'
import type { WorldCommandEnvelope, WorldEventEnvelope } from '@/lib/world-commands/types'
import { validateWorldCommandForDurableApply } from '@/lib/world-commands/validators'

type RouteContext = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_COMMAND_APPLY_ATTEMPTS = 3

function errorResponse(err: unknown, label: string) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[WorldCommands] ${label}:`, msg)
  if (err instanceof WorldAccessError) {
    return NextResponse.json({ error: msg, code: err.code }, { status: err.status })
  }
  return NextResponse.json({ error: msg }, { status: 500 })
}

function asCommandCandidate(value: unknown): Partial<WorldCommandEnvelope> | null {
  return value && typeof value === 'object' ? value as Partial<WorldCommandEnvelope> : null
}

function makeRouteRejectedEvent(worldId: string, actorId: string, error: string, commandBody?: unknown): WorldEventEnvelope {
  const acceptedAt = new Date().toISOString()
  const command = asCommandCandidate(commandBody)
  const commandId = typeof command?.id === 'string' ? command.id : undefined
  return {
    id: `world-event-command-rejected-route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: 'command.rejected',
    worldId,
    ...(commandId ? { commandId } : {}),
    actorId,
    acceptedAt,
    revision: 0,
    error,
    ...(commandId ? { command: { ...command, actorId, worldId } as WorldCommandEnvelope } : {}),
  }
}

function readInternalCommandActor(request: Request, body: unknown): string | null {
  const provided = request.headers.get('x-oasis-room-secret')
  if (provided === null) return null
  let expected = ''
  try {
    expected = process.env.OASIS_ROOM_INTERNAL_SECRET || getRoomSigningKey()
  } catch {
    return ''
  }
  if (!expected || provided !== expected) return ''
  if (!body || typeof body !== 'object' || !('actorUserId' in body)) return ''
  const actorUserId = (body as { actorUserId?: unknown }).actorUserId
  return typeof actorUserId === 'string' && actorUserId.trim().length > 0 ? actorUserId.trim() : ''
}

export async function POST(request: Request, context: RouteContext) {
  let body: unknown
  try {
    body = await request.json()
    const internalActorId = readInternalCommandActor(request, body)
    if (internalActorId === '') {
      return NextResponse.json({ error: 'invalid room command secret' }, { status: 401 })
    }
    const userId = internalActorId || getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const { id: worldId } = await context.params
    const includeState = Boolean(internalActorId && body && typeof body === 'object' && (body as { includeState?: unknown }).includeState === true)
    const commandBody = body && typeof body === 'object' && 'command' in body
      ? (body as { command?: unknown }).command
      : body
    const validation = validateWorldCommandForDurableApply(commandBody)
    if (!validation.ok) {
      return NextResponse.json({
        event: makeRouteRejectedEvent(worldId, userId, validation.error, commandBody),
      }, { status: 400 })
    }

    const submittedCommand = validation.command
    const command = {
      ...submittedCommand,
      actorId: userId,
      actorDisplayName: internalActorId ? submittedCommand.actorDisplayName : undefined,
      clientId: internalActorId ? (submittedCommand.clientId || 'room-command') : 'http-command',
    }
    if (command.worldId !== worldId) {
      return NextResponse.json({
        event: makeCommandRejectedEvent(command, {
          revision: 0,
          acceptedAt: new Date().toISOString(),
          error: 'world id mismatch',
        }),
      }, { status: 409 })
    }

    return await withWorldMutationLock(worldId, async () => {
      const existingEvent = await loadWorldCommandEvent(worldId, command.id)
      if (existingEvent) {
        return NextResponse.json({
          ok: true,
          duplicate: true,
          changed: false,
          worldId: existingEvent.worldId,
          event: existingEvent,
        })
      }

      for (let attempt = 1; attempt <= MAX_COMMAND_APPLY_ATTEMPTS; attempt += 1) {
        const current = await loadWorld(worldId, userId)
        if (!current) {
          return NextResponse.json({
            event: makeCommandRejectedEvent(command, {
              revision: 0,
              acceptedAt: new Date().toISOString(),
              error: 'world not found',
            }),
          }, { status: 404 })
        }

        const applied = applyWorldCommand(current, command)
        let savedWorldId = worldId
        let forkedFromWorldId: string | undefined
        let savedAt = applied.state.savedAt
        const revision = applied.changed
          ? await nextWorldCommandRevision(savedWorldId)
          : Math.max(0, Number(command.expectedRevision || 0))
        const eventCommand = savedWorldId === command.worldId
          ? command
          : { ...command, worldId: savedWorldId }
        const event = makeCommandAcceptedEvent(eventCommand, {
          revision,
          source: 'http',
          durable: applied.changed,
          acceptedAt: new Date().toISOString(),
        })

        if (applied.changed) {
          let result
          try {
            result = await saveWorldWithCommandEvent(
              worldId,
              userId,
              applied.state,
              {
                eventId: event.id,
                worldId: event.worldId,
                commandId: command.id,
                actorId: command.actorId,
                sessionId: command.clientId,
                kind: command.kind,
                worldVersion: revision,
                createdAt: event.acceptedAt,
                payload: event,
              },
              current.savedAt,
            )
          } catch (error) {
            const duplicateAfterError = await loadWorldCommandEvent(worldId, command.id)
            if (duplicateAfterError) {
              return NextResponse.json({
                ok: true,
                duplicate: true,
                changed: false,
                worldId: duplicateAfterError.worldId,
                event: duplicateAfterError,
              })
            }
            throw error
          }
          if (result.conflict) {
            const duplicateAfterConflict = await loadWorldCommandEvent(worldId, command.id)
            if (duplicateAfterConflict) {
              return NextResponse.json({
                ok: true,
                duplicate: true,
                changed: false,
                worldId: duplicateAfterConflict.worldId,
                event: duplicateAfterConflict,
              })
            }
            if (attempt < MAX_COMMAND_APPLY_ATTEMPTS) continue
            return NextResponse.json({
              event: makeCommandRejectedEvent(command, {
                revision: 0,
                source: 'http',
                durable: false,
                acceptedAt: new Date().toISOString(),
                error: 'world version conflict',
              }),
              serverUpdatedAt: result.serverUpdatedAt,
            }, { status: 409 })
          }
          savedWorldId = result.worldId || savedWorldId
          forkedFromWorldId = result.forkedFromWorldId
          savedAt = result.savedAt || savedAt
        }

        return NextResponse.json({
          ok: true,
          changed: applied.changed,
          worldId: savedWorldId,
          ...(forkedFromWorldId ? { forkedFromWorldId } : {}),
          event,
          ...(includeState ? {
            state: {
              ...applied.state,
              savedAt,
            },
          } : {}),
        })
      }

      return NextResponse.json({
        event: makeCommandRejectedEvent(command, {
          revision: 0,
          source: 'http',
          durable: false,
          acceptedAt: new Date().toISOString(),
          error: 'world version conflict',
        }),
      }, { status: 409 })
    })
  } catch (err) {
    return errorResponse(err, 'POST [id]/commands error')
  }
}
