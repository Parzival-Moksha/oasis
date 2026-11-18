// The local key: what the page server and the agent engine let through when the Oasis runs with one.
import { describe, expect, it } from 'vitest'

import { localGate, localToken, sameToken, withLocalToken, type LocalGateRequest } from '../local-token'
import * as tokenModule from '../../../packages/oasis-agent-engine/src/token.js'

const { tokenAllowed, tokenOf } = tokenModule as unknown as {
  tokenAllowed: (req: { headers: Record<string, string> }, url: URL | undefined, required: string) => boolean
  tokenOf: (req: { headers: Record<string, string> }, url?: URL) => string
}

const KEY = 'k'.repeat(43)
const request = (patch: Partial<LocalGateRequest> = {}): LocalGateRequest => ({
  host: 'localhost:4516', origin: null, secFetchSite: null, pathname: '/api/village/missions', key: null, cookieToken: null, headerToken: null, ...patch,
})

describe('the page server with a local key', () => {
  it('asks for nothing when it was started without one', () => {
    expect(localGate(request({ host: 'example.com' }), '')).toEqual({ action: 'pass' })
  })
  it('lets pages load, and turns the key in the address into a cookie', () => {
    expect(localGate(request({ pathname: '/' }), KEY)).toEqual({ action: 'pass' })
    expect(localGate(request({ pathname: '/', key: KEY }), KEY)).toEqual({ action: 'set-cookie' })
    expect(localGate(request({ pathname: '/', key: 'wrong' }), KEY)).toEqual({ action: 'pass' })
  })
  it('refuses /api without the key, takes it from the cookie or a header', () => {
    expect(localGate(request(), KEY)).toMatchObject({ action: 'deny', status: 401 })
    expect(localGate(request({ cookieToken: 'x'.repeat(43) }), KEY)).toMatchObject({ action: 'deny', status: 401 })
    expect(localGate(request({ cookieToken: KEY }), KEY)).toEqual({ action: 'pass' })
    expect(localGate(request({ headerToken: KEY }), KEY)).toEqual({ action: 'pass' })
  })
  it('refuses other machines, other sites and other local ports even with the key', () => {
    expect(localGate(request({ host: '192.168.1.5:4516', cookieToken: KEY }), KEY)).toMatchObject({ action: 'deny', status: 403 })
    expect(localGate(request({ host: 'evil.example:4516', cookieToken: KEY }), KEY)).toMatchObject({ action: 'deny', status: 403 })
    expect(localGate(request({ secFetchSite: 'cross-site', cookieToken: KEY }), KEY)).toMatchObject({ action: 'deny', status: 403 })
    expect(localGate(request({ origin: 'http://localhost:3000', cookieToken: KEY }), KEY)).toMatchObject({ action: 'deny', status: 403 })
    expect(localGate(request({ origin: 'https://evil.example', cookieToken: KEY }), KEY)).toMatchObject({ action: 'deny', status: 403 })
    expect(localGate(request({ origin: 'http://localhost:4516', cookieToken: KEY }), KEY)).toEqual({ action: 'pass' })
  })
})

describe('the key in the browser', () => {
  it('is read from the cookie and added to links to the engine', () => {
    expect(localToken(`a=1; oasis_token=${KEY}; b=2`)).toBe(KEY)
    expect(localToken('a=1')).toBe('')
    expect(withLocalToken('ws://127.0.0.1:4530/ws', KEY)).toBe(`ws://127.0.0.1:4530/ws?token=${KEY}`)
    expect(withLocalToken('ws://127.0.0.1:4530/listen?lang=en', KEY)).toBe(`ws://127.0.0.1:4530/listen?lang=en&token=${KEY}`)
    expect(withLocalToken('ws://127.0.0.1:4530/ws', '')).toBe('ws://127.0.0.1:4530/ws')
  })
  it('compares without leaking where two keys differ', () => {
    expect(sameToken(KEY, KEY)).toBe(true)
    expect(sameToken(KEY, `${KEY}x`)).toBe(false)
    expect(sameToken('', '')).toBe(false)
  })
})

describe('the agent engine with a local key', () => {
  const url = (search = '') => new URL(`http://127.0.0.1:4530/api/cmd${search}`)
  it('asks for nothing without one', () => {
    expect(tokenAllowed({ headers: {} }, url(), '')).toBe(true)
  })
  it('takes the key from a header or the address, and refuses anything else', () => {
    expect(tokenAllowed({ headers: {} }, url(), KEY)).toBe(false)
    expect(tokenAllowed({ headers: { 'x-oasis-token': KEY } }, url(), KEY)).toBe(true)
    expect(tokenAllowed({ headers: { authorization: `Bearer ${KEY}` } }, url(), KEY)).toBe(true)
    expect(tokenAllowed({ headers: {} }, url(`?token=${KEY}`), KEY)).toBe(true)
    expect(tokenAllowed({ headers: { 'x-oasis-token': 'nope' } }, url(), KEY)).toBe(false)
    expect(tokenOf({ headers: { authorization: 'Bearer abc' } })).toBe('abc')
  })
})
