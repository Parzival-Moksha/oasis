// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/viewer/me — Read-or-create the viewer-identity cookie
// ─═̷─═̷─ॐ─═̷─═̷─ Browser bootstrap calls this once on app load ─═̷─═̷─ॐ─═̷─═̷─
//
// GET → { viewerId: string }   (sets the cookie if missing)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { ensureViewerUserId } from '@/lib/viewer-identity'

export const dynamic = 'force-dynamic'

export async function GET() {
  const viewerId = await ensureViewerUserId()
  return NextResponse.json({ viewerId })
}
