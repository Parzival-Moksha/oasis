import { NextRequest, NextResponse } from 'next/server'

import {
  buildOasisOpenclawMcpDefinition,
  getOpenclawRuntimeConfigPath,
  readOpenclawMcpServer,
  sameMcpDefinition,
  upsertOpenclawMcpServer,
} from '@/lib/openclaw-runtime-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeLoopbackHost(host: string): string {
  if (!host) return host
  if (host === 'localhost') return '127.0.0.1'
  if (host.startsWith('localhost:')) return `127.0.0.1${host.slice('localhost'.length)}`
  return host
}

function resolveRequestBaseUrl(request: NextRequest): string {
  const forwardedProto = sanitizeString(request.headers.get('x-forwarded-proto')).split(',')[0]?.trim()
  const forwardedHost = sanitizeString(request.headers.get('x-forwarded-host')).split(',')[0]?.trim()
  const host = normalizeLoopbackHost(forwardedHost || sanitizeString(request.headers.get('host')))
  const protocol = forwardedProto || (host.startsWith('127.0.0.1') || host.startsWith('[::1]') ? 'http' : 'https')
  return host ? `${protocol}://${host}` : 'http://127.0.0.1:4516'
}

export async function GET(request: NextRequest) {
  const baseUrl = resolveRequestBaseUrl(request)
  const definition = buildOasisOpenclawMcpDefinition(baseUrl)
  const installed = await readOpenclawMcpServer('oasis')
  const command = `openclaw mcp set oasis '${JSON.stringify(definition)}'`

  return NextResponse.json({
    command,
    configPath: getOpenclawRuntimeConfigPath(),
    definition,
    installed: sameMcpDefinition(installed, definition),
  })
}

export async function POST(request: NextRequest) {
  const baseUrl = resolveRequestBaseUrl(request)
  const definition = buildOasisOpenclawMcpDefinition(baseUrl)
  await upsertOpenclawMcpServer('oasis', definition)
  const installed = await readOpenclawMcpServer('oasis')

  return NextResponse.json({
    ok: true,
    configPath: getOpenclawRuntimeConfigPath(),
    definition,
    installed: sameMcpDefinition(installed, definition),
  })
}
