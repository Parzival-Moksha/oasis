import type { NextRequest } from 'next/server'

export function publicOriginFromRequest(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_OASIS_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto = forwardedProto || request.nextUrl.protocol.replace(/:$/, '') || 'https'
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host
  return `${proto}://${host}`
}
