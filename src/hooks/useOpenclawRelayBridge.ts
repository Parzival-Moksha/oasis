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
 * v0 scope: tool execution only. Chat / presence / portal envelopes arrive
 * but are ignored at this layer; they will be wired into existing UI surfaces
 * in subsequent slices.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  buildRelayMessage,
  parseRelayMessage,
  RelayProtocolError,
  type RelayMessage,
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

export function useOpenclawRelayBridge(opts: UseOpenclawRelayBridgeOptions): RelayBridgeState {
  const {
    enabled,
    relayUrl,
    worldId,
    roomId,
    agentType = 'openclaw',
    availableTools,
  } = opts

  const [status, setStatus] = useState<RelayConnectionStatus>('idle')
  const [relaySessionId, setRelaySessionId] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [inFlightCalls, setInFlightCalls] = useState(0)
  const [totalCalls, setTotalCalls] = useState(0)
  const [droppedCalls, setDroppedCalls] = useState(0)
  const [sessionReady, setSessionReady] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(RECONNECT_INITIAL_MS)
  const browserSessionIdRef = useRef<string>('')

  // Latest values, read inside async handlers without forcing reconnect.
  const worldIdRef = useRef(worldId)
  const roomIdRef = useRef(roomId ?? worldId)
  const agentTypeRef = useRef(agentType)
  const availableToolsRef = useRef<readonly string[]>(availableTools ?? DEFAULT_AVAILABLE_TOOLS)

  worldIdRef.current = worldId
  roomIdRef.current = roomId ?? worldId
  agentTypeRef.current = agentType
  availableToolsRef.current = availableTools ?? DEFAULT_AVAILABLE_TOOLS

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
    if (ws.readyState !== ws.OPEN) return
    try {
      const built = buildRelayMessage(msg)
      ws.send(JSON.stringify(built))
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setLastError(`send failed: ${text}`)
      console.error('[relay-bridge] send failed', err)
    }
  }, [])

  const handleToolCall = useCallback(async (ws: WebSocket, call: ToolCall) => {
    setInFlightCalls(n => n + 1)
    setTotalCalls(n => n + 1)
    try {
      const response = await postExecute(call, {
        worldId: worldIdRef.current,
        agentType: agentTypeRef.current,
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

        // chat.user / chat.agent.* / presence.update / portal.enter /
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

  return {
    status,
    relaySessionId,
    lastError,
    inFlightCalls,
    totalCalls,
    droppedCalls,
  }
}
