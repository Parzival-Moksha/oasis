// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS LOCAL — Middleware disabled for local-first mode
// No auth required. You are always admin.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'

export function middleware() {
  // Local mode: let everything through
  return NextResponse.next()
}

export const config = {
  matcher: [],
}
