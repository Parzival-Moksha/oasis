// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { keychainAction, keychainSnapshot, type KeychainPaths, type RunCommand } from '../keychain-server'

const A = 'sk-SECRET-SENTINEL-AAAA1111'
const B = 'gsk-SECRET-SENTINEL-BBBB2222'
const C = 'sk-SECRET-SENTINEL-CCCC3333'
const D = 'sk-SECRET-SENTINEL-DDDD4444'
const EMAIL = 'someone.private@example.test'
const ORG = '18547eca-0000-4000-8000-secretorgid'
const ALL_SECRETS = [A, B, C, D, EMAIL, ORG]

let dir: string
let paths: KeychainPaths
let output: string[]
const spies: Array<ReturnType<typeof vi.spyOn>> = []

const claudeJson = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: EMAIL, orgId: ORG, orgName: `${EMAIL}'s Organization`, subscriptionType: 'max' })
const run: RunCommand = async (command, args) => {
  if (args.includes('auth') && args.includes('status') && command !== 'gh') return { code: 0, stdout: claudeJson }
  if (/codex/.test(command + args.join(" "))) return { code: 0, stdout: 'Logged in using ChatGPT\n' }
  return null // gh is not installed
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'keychain-test-'))
  const root = path.join(dir, 'oasis')
  const agent = path.join(dir, 'agent-folder')
  const academy = path.join(dir, 'academy')
  for (const folder of [root, agent, academy, path.join(root, 'data')]) mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(root, '.env'), `DATABASE_URL="file:./x.db"\nOPENAI_API_KEY=${A}\nANTHROPIC_API_KEY=\n`)
  writeFileSync(path.join(agent, '.env'), `GROQ_API_KEY="${B}" # mine\r\n`)
  writeFileSync(path.join(root, 'data', 'agent-engine.local.json'), JSON.stringify({ v: 1, agents: [{ name: 'Rick', cwd: agent }, { name: 'Bad', cwd: 'relative/path' }] }))
  writeFileSync(path.join(academy, 'skills.json'), JSON.stringify([
    { id: 'spirit', name: 'Spirit', tier: 0, lane: 'core', order: 1, xp: 10, keys: ['claude', 'openai'], needs: [] },
    { id: 'voice', name: 'Voice in', tier: 1, lane: 'ears', order: 2, xp: 20, keys: ['groq', 'elevenlabs'], needs: [] },
    { id: 'site', name: 'Website', tier: 1, lane: 'builder', order: 3, xp: 20, keys: ['vercel'], needs: [] },
  ]))
  writeFileSync(path.join(academy, 'keys.json'), JSON.stringify({ keys: [
    { id: 'claude', name: 'Claude Pro or Max', kind: 'subscription', cost: '$20', link: 'https://claude.com/pricing' },
    { id: 'chatgpt', name: 'ChatGPT or Codex', kind: 'subscription', cost: '$20', link: 'https://chatgpt.com' },
    { id: 'openai', name: 'OpenAI API', kind: 'api', cost: 'per use', link: 'https://platform.openai.com' },
    { id: 'groq', name: 'Groq', kind: 'api', cost: 'free tier', link: 'https://console.groq.com' },
    { id: 'elevenlabs', name: 'ElevenLabs', kind: 'api', cost: 'per use', link: 'https://elevenlabs.io' },
    { id: 'vercel', name: 'Vercel', kind: 'account', cost: 'free', link: 'https://vercel.com' },
    { id: 'pi', name: 'A Raspberry Pi', kind: 'hardware', cost: '€80', link: '' },
  ] }))
  process.env.OASIS_ACADEMY_DIR = academy
  paths = { root, home: path.join(dir, 'home'), state: path.join(root, 'data', 'keychain.local.json'), roster: path.join(root, 'data', 'agent-engine.local.json') }
  output = []
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { output.push(args.map(String).join(' ')) }))
  }
})

afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore()
  delete process.env.OASIS_ACADEMY_DIR
  delete process.env.OASIS_KEYCHAIN_STATE
  rmSync(dir, { recursive: true, force: true })
})

const options = () => ({ paths, run, env: {} as NodeJS.ProcessEnv })
const noSecret = (text: string, what: string) => { for (const secret of ALL_SECRETS) expect(text, `${what} holds ${secret}`).not.toContain(secret) }

describe('the scan', () => {
  it('finds keys by name in the Oasis .env and in an agent folder, and the logins, without a value in the result', async () => {
    const snapshot = await keychainSnapshot(options())
    const by = (id: string) => snapshot.keys.find(key => key.id === id)!
    expect(by('openai')).toMatchObject({ state: 'have' })
    expect(by('openai').found).toEqual([expect.objectContaining({ source: 'env-file', name: 'OPENAI_API_KEY', file: path.join(paths.root, '.env') })])
    expect(by('groq').found).toEqual([expect.objectContaining({ source: 'env-file', name: 'GROQ_API_KEY' })])
    expect(by('elevenlabs')).toMatchObject({ state: 'missing' })
    expect(by('claude')).toMatchObject({ state: 'have', found: [{ source: 'login', label: 'Claude CLI login (claude.ai, max)' }] })
    expect(by('chatgpt')).toMatchObject({ state: 'have' })
    expect(by('vercel')).toMatchObject({ state: 'missing' })
    expect(by('pi')).toMatchObject({ state: 'unknown' })
    expect(snapshot.sources).toMatchObject({ envFiles: 2, claudeLogin: 'logged in (claude.ai, max)', ghLogin: 'not found' })
    noSecret(JSON.stringify(snapshot), 'the snapshot')
  })

  it('tells what each key opens: a key that is the only one a skill lists blocks it while missing', async () => {
    const snapshot = await keychainSnapshot(options())
    const by = (id: string) => snapshot.keys.find(key => key.id === id)!
    expect(by('elevenlabs').skills).toEqual([{ id: 'voice', name: 'Voice in', open: true }]) // Groq is held, so the skill is open
    expect(by('vercel').skills).toEqual([{ id: 'site', name: 'Website', open: false }])
  })

  it('a roster folder that is not an absolute path is ignored, and an empty "KEY=" is not a key', async () => {
    const snapshot = await keychainSnapshot(options())
    expect(snapshot.sources.folders).toBe(2)
    expect(snapshot.keys.find(key => key.id === 'openai')!.found).toHaveLength(1)
  })
})

describe('a value never appears in a response, an error or a log', () => {
  it('marking a key and taking the mark back', async () => {
    const marked = await keychainAction({ key: 'vercel', action: 'have' }, options())
    expect(marked).toMatchObject({ ok: true, key: { id: 'vercel', state: 'have', marked: true } })
    expect(JSON.parse(readFileSync(paths.state, 'utf8')).have.vercel.at).toBeGreaterThan(0)
    const gone = await keychainAction({ key: 'vercel', action: 'unmark' }, options())
    expect(gone).toMatchObject({ ok: true, key: { state: 'missing', marked: false } })
  })

  it('an API key is stored, not marked', async () => {
    expect(await keychainAction({ key: 'groq', action: 'have' }, options())).toMatchObject({ ok: false, status: 400 })
    expect(await keychainAction({ key: 'nope', action: 'have' }, options())).toMatchObject({ ok: false, status: 404 })
    // A login or a machine is not pasted.
    expect(await keychainAction({ key: 'claude', action: 'store', value: C }, options())).toMatchObject({ ok: false, status: 400 })
    expect(await keychainAction({ key: 'pi', action: 'store', value: C }, options())).toMatchObject({ ok: false, status: 400 })
  })

  it('storing writes the Oasis .env and nothing else, and the answer has no value', async () => {
    const result = await keychainAction({ key: 'elevenlabs', action: 'store', value: C }, options())
    expect(result).toMatchObject({ ok: true, key: { id: 'elevenlabs', state: 'have' } })
    noSecret(JSON.stringify(result), 'the store answer')
    const env = readFileSync(path.join(paths.root, '.env'), 'utf8')
    expect(env).toContain(`ELEVENLABS_API_KEY=${C}`)
    expect(env).toContain(`OPENAI_API_KEY=${A}`) // the other lines are untouched
    // The keychain's own file holds marks, never values.
    if (existsSync(paths.state)) noSecret(readFileSync(paths.state, 'utf8'), 'the marks file')
    // The agent's folder was not written to.
    expect(readFileSync(path.join(dir, 'agent-folder', '.env'), 'utf8')).toBe(`GROQ_API_KEY="${B}" # mine\r\n`)
    // And a fresh look reports it by name only.
    const after = await keychainSnapshot(options())
    expect(after.keys.find(key => key.id === 'elevenlabs')!.found).toEqual([expect.objectContaining({ name: 'ELEVENLABS_API_KEY' })])
    noSecret(JSON.stringify(after), 'the snapshot after storing')
  })

  it('refused values and names fail without echoing the value', async () => {
    const results = [
      await keychainAction({ key: 'elevenlabs', action: 'store', value: `${D}\nINJECTED=1` }, options()),
      await keychainAction({ key: 'elevenlabs', action: 'store', value: '' }, options()),
      await keychainAction({ key: 'elevenlabs', action: 'store', value: D, name: 'PATH' }, options()),
      await keychainAction({ key: 'elevenlabs', action: 'store', value: D, name: 'GROQ_API_KEY' }, options()),
    ]
    for (const result of results) expect(result).toMatchObject({ ok: false, status: 400 })
    noSecret(JSON.stringify(results), 'the errors')
    expect(readFileSync(path.join(paths.root, '.env'), 'utf8')).not.toContain('INJECTED')
    expect(readFileSync(path.join(paths.root, '.env'), 'utf8')).not.toContain(D)
  })

  it('a name already in .env.local (which wins over .env) is changed there, and every copy of it', async () => {
    writeFileSync(path.join(paths.root, '.env.local'), `ELEVENLABS_API_KEY=old\r\nX=1\r\nexport ELEVENLABS_API_KEY=older\r\n`)
    const result = await keychainAction({ key: 'elevenlabs', action: 'store', value: C }, options())
    expect(result).toMatchObject({ ok: true, file: '.env.local' })
    expect(readFileSync(path.join(paths.root, '.env.local'), 'utf8')).toBe(`ELEVENLABS_API_KEY=${C}\r\nX=1\r\nexport ELEVENLABS_API_KEY=${C}\r\n`)
    expect(readFileSync(path.join(paths.root, '.env'), 'utf8')).not.toContain('ELEVENLABS')
    noSecret(JSON.stringify(result), 'the answer')
  })

  it('warns when the same name is set outside the files (the system environment wins), without a value', async () => {
    const result = await keychainAction({ key: 'elevenlabs', action: 'store', value: C }, { paths, run, env: { ELEVENLABS_API_KEY: D } as unknown as NodeJS.ProcessEnv })
    expect(result).toMatchObject({ ok: true, file: '.env', warning: expect.stringContaining('ELEVENLABS_API_KEY is also set outside') })
    noSecret(JSON.stringify(result), 'the warning')
  })

  it('an old mark on an API key does not make it held, and can still be taken back', async () => {
    writeFileSync(paths.state, JSON.stringify({ v: 1, have: { elevenlabs: { at: 1 } } }))
    const before = await keychainSnapshot(options())
    expect(before.keys.find(key => key.id === 'elevenlabs')).toMatchObject({ state: 'missing', marked: true })
    expect(await keychainAction({ key: 'elevenlabs', action: 'unmark' }, options())).toMatchObject({ ok: true, key: { marked: false } })
  })

  it('a network folder in the roster is not scanned', async () => {
    writeFileSync(paths.roster, JSON.stringify({ v: 1, agents: [{ cwd: '\\\\offline-server\\share\\agent' }, { cwd: '//offline/share' }] }))
    const snapshot = await keychainSnapshot(options())
    expect(snapshot.sources.folders).toBe(1)
  })

  it('a damaged marks file is an error, not an empty keychain written over it', async () => {
    writeFileSync(paths.state, '{ not json ' + C)
    const result = await keychainAction({ key: 'vercel', action: 'have' }, options())
    expect(result).toMatchObject({ ok: false, status: 500 })
    noSecret(JSON.stringify(result), 'the error')
    expect(readFileSync(paths.state, 'utf8')).toContain('not json')
  })

  it('nothing was logged', async () => {
    await keychainSnapshot(options())
    await keychainAction({ key: 'elevenlabs', action: 'store', value: C }, options())
    await keychainAction({ key: 'elevenlabs', action: 'store', value: `${D}\n` + 'x' }, options())
    noSecret(output.join('\n'), 'the console')
  })
})

describe('the route', () => {
  const request = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
    new NextRequest('http://127.0.0.1:4516/api/academy/keychain', {
      method,
      headers: { host: '127.0.0.1:4516', 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    })

  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue(paths.root)
    process.env.OASIS_KEYCHAIN_STATE = paths.state
  })
  afterEach(() => {
    vi.mocked(process.cwd).mockRestore()
    delete process.env.ELEVENLABS_API_KEY
  })

  it('answers the page on this machine and nobody else', async () => {
    const { GET, POST } = await import('../../app/api/academy/keychain/route')
    expect((await GET(request('GET'))).status).toBe(200)
    expect((await GET(request('GET', undefined, { host: 'evil.example' }))).status).toBe(403)
    expect((await POST(request('POST', { key: 'vercel', action: 'have' }, { origin: 'http://evil.example' }))).status).toBe(403)
  })

  it('stores through POST and never sends the value back, not even when the body is broken', async () => {
    const { POST } = await import('../../app/api/academy/keychain/route')
    const stored = await POST(request('POST', { key: 'elevenlabs', action: 'store', value: C }))
    const storedText = await stored.text()
    expect(stored.status).toBe(200)
    expect(storedText).not.toContain(C)
    expect(readFileSync(path.join(paths.root, '.env'), 'utf8')).toContain(`ELEVENLABS_API_KEY=${C}`)
    // Not put into this server's environment by hand: every Claude CLI the Oasis starts inherits that.
    expect(process.env.ELEVENLABS_API_KEY).toBeUndefined()
    const broken = await POST(request('POST', `{"key":"elevenlabs","action":"store","value":"${D}`))
    const brokenText = await broken.text()
    expect(broken.status).toBe(400)
    expect(brokenText).not.toContain(D)
    const huge = await POST(request('POST', JSON.stringify({ key: 'elevenlabs', action: 'store', value: D + 'x'.repeat(30_000) })))
    expect(huge.status).toBe(413)
    expect(await huge.text()).not.toContain(D)
    expect((await POST(request('POST', { key: 'elevenlabs', action: 'wipe' }))).status).toBe(400)
    noSecret(output.join('\n'), 'the console')
  })

  it('GET reports what was found without a value', async () => {
    const { GET } = await import('../../app/api/academy/keychain/route')
    const text = await (await GET(request('GET'))).text()
    expect(text).toContain('OPENAI_API_KEY')
    noSecret(text, 'the GET answer')
  })
})

describe('codex status', () => {
  it('reads "Logged in using ChatGPT" from either stream, and only with exit code 0', async () => {
    const { codexStatus } = await import('../keychain-server')
    expect(codexStatus('\nLogged in using ChatGPT\n', 0)).toEqual({ loggedIn: true, method: 'chatgpt' })
    expect(codexStatus('Logged in using an API key - sk-***', 0)).toEqual({ loggedIn: true, method: 'api-key' })
    expect(codexStatus('Not logged in', 1)).toEqual({ loggedIn: false, method: '' })
  })
})

describe('the Claude CLI environment', () => {
  it('never carries an Anthropic API key or token into a Claude process the Oasis starts', async () => {
    const { buildClaudeCliEnv } = await import('../claude-cli-env')
    const before = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN, keep: process.env.OASIS_KEEP_API_KEY }
    try {
      process.env.ANTHROPIC_API_KEY = A
      process.env.ANTHROPIC_AUTH_TOKEN = B
      delete process.env.OASIS_KEEP_API_KEY
      const env = buildClaudeCliEnv()
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
      // The owner's escape hatch, as in the agent engine.
      process.env.OASIS_KEEP_API_KEY = '1'
      expect(buildClaudeCliEnv().ANTHROPIC_API_KEY).toBe(A)
    } finally {
      for (const [name, value] of [['ANTHROPIC_API_KEY', before.key], ['ANTHROPIC_AUTH_TOKEN', before.token], ['OASIS_KEEP_API_KEY', before.keep]] as const) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })
})

describe('network paths', () => {
  it('are told apart from local ones', async () => {
    const { isNetworkPath } = await import('../keychain-server')
    expect(isNetworkPath(String.raw`\\server\share`)).toBe(true)
    expect(isNetworkPath('//server/share')).toBe(true)
    expect(isNetworkPath(String.raw`C:\af_oasis`)).toBe(false)
    expect(isNetworkPath('/home/me')).toBe(false)
  })
})
