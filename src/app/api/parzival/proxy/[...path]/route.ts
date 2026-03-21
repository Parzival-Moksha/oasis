// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PARZIVAL PROXY — generic pass-through to ae_parzival:4517
// Catches /api/parzival/proxy/missions, /api/parzival/proxy/context, etc.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'

const PARZIVAL_URL = process.env.PARZIVAL_URL || 'http://localhost:4517'

async function proxyRequest(
  request: NextRequest,
  method: string,
  params: { path: string[] }
): Promise<NextResponse> {
  const targetPath = `/api/${params.path.join('/')}`
  const targetUrl = `${PARZIVAL_URL}${targetPath}`

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    }

    if (method !== 'GET' && method !== 'HEAD') {
      try {
        const body = await request.json()
        fetchOptions.body = JSON.stringify(body)
      } catch {
        // No body or not JSON — that's fine for some endpoints
      }
    }

    const response = await fetch(targetUrl, fetchOptions)
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')) {
      return NextResponse.json(
        { error: 'Parzival offline. cd c:/ae_parzival && pnpm dev' },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, 'GET', await params)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, 'POST', await params)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, 'PATCH', await params)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, 'DELETE', await params)
}
