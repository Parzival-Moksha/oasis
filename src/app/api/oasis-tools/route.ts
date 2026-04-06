// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS TOOLS API — REST endpoint for world manipulation
// ─═̷─═̷─ॐ─═̷─═̷─ Any agent can call these tools ─═̷─═̷─ॐ─═̷─═̷─
//
// POST /api/oasis-tools  { tool: string, args: Record<string, unknown> }
// GET  /api/oasis-tools  → list available tools
// POST /api/oasis-tools/screenshot  → deliver a screenshot capture
//
// Auth: Bearer token via OASIS_MCP_KEY env var (optional for localhost)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { callTool, TOOL_NAMES, deliverScreenshot, isScreenshotPending } from '@/lib/mcp/oasis-tools'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isAuthorized(request: NextRequest): boolean {
  const key = process.env.OASIS_MCP_KEY
  if (!key) return true // No key configured = open (localhost-only by default)

  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  return token === key
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    tools: TOOL_NAMES,
    screenshotPending: isScreenshotPending(),
    version: '1.0.0',
  })
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as {
    tool?: string
    args?: Record<string, unknown>
    screenshotData?: string
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  // Screenshot delivery endpoint
  if (body.screenshotData) {
    const delivered = deliverScreenshot(body.screenshotData)
    return NextResponse.json({ ok: delivered, message: delivered ? 'Screenshot delivered.' : 'No pending screenshot request.' })
  }

  const toolName = typeof body.tool === 'string' ? body.tool.trim() : ''
  if (!toolName) {
    return NextResponse.json({ error: 'tool name is required. Available: ' + TOOL_NAMES.join(', ') }, { status: 400 })
  }

  const args = body.args && typeof body.args === 'object' ? body.args : {}
  const result = await callTool(toolName, args)

  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
