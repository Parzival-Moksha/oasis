// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/health — Lightweight liveness check for crash detection
// Used by dev:agent blue-green builder to know when server is truly alive
// vs zombie (process running, port bound, cache corrupted, returning 500)
// buildId changes on every server restart — used by Phoenix Protocol to
// detect when dev-agent has swapped in a fresh build after merge.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'

// Set once per server lifetime — changes on every restart
const BUILD_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export async function GET() {
  return NextResponse.json({ status: 'ok', timestamp: Date.now(), buildId: BUILD_ID })
}
