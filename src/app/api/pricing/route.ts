// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PRICING — Stub for local-first mode (no credit gating)
// Silences the 404 from usePricing.ts on every page load.
// In SaaS mode this would return real provider costs.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ pricing: {} })
}
