// The local key at the page server's door (see src/lib/local-token.ts). Without OASIS_LOCAL_TOKEN in the
// server's environment this does nothing at all: the workshop and the hosted Oasis run as they always did.
import { NextResponse, type NextRequest } from 'next/server'

import { LOCAL_TOKEN_COOKIE, localGate } from '@/lib/local-token'

export const config = {
  // Not the build's own files; everything else, pages and /api alike.
  matcher: ['/((?!_next/static|_next/image).*)'],
}

export function middleware(request: NextRequest) {
  const required = (process.env.OASIS_LOCAL_TOKEN || '').trim()
  if (!required) return NextResponse.next()
  const auth = request.headers.get('authorization') || ''
  const verdict = localGate({
    host: request.headers.get('host'),
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    pathname: request.nextUrl.pathname,
    key: request.nextUrl.searchParams.get('key'),
    cookieToken: request.cookies.get(LOCAL_TOKEN_COOKIE)?.value || null,
    headerToken: request.headers.get('x-oasis-token') || (auth.startsWith('Bearer ') ? auth.slice(7).trim() : null),
  }, required)
  if (verdict.action === 'deny') return NextResponse.json({ error: verdict.error }, { status: verdict.status })
  if (verdict.action === 'set-cookie') {
    // Keep the key out of the address bar and the history: store it, then show the same page without it.
    // Back to the very address that was asked for (localhost and 127.0.0.1 keep separate cookies).
    const clean = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `http://${request.headers.get('host')}`)
    clean.searchParams.delete('key')
    const response = NextResponse.redirect(clean)
    response.cookies.set(LOCAL_TOKEN_COOKIE, required, { sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 365 })
    return response
  }
  return NextResponse.next()
}
