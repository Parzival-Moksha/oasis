import { describe, expect, it } from 'vitest'

import { publicOriginFromRequest } from '../public-origin'

function mockRequest(headers: Record<string, string>, nextUrl = 'http://localhost:4516/ab12') {
  return {
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null
      },
    },
    nextUrl: new URL(nextUrl),
  } as never
}

describe('publicOriginFromRequest', () => {
  it('uses forwarded hosted origin before internal Next URL', () => {
    const request = mockRequest({
      host: '04515.xyz',
      'x-forwarded-proto': 'https',
    })
    expect(publicOriginFromRequest(request)).toBe('https://04515.xyz')
  })

  it('falls back to the request URL for local dev', () => {
    const request = mockRequest({}, 'http://127.0.0.1:4516/admin')
    expect(publicOriginFromRequest(request)).toBe('http://127.0.0.1:4516')
  })
})
