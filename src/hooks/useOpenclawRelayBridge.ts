'use client'

/**
 * useOpenclawRelayBridge
 *
 * Browser-side WSS connection to the OpenClaw relay. This is the executor
 * half of the unified WSS design: the relay forwards `tool.call` envelopes
 * from the OpenClaw-side bridge to this hook, the hook proxies them through
 * `/api/relay/execute` to run against existing Oasis tool surface, and the
 * result goes back as `tool.result` on the same socket.
 *
 * Handles browser-executed tools plus chat envelopes. Presence / portal frames
 * are still observed but left to future UI surfaces.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import {
  buildRelayMessage,
  parseRelayMessage,
  RelayProtocolError,
  type RelayMessage,
  type SessionSyncResponse,
  type ToolCall,
} from '@/lib/relay/protocol'

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export type RelayConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'paired'
  | 'reconnecting'
  | 'closed'
  | 'error'

export interface UseOpenclawRelayBridgeOptions {
  enabled: boolean
  /** Default chosen by protocol of `window.location` when omitted. */
  relayUrl?: string
  worldId: string
  /** Defaults to `worldId` for single-room worlds. Distinct in multiplayer. */
  roomId?: string
  /** Sent on every `/api/relay/execute` POST. Defaults to `'openclaw'`. */
  agentType?: string
  /**
   * Tool names announced to the agent in `browser.ready`. Caller should
   * memoize this array — a new identity triggers reconnect.
   */
  availableTools?: readonly string[]
  onChatAgentDelta?: (event: { sessionId: string; text: string }) => void
  onChatAgentFinal?: (event: { sessionId: string; text: string }) => void
  onSessionSyncResponse?: (event: SessionSyncResponse) => void
  onToolCall?: (event: { callId: string; toolName: string; args: Record<string, unknown>; worldId: string }) => void
  onToolResult?: (event: {
    callId: string
    toolName: string
    ok: boolean
    data?: unknown
    error?: { code: string; message: string }
    worldId: string
    durationMs: number
  }) => void
}

export interface RelayBridgeState {
  status: RelayConnectionStatus
  relaySessionId: string | null
  lastError: string | null
  inFlightCalls: number
  totalCalls: number
  /**
   * Tool calls whose `tool.result` could not be sent because the socket
   * closed mid-execute. Surfaces as a counter so operators can see when a
   * pairing is unstable without reading logs.
   */
  droppedCalls: number
  lastToolCallAt: number | null
  lastToolName: string | null
  lastToolWorldId: string | null
  sendChatUser: (sessionId: string, text: string) => boolean
  requestSessionSync: (opts?: { selectedSessionId?: string; includeMessages?: boolean; limit?: number }) => boolean
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

const RECONNECT_INITIAL_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const RECONNECT_FACTOR = 1.7

const SESSION_STORAGE_KEY = 'oasis.relay.browserSessionId'

const DEFAULT_AVAILABLE_TOOLS: readonly string[] = Object.freeze([
  'get_world_info',
  'place_object',
  'screenshot_viewport',
])

function defaultRelayUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:4517/?role=browser'
  if (window.location?.protocol === 'https:') {
    return `wss://${window.location.host}/relay?role=browser`
  }
  // Plain HTTP: keep the dev sidecar port but follow whatever host the user
  // is browsing from (LAN, codespaces, ngrok, etc.). Falls back to localhost.
  const host = window.location?.hostname || 'localhost'
  return `ws://${host}:4517/?role=browser`
}

function getStableBrowserSessionId(): string {
  if (typeof window === 'undefined') return 'ssr-no-session'
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (existing) return existing
    const fresh = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `bs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, fresh)
    return fresh
  } catch {
    // Privacy mode / disabled storage. Fall back to per-mount ephemeral ID.
    return `bs_ephemeral_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  }
}

interface ExecuteRouteSuccess {
  ok: true
  data: unknown
  message?: string | null
}

interface ExecuteRouteFailure {
  ok: false
  error: { code: string; message: string }
  data?: unknown
}

type ExecuteRouteResponse = ExecuteRouteSuccess | ExecuteRouteFailure

async function postExecute(
  call: ToolCall,
  context: { worldId: string; agentType: string },
): Promise<ExecuteRouteResponse> {
  try {
    const response = await fetch('/api/relay/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        toolName: call.toolName,
        args: call.args,
        worldId: context.worldId,
        agentType: context.agentType,
      }),
    })
    const text = await response.text()
    let parsed: unknown = null
    try { parsed = JSON.parse(text) } catch { /* fall through */ }
    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        error: {
          code: 'invalid_response',
          message: `non-JSON response (status ${response.status}): ${text.slice(0, 200)}`,
        },
      }
    }
    return parsed as ExecuteRouteResponse
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: { code: 'fetch_failed', message },
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

const IDLE_RELAY_BRIDGE_STATE: RelayBridgeState = Object.freeze({
  status: 'idle',
  relaySessionId: null,
  lastError: null,
  inFlightCalls: 0,
  totalCalls: 0,
  droppedCalls: 0,
  lastToolCallAt: null,
  lastToolName: null,
  lastToolWorldId: null,
  sendChatUser: () => false,
  requestSessionSync: () => false,
})

let sharedRelayOwnerId: string | null = null
let sharedRelaySnapshot: RelayBridgeState = IDLE_RELAY_BRIDGE_STATE
const sharedRelayOwnershipListeners = new Set<() => void>()
const sharedRelaySnapshotListeners = new Set<() => void>()
const sharedRelayChatCallbacks = new Map<string, Pick<
  UseOpenclawRelayBridgeOptions,
  'onChatAgentDelta' | 'onChatAgentFinal' | 'onSessionSyncResponse' | 'onToolCall' | 'onToolResult'
>>()

function notifySharedRelayOwnership() {
  for (const listener of sharedRelayOwnershipListeners) listener()
}

function notifySharedRelaySnapshot() {
  for (const listener of sharedRelaySnapshotListeners) listener()
}

function setSharedRelaySnapshot(snapshot: RelayBridgeState) {
  sharedRelaySnapshot = snapshot
  notifySharedRelaySnapshot()
}

function subscribeSharedRelaySnapshot(listener: () => void) {
  sharedRelaySnapshotListeners.add(listener)
  return () => {
    sharedRelaySnapshotListeners.delete(listener)
  }
}

function getSharedRelaySnapshot() {
  return sharedRelaySnapshot
}

function dispatchSharedRelayDelta(event: { sessionId: string; text: string }) {
  for (const callbacks of sharedRelayChatCallbacks.values()) {
    callbacks.onChatAgentDelta?.(event)
  }
}

function dispatchSharedRelayFinal(event: { sessionId: string; text: string }) {
  for (const callbacks of sharedRelayChatCallbacks.values()) {
    callbacks.onChatAgentFinal?.(event)
  }
}

function dispatchSharedRelaySessionSync(event: SessionSyncResponse) {
  for (const callbacks of sharedRelayChatCallbacks.values()) {
    callbacks.onSessionSyncResponse?.(event)
  }
}

function dispatchSharedRelayToolCall(event: { callId: string; toolName: string; args: Record<string, unknown>; worldId: string }) {
  for (const callbacks of sharedRelayChatCallbacks.values()) {
    callbacks.onToolCall?.(event)
  }
}

function dispatchSharedRelayToolResult(event: {
  callId: string
  toolName: string
  ok: boolean
  data?: unknown
  error?: { code: string; message: string }
  worldId: string
  durationMs: number
}) {
  for (const callbacks of sharedRelayChatCallbacks.values()) {
    callbacks.onToolResult?.(event)
  }
}

function useSharedRelayOwnership(wantsOwnership: boolean): boolean {
  const ownerIdRef = useRef<string | null>(null)
  if (!ownerIdRef.current) {
    ownerIdRef.current = `openclaw-shared-relay-${Math.random().toString(36).slice(2)}`
  }

  const wantsOwnershipRef = useRef(wantsOwnership)
  wantsOwnershipRef.current = wantsOwnership
  const [, rerender] = useState(0)

  const tryAcquireOrRefresh = useCallback(() => {
    if (wantsOwnershipRef.current && sharedRelayOwnerId === null) {
      sharedRelayOwnerId = ownerIdRef.current
      notifySharedRelayOwnership()
      return
    }
    rerender(value => value + 1)
  }, [])

  useEffect(() => {
    sharedRelayOwnershipListeners.add(tryAcquireOrRefresh)
    return () => {
      sharedRelayOwnershipListeners.delete(tryAcquireOrRefresh)
      if (sharedRelayOwnerId === ownerIdRef.current) {
        sharedRelayOwnerId = null
        setSharedRelaySnapshot(IDLE_RELAY_BRIDGE_STATE)
        notifySharedRelayOwnership()
      }
    }
  }, [tryAcquireOrRefresh])

  useEffect(() => {
    if (wantsOwnership) {
      if (sharedRelayOwnerId === null) {
        sharedRelayOwnerId = ownerIdRef.current
        notifySharedRelayOwnership()
      }
    } else if (sharedRelayOwnerId === ownerIdRef.current) {
      sharedRelayOwnerId = null
      setSharedRelaySnapshot(IDLE_RELAY_BRIDGE_STATE)
      notifySharedRelayOwnership()
    }
  }, [wantsOwnership])

  return wantsOwnership && sharedRelayOwnerId === ownerIdRef.current
}

export function useOpenclawRelayBridge(opts: UseOpenclawRelayBridgeOptions): RelayBridgeState {
  const {
    enabled,
    relayUrl,
    worldId,
    roomId,
    agentType = 'openclaw',
    availableTools,
    onChatAgentDelta,
    onChatAgentFinal,
    onSessionSyncResponse,
    onToolCall,
    onToolResult,
  } = opts

  const [status, setStatus] = useState<RelayConnectionStatus>('idle')
  const [relaySessionId, setRelaySessionId] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [inFlightCalls, setInFlightCalls] = useState(0)
  const [totalCalls, setTotalCalls] = useState(0)
  const [droppedCalls, setDroppedCalls] = useState(0)
  const [lastToolCall, setLastToolCall] = useState<{
    at: number
    toolName: string
    worldId: string
  } | null>(null)
  const [sessionReady, setSessionReady] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(RECONNECT_INITIAL_MS)
  const browserSessionIdRef = useRef<string>('')
  const onChatAgentDeltaRef = useRef(onChatAgentDelta)
  const onChatAgentFinalRef = useRef(onChatAgentFinal)
  const onSessionSyncResponseRef = useRef(onSessionSyncResponse)
  const onToolCallRef = useRef(onToolCall)
  const onToolResultRef = useRef(onToolResult)

  // Latest values, read inside async handlers without forcing reconnect.
  const worldIdRef = useRef(worldId)
  const roomIdRef = useRef(roomId ?? worldId)
  const agentTypeRef = useRef(agentType)
  const availableToolsRef = useRef<readonly string[]>(availableTools ?? DEFAULT_AVAILABLE_TOOLS)

  worldIdRef.current = worldId
  roomIdRef.current = roomId ?? worldId
  agentTypeRef.current = agentType
  availableToolsRef.current = availableTools ?? DEFAULT_AVAILABLE_TOOLS
  onChatAgentDeltaRef.current = onChatAgentDelta
  onChatAgentFinalRef.current = onChatAgentFinal
  onSessionSyncResponseRef.current = onSessionSyncResponse
  onToolCallRef.current = onToolCall
  onToolResultRef.current = onToolResult

  if (!browserSessionIdRef.current) {
    browserSessionIdRef.current = getStableBrowserSessionId()
  }

  // Ensure the signed `oasis_session` cookie exists before we attempt the WS
  // upgrade. The hosted relay rejects upgrades without a valid cookie, so we
  // gate `sessionReady` until /api/session/init has confirmed. If init never
  // succeeds (privacy mode, blocked extension, network), surface `error` after
  // a short timeout instead of leaving the UI stuck on `idle` forever.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let resolved = false

    const timeout = setTimeout(() => {
      if (cancelled || resolved) return
      setLastError(prev => prev ?? 'session init timed out (cookie blocked or network down?)')
      setStatus('error')
    }, 5_000)

    void fetch('/api/session/init', { credentials: 'same-origin' })
      .then(async (response) => {
        if (cancelled) return
        if (!response.ok) {
          setLastError(`session init failed: HTTP ${response.status}`)
          setStatus('error')
          return
        }
        const json = await response.json().catch(() => null) as
          | { ok: true; browserSessionId: string; minted: boolean }
          | null
        if (!json || !json.ok || typeof json.browserSessionId !== 'string') {
          setLastError('session init returned malformed response')
          setStatus('error')
          return
        }
        // Use the server's browserSessionId as canonical so `browser.hello` matches
        // the cookie the relay verifies on upgrade. The earlier local-only id
        // from sessionStorage is replaced.
        browserSessionIdRef.current = json.browserSessionId
        if (!cancelled) {
          resolved = true
          setSessionReady(true)
        }
      })
      .catch((err) => {
        if (cancelled) return
        const text = err instanceof Error ? err.message : String(err)
        setLastError(`session init threw: ${text}`)
        setStatus('error')
      })
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [enabled])

  const sendEnvelope = useCallback((ws: WebSocket, msg: Parameters<typeof buildRelayMessage>[0]) => {
    if (ws.readyState !== ws.OPEN) return false
    try {
      const built = buildRelayMessage(msg)
      ws.send(JSON.stringify(built))
      return true
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setLastError(`send failed: ${text}`)
      console.error('[relay-bridge] send failed', err)
      return false
    }
  }, [])

  const handleToolCall = useCallback(async (ws: WebSocket, call: ToolCall) => {
    const startedAt = Date.now()
    const currentWorldId = worldIdRef.current
    setInFlightCalls(n => n + 1)
    setTotalCalls(n => n + 1)
    setLastToolCall({
      at: startedAt,
      toolName: call.toolName,
      worldId: currentWorldId,
    })
    onToolCallRef.current?.({
      callId: call.callId,
      toolName: call.toolName,
      args: call.args,
      worldId: currentWorldId,
    })
    console.info('[relay-bridge] tool.call <- bridge', {
      callId: call.callId,
      toolName: call.toolName,
      worldId: currentWorldId,
    })
    try {
      const response = await postExecute(call, {
        worldId: currentWorldId,
        agentType: agentTypeRef.current,
      })
      onToolResultRef.current?.({
        callId: call.callId,
        toolName: call.toolName,
        ok: response.ok,
        data: response.ok ? response.data : response.data,
        error: response.ok ? undefined : response.error,
        worldId: currentWorldId,
        durationMs: Date.now() - startedAt,
      })
      if (ws.readyState !== WebSocket.OPEN) {
        // Socket closed while we were executing. The agent will never see this
        // result. Surface it as a counter and a warning so unstable pairings
        // are visible without trawling logs. Replay-on-reconnect is a future
        // improvement; for now we don't pretend to deliver.
        setDroppedCalls(n => n + 1)
        console.warn('[relay-bridge] tool.result dropped: socket closed before reply', {
          callId: call.callId,
          toolName: call.toolName,
        })
        return
      }
      if (response.ok) {
        sendEnvelope(ws, {
          type: 'tool.result',
          callId: call.callId,
          ok: true,
          data: response.data,
        })
      } else {
        sendEnvelope(ws, {
          type: 'tool.result',
          callId: call.callId,
          ok: false,
          error: response.error,
          data: response.data,
        })
      }
    } finally {
      setInFlightCalls(n => Math.max(0, n - 1))
    }
  }, [sendEnvelope])

  useEffect(() => {
    if (!enabled || !sessionReady) {
      setStatus('idle')
      return
    }

    let cancelled = false
    const url = relayUrl ?? defaultRelayUrl()

    const scheduleReconnect = () => {
      if (cancelled) return
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      const delay = Math.min(reconnectDelayRef.current, RECONNECT_MAX_MS)
      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * RECONNECT_FACTOR, RECONNECT_MAX_MS)
        connect()
      }, delay)
    }

    const connect = () => {
      if (cancelled) return
      const existing = wsRef.current
      if (existing && existing.readyState !== WebSocket.CLOSED) return

      setStatus('connecting')
      setLastError(null)

      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        setLastError(`construct failed: ${text}`)
        setStatus('error')
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      // Per-socket guard against double hello/ready emission. Reset by virtue
      // of being declared inside `connect()` — every reconnect gets a fresh
      // ws and a fresh flag.
      let helloSent = false

      ws.onopen = () => {
        if (cancelled) return
        setStatus('connected')
        reconnectDelayRef.current = RECONNECT_INITIAL_MS
      }

      ws.onerror = (event) => {
        console.error('[relay-bridge] socket error', event)
        setLastError('socket error')
      }

      ws.onclose = () => {
        wsRef.current = null
        if (cancelled) {
          setStatus('closed')
          return
        }
        setStatus('reconnecting')
        scheduleReconnect()
      }

      ws.onmessage = async (event) => {
        const raw = typeof event.data === 'string' ? event.data : ''
        if (!raw) return

        let parsed: unknown
        try { parsed = JSON.parse(raw) }
        catch {
          console.warn('[relay-bridge] non-JSON frame, dropped')
          return
        }

        // Sidecar courtesy frame; not part of the wire vocabulary.
        if (parsed && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'relay.paired') {
          const sid = (parsed as { relaySessionId?: unknown }).relaySessionId
          const sessionId = typeof sid === 'string' ? sid : null
          setRelaySessionId(sessionId)
          setStatus('paired')

          if (helloSent) {
            // Replayed courtesy frame from a buggy or restarted relay. We have
            // already announced ourselves on this socket; ignore the duplicate.
            return
          }
          helloSent = true

          sendEnvelope(ws, {
            type: 'browser.hello',
            browserSessionId: browserSessionIdRef.current,
            worldId: worldIdRef.current,
            roomId: roomIdRef.current,
            relaySessionId: sessionId ?? undefined,
          })
          sendEnvelope(ws, {
            type: 'browser.ready',
            worldId: worldIdRef.current,
            availableTools: [...availableToolsRef.current],
            relaySessionId: sessionId ?? undefined,
          })
          return
        }

        let envelope: RelayMessage
        try {
          envelope = parseRelayMessage(parsed)
        } catch (err) {
          if (err instanceof RelayProtocolError) {
            console.warn('[relay-bridge] rejected envelope:', err.message)
          } else {
            console.error('[relay-bridge] parse threw', err)
          }
          return
        }

        if (envelope.type === 'tool.call') {
          await handleToolCall(ws, envelope)
          return
        }

        if (envelope.type === 'chat.agent.delta') {
          onChatAgentDeltaRef.current?.({ sessionId: envelope.sessionId, text: envelope.text })
          return
        }

        if (envelope.type === 'chat.agent.final') {
          onChatAgentFinalRef.current?.({ sessionId: envelope.sessionId, text: envelope.text })
          return
        }

        if (envelope.type === 'session.sync.response') {
          onSessionSyncResponseRef.current?.(envelope)
          return
        }

        // chat.user / presence.update / portal.enter /
        // pairing.approved / browser.hello / browser.ready / agent.hello /
        // tool.result / error — observed but not handled at this layer in v0.
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const ws = wsRef.current
      if (ws) {
        try { ws.close(1000, 'unmount') } catch { /* ignore */ }
        wsRef.current = null
      }
      setStatus('closed')
    }
  }, [enabled, sessionReady, relayUrl, sendEnvelope, handleToolCall])

  useEffect(() => {
    const ws = wsRef.current
    if (!enabled || !sessionReady || status !== 'paired' || !ws || ws.readyState !== WebSocket.OPEN) return
    sendEnvelope(ws, {
      type: 'browser.ready',
      worldId: worldIdRef.current,
      availableTools: [...availableToolsRef.current],
      relaySessionId: relaySessionId ?? undefined,
    })
  }, [enabled, sessionReady, status, relaySessionId, worldId, roomId, availableTools, sendEnvelope])

  const sendChatUser = useCallback((sessionId: string, text: string): boolean => {
    const trimmedSessionId = sessionId.trim()
    const trimmedText = text.trim()
    const ws = wsRef.current
    if (!trimmedSessionId || !trimmedText || !ws || ws.readyState !== WebSocket.OPEN || status !== 'paired') {
      return false
    }
    return sendEnvelope(ws, {
      type: 'chat.user',
      sessionId: trimmedSessionId,
      text: trimmedText,
      relaySessionId: relaySessionId ?? undefined,
    })
  }, [relaySessionId, sendEnvelope, status])

  const requestSessionSync = useCallback((opts?: {
    selectedSessionId?: string
    includeMessages?: boolean
    limit?: number
  }): boolean => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || status !== 'paired') {
      return false
    }
    return sendEnvelope(ws, {
      type: 'session.sync.request',
      limit: opts?.limit,
      includeMessages: opts?.includeMessages,
      selectedSessionId: opts?.selectedSessionId || undefined,
      relaySessionId: relaySessionId ?? undefined,
    })
  }, [relaySessionId, sendEnvelope, status])

  return {
    status,
    relaySessionId,
    lastError,
    inFlightCalls,
    totalCalls,
    droppedCalls,
    lastToolCallAt: lastToolCall?.at ?? null,
    lastToolName: lastToolCall?.toolName ?? null,
    lastToolWorldId: lastToolCall?.worldId ?? null,
    sendChatUser,
    requestSessionSync,
  }
}

export function useSharedOpenclawRelayBridge(opts: UseOpenclawRelayBridgeOptions): RelayBridgeState {
  const instanceIdRef = useRef<string | null>(null)
  if (!instanceIdRef.current) {
    instanceIdRef.current = `openclaw-relay-subscriber-${Math.random().toString(36).slice(2)}`
  }

  const ownsRelayConnection = useSharedRelayOwnership(opts.enabled)
  const sharedSnapshot = useSyncExternalStore(
    subscribeSharedRelaySnapshot,
    getSharedRelaySnapshot,
    getSharedRelaySnapshot,
  )

  useEffect(() => {
    const instanceId = instanceIdRef.current
    if (!instanceId) return
    sharedRelayChatCallbacks.set(instanceId, {
      onChatAgentDelta: opts.onChatAgentDelta,
      onChatAgentFinal: opts.onChatAgentFinal,
      onSessionSyncResponse: opts.onSessionSyncResponse,
      onToolCall: opts.onToolCall,
      onToolResult: opts.onToolResult,
    })
    return () => {
      sharedRelayChatCallbacks.delete(instanceId)
    }
  }, [opts.onChatAgentDelta, opts.onChatAgentFinal, opts.onSessionSyncResponse, opts.onToolCall, opts.onToolResult])

  const ownedBridge = useOpenclawRelayBridge({
    ...opts,
    enabled: ownsRelayConnection,
    onChatAgentDelta: dispatchSharedRelayDelta,
    onChatAgentFinal: dispatchSharedRelayFinal,
    onSessionSyncResponse: dispatchSharedRelaySessionSync,
    onToolCall: dispatchSharedRelayToolCall,
    onToolResult: dispatchSharedRelayToolResult,
  })

  useEffect(() => {
    if (!ownsRelayConnection) return
    setSharedRelaySnapshot({
      status: ownedBridge.status,
      relaySessionId: ownedBridge.relaySessionId,
      lastError: ownedBridge.lastError,
      inFlightCalls: ownedBridge.inFlightCalls,
      totalCalls: ownedBridge.totalCalls,
      droppedCalls: ownedBridge.droppedCalls,
      lastToolCallAt: ownedBridge.lastToolCallAt,
      lastToolName: ownedBridge.lastToolName,
      lastToolWorldId: ownedBridge.lastToolWorldId,
      sendChatUser: ownedBridge.sendChatUser,
      requestSessionSync: ownedBridge.requestSessionSync,
    })
  }, [
    ownsRelayConnection,
    ownedBridge.status,
    ownedBridge.relaySessionId,
    ownedBridge.lastError,
    ownedBridge.inFlightCalls,
    ownedBridge.totalCalls,
    ownedBridge.droppedCalls,
    ownedBridge.lastToolCallAt,
    ownedBridge.lastToolName,
    ownedBridge.lastToolWorldId,
    ownedBridge.sendChatUser,
    ownedBridge.requestSessionSync,
  ])

  return ownsRelayConnection ? ownedBridge : sharedSnapshot
}
