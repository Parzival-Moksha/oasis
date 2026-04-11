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
import { existsSync } from 'fs'
import { mkdir, readdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { callTool, TOOL_NAMES, deliverScreenshot, getPendingScreenshotRequest, isScreenshotPending } from '@/lib/mcp/oasis-tools'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MERLIN_SCREENSHOT_PUBLIC_DIR = join(process.cwd(), 'public', 'merlin', 'screenshots')
const MAX_SCREENSHOT_FILES = 500

type ScreenshotFormat = 'jpeg' | 'png' | 'webp'
type PendingCapture = { viewId?: string; base64?: string; format?: ScreenshotFormat }

function screenshotExtension(format: ScreenshotFormat): string {
  switch (format) {
    case 'png':
      return 'png'
    case 'webp':
      return 'webp'
    default:
      return 'jpg'
  }
}

function sanitizeSegment(value: string, fallback: string): string {
  const trimmed = value.trim().toLowerCase()
  const sanitized = trimmed.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return sanitized || fallback
}

async function pruneScreenshotDir(dir: string) {
  if (!existsSync(dir)) return
  const files = (await readdir(dir)).sort()
  if (files.length <= MAX_SCREENSHOT_FILES) return
  await Promise.all(files.slice(0, files.length - MAX_SCREENSHOT_FILES).map(file => unlink(join(dir, file)).catch(() => {})))
}

async function persistScreenshotCapture(capture: PendingCapture, requestId: string, index: number) {
  const rawBase64 = typeof capture.base64 === 'string' ? capture.base64.trim() : ''
  const base64 = rawBase64.includes(',') ? (rawBase64.split(',').pop() || '').trim() : rawBase64
  if (!base64) return null
  const format: ScreenshotFormat = capture.format === 'png' || capture.format === 'webp' || capture.format === 'jpeg'
    ? capture.format
    : 'jpeg'
  const ext = screenshotExtension(format)
  const safeRequestId = sanitizeSegment(requestId || 'shot', 'shot')
  const safeViewId = sanitizeSegment(typeof capture.viewId === 'string' ? capture.viewId : `view-${index + 1}`, `view-${index + 1}`)
  const fileName = `${Date.now()}-${index}-${safeRequestId}-${safeViewId}.${ext}`
  const buffer = Buffer.from(base64, 'base64')

  await mkdir(MERLIN_SCREENSHOT_PUBLIC_DIR, { recursive: true })
  await writeFile(join(MERLIN_SCREENSHOT_PUBLIC_DIR, fileName), buffer)

  return {
    viewId: safeViewId,
    base64,
    format,
    url: `/merlin/screenshots/${fileName}`,
    filePath: join(MERLIN_SCREENSHOT_PUBLIC_DIR, fileName),
  }
}

async function persistScreenshotCaptures(captures: PendingCapture[], requestId?: string) {
  const persisted = await Promise.all(
    captures.map(async (capture, index) => {
      try {
        return await persistScreenshotCapture(capture, requestId || 'shot', index)
      } catch (error) {
        console.warn('[OasisTools] Failed to persist screenshot capture:', error)
        return capture.base64
          ? {
              viewId: typeof capture.viewId === 'string' ? capture.viewId : `view-${index + 1}`,
              base64: capture.base64,
              format: capture.format === 'png' || capture.format === 'webp' || capture.format === 'jpeg' ? capture.format : 'jpeg',
            }
          : null
      }
    }),
  )

  await pruneScreenshotDir(MERLIN_SCREENSHOT_PUBLIC_DIR).catch(() => {})

  return persisted.filter((capture): capture is NonNullable<typeof capture> => !!capture)
}

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
    screenshotRequest: getPendingScreenshotRequest(),
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
    screenshotCaptures?: Array<{ viewId?: string; base64?: string; format?: 'jpeg' | 'png' | 'webp' }>
    requestId?: string
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  // Screenshot delivery endpoint
  if (body.screenshotData) {
    const persisted = await persistScreenshotCaptures([{
      viewId: 'view-1',
      base64: body.screenshotData,
      format: 'jpeg',
    }], body.requestId)
    const delivered = deliverScreenshot(persisted, body.requestId)
    return NextResponse.json({ ok: delivered, message: delivered ? 'Screenshot delivered.' : 'No pending screenshot request.' })
  }
  if (Array.isArray(body.screenshotCaptures)) {
    const captures = body.screenshotCaptures
      .filter(capture => typeof capture?.base64 === 'string' && capture.base64.trim().length > 0)
      .map(capture => ({
        viewId: typeof capture.viewId === 'string' ? capture.viewId : 'view-1',
        base64: capture.base64!.trim(),
        format: capture.format === 'png' || capture.format === 'webp' || capture.format === 'jpeg' ? capture.format : 'jpeg',
      }))
    const persistedCaptures = await persistScreenshotCaptures(captures, body.requestId)
    const delivered = deliverScreenshot(persistedCaptures, body.requestId)
    return NextResponse.json({ ok: delivered, message: delivered ? 'Screenshot captures delivered.' : 'No pending screenshot request.' })
  }

  const toolName = typeof body.tool === 'string' ? body.tool.trim() : ''
  if (!toolName) {
    return NextResponse.json({ error: 'tool name is required. Available: ' + TOOL_NAMES.join(', ') }, { status: 400 })
  }

  const args = body.args && typeof body.args === 'object' ? body.args : {}
  const result = await callTool(toolName, args)

  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
