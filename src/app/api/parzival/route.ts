// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PARZIVAL API — SSE proxy to ae_parzival:4517
// Blood-brain barrier: af_oasis ↔ ae_parzival
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'

const PARZIVAL_URL = process.env.PARZIVAL_URL || 'http://localhost:4517'

// ─── POST /api/parzival — Chat with Parzival (SSE proxy) ─────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, mode } = body as { message?: string; mode?: string }

    if (!message) {
      return NextResponse.json({ error: 'message required' }, { status: 400 })
    }

    // Forward to ae_parzival
    const response = await fetch(`${PARZIVAL_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, mode }),
    })

    if (!response.ok) {
      const error = await response.text()
      return NextResponse.json(
        { error: `Parzival error: ${error.substring(0, 500)}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    // Check if Parzival is running
    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')) {
      return NextResponse.json(
        { error: 'Parzival is not running. Start ae_parzival with: cd c:/ae_parzival && pnpm dev' },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ─── GET /api/parzival — Brain state ─────────────────────────────────
export async function GET() {
  try {
    const response = await fetch(`${PARZIVAL_URL}/api/brain`)

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Parzival brain state unavailable' },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')) {
      return NextResponse.json(
        { error: 'offline', mode: 'unknown', hp: 0, maxHp: 100 },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
