/**
 * POST /api/relay/execute
 *
 * Single ingress for the browser-as-executor pattern. The browser relay hook
 * (src/hooks/useOpenclawRelayBridge.ts) receives `tool.call` envelopes from
 * the relay, posts them here, and forwards the response back as `tool.result`.
 *
 * Why a dedicated route instead of fanning out to existing endpoints:
 *   - one auth path  (hosted-mode browser session cookie verification)
 *   - one log path   (every relay-driven tool execution flows through here)
 *   - one allowlist  (spellbook filter when OASIS_MODE === 'hosted')
 *   - matches the spec: "browser bridge calls native Oasis world functions"
 *
 * Request body:
 *   {
 *     toolName: string,
 *     args:     Record<string, unknown>,
 *     worldId?: string,
 *     agentType?: string,   // defaults to 'openclaw'
 *   }
 *
 * Response:
 *   { ok: true,  data: unknown, message?: string }
 *   { ok: false, error: { code: string, message: string }, data?: unknown }
 */

import { NextRequest } from 'next/server'

import { callTool } from '@/lib/mcp/oasis-tools'
import { prepareOasisToolArgs } from '@/lib/mcp/oasis-tool-spec.js'
import { isPublicTool } from '@/lib/relay/public-allowlist'
import { getOasisMode, readBrowserSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ExecuteRequestBody {
  toolName?: unknown
  args?: unknown
  worldId?: unknown
  agentType?: unknown
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Match the relay's per-frame cap so a relay peer can't blow past it through
// the HTTP route either. Honest oversized requests get rejected before parse;
// a lying client still gets bounded by Next's runtime limits downstream.
const MAX_EXECUTE_BODY_BYTES = 256 * 1024

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get('content-length') || '0')
  if (declaredLength > MAX_EXECUTE_BODY_BYTES) {
    return jsonResponse({
      ok: false,
      error: { code: 'payload_too_large', message: `body exceeds ${MAX_EXECUTE_BODY_BYTES} bytes` },
    }, 413)
  }

  let body: ExecuteRequestBody
  try {
    body = await request.json() as ExecuteRequestBody
  } catch {
    return jsonResponse({
      ok: false,
      error: { code: 'invalid_body', message: 'JSON body required' },
    }, 400)
  }

  const toolName = typeof body.toolName === 'string' ? body.toolName.trim() : ''
  if (!toolName) {
    return jsonResponse({
      ok: false,
      error: { code: 'missing_tool_name', message: 'toolName is required' },
    }, 400)
  }

  const mode = getOasisMode()
  const session = readBrowserSession(request)

  // Hosted-mode gates: signed session cookie + spellbook allowlist.
  // Local mode skips both — local-dev callers (curl, the test page) need the
  // route to be friction-free. The relay sidecar enforces equivalent checks
  // at the WS layer when it's running in production.
  if (mode === 'hosted') {
    if (!session) {
      return jsonResponse({
        ok: false,
        error: { code: 'no_session', message: 'oasis_session cookie required in hosted mode' },
      }, 401)
    }
    if (!isPublicTool(toolName)) {
      return jsonResponse({
        ok: false,
        error: { code: 'tool_not_public', message: `tool "${toolName}" is not in the public spellbook` },
      }, 403)
    }
  }

  const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args))
    ? body.args as Record<string, unknown>
    : {}
  const rawWorldId = typeof body.worldId === 'string' ? body.worldId.trim() : ''
  // `__active__` is a sentinel used by callers (e.g. /relay-test, the bridge)
  // that don't know the real active world id. Treat it as "no context" so the
  // tool handlers fall back to their own active-world resolution rather than
  // looking up a literal world named "__active__".
  const worldId = rawWorldId && rawWorldId !== '__active__' ? rawWorldId : undefined
  const agentType = typeof body.agentType === 'string' && body.agentType.trim()
    ? body.agentType.trim().toLowerCase()
    : 'openclaw'

  try {
    const prepared = prepareOasisToolArgs(toolName, args, { worldId, agentType })
    const result = await callTool(toolName, prepared, {
      source: 'relay',
      userId: session?.browserSessionId,
      worldId,
      agentType,
      requireExplicitWorld: mode === 'hosted',
    })
    if (result.ok) {
      return jsonResponse({
        ok: true,
        data: result.data ?? null,
        message: result.message ?? null,
      })
    }
    return jsonResponse({
      ok: false,
      error: {
        code: 'tool_failed',
        message: result.message || `tool ${toolName} returned ok:false`,
      },
      data: result.data ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Log identity + bounded snippet only. The full message goes to the caller.
    // TODO(hosted): drop the snippet entirely when OASIS_MODE === 'hosted' to
    // avoid echoing user-supplied tool args into shared logs.
    console.error('[/api/relay/execute] tool threw', {
      toolName,
      snippet: message.slice(0, 160),
    })
    return jsonResponse({
      ok: false,
      error: { code: 'execute_exception', message },
    }, 500)
  }
}
