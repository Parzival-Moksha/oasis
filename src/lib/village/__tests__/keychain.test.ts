import { describe, expect, it } from 'vitest'

import {
  KEY_RULES,
  buildKeychain,
  findKey,
  formatEnvValue,
  keyEnvNames,
  keyState,
  parseEnvNames,
  setEnvValue,
  skillOpen,
  type KeychainFacts,
} from '../keychain'
import { normalizeAcademyContent, type AcademyContent } from '../village-academy'

const SECRET = 'sk-SECRET-SENTINEL-9f3a'

const skill = (id: string, keys: string[], order = 0) => ({ id, name: id.toUpperCase(), tier: 1, lane: 'core', needs: [], order, xp: 10, what: '', prompt: '', proof: '', mins: 5, keys, way: null })
const key = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, name: id, kind, cost: '', link: 'https://example.com', ...extra })
const content = normalizeAcademyContent(
  [skill('a', ['openai', 'anthropic'], 1), skill('b', ['claude'], 2), skill('c', [], 3), skill('d', ['card'], 4), skill('e', ['openai'], 5)],
  { keys: [key('openai', 'api'), key('anthropic', 'api'), key('claude', 'subscription'), key('card', 'account'), key('pi', 'hardware'), key('vercel', 'account'), key('custom', 'api', { env: ['CUSTOM_API_KEY', 'bad name'] })] },
  'folder',
) as AcademyContent

const empty: KeychainFacts = {
  envFiles: [],
  environment: [],
  logins: { claude: { loggedIn: false, method: '', plan: '' }, codex: null, gh: null },
  plugins: [],
  marks: {},
}
const facts = (patch: Partial<KeychainFacts>): KeychainFacts => ({ ...empty, ...patch, logins: { ...empty.logins, ...(patch.logins || {}) } })
const keyOf = (id: string) => content.keys.find(item => item.id === id)!

describe('.env parsing keeps names and nothing else', () => {
  const text = [
    '# OPENAI_API_KEY=commented-out',
    `OPENAI_API_KEY=${SECRET}`,
    'export GROQ_API_KEY="quoted value" # trailing',
    'EMPTY_ONE=',
    "BLANK_QUOTES=''",
    '  SPACED = padded  ',
    'not an assignment',
    'lower_case=1',
    '',
  ].join('\r\n')

  it('lists the names that are assigned, and whether each has a value', () => {
    expect(parseEnvNames(text)).toEqual([
      { name: 'OPENAI_API_KEY', filled: true },
      { name: 'GROQ_API_KEY', filled: true },
      { name: 'EMPTY_ONE', filled: false },
      { name: 'BLANK_QUOTES', filled: false },
      { name: 'SPACED', filled: true },
      { name: 'lower_case', filled: true },
    ])
  })

  it('returns no value, whatever the line looks like', () => {
    expect(JSON.stringify(parseEnvNames(text))).not.toContain(SECRET)
    expect(JSON.stringify(parseEnvNames(text))).not.toContain('quoted value')
    expect(parseEnvNames('\uFEFFA_KEY=1')).toEqual([{ name: 'A_KEY', filled: true }])
  })
})

describe('writing a value into a .env line', () => {
  it('bare when plain, quoted when it has spaces or #, refused when it cannot be written safely', () => {
    expect(formatEnvValue('sk-abc_123.XYZ')).toBe('sk-abc_123.XYZ')
    expect(formatEnvValue('has space #hash')).toBe("'has space #hash'")
    expect(formatEnvValue("it's #1")).toBe('"it\'s #1"')
    expect(formatEnvValue("it's $x")).toBeNull()
    expect(formatEnvValue('two\nlines')).toBeNull()
    expect(formatEnvValue('')).toBeNull()
    expect(formatEnvValue('x'.repeat(4001))).toBeNull()
  })

  it('replaces the variable in place, keeps every other line and the line endings', () => {
    const before = 'A=1\r\n# KEY=old\r\nKEY=old\r\nB=2\r\n'
    expect(setEnvValue(before, 'KEY', 'new')).toBe('A=1\r\n# KEY=old\r\nKEY=new\r\nB=2\r\n')
  })

  it('adds the variable at the end, with a line break first when the file lacks one', () => {
    expect(setEnvValue('A=1', 'KEY', 'v')).toBe('A=1\nKEY=v\n')
    expect(setEnvValue('A=1\n', 'KEY', 'v')).toBe('A=1\nKEY=v\n')
    expect(setEnvValue('', 'KEY', 'v')).toBe('KEY=v\n')
    expect(setEnvValue('KEY_TWO=1\n', 'KEY', 'v')).toBe('KEY_TWO=1\nKEY=v\n')
  })
})

describe('is a key held?', () => {
  it('finds an API key by its variable name in a file, reporting the file and the name', () => {
    const found = findKey(keyOf('openai'), facts({ envFiles: [{ file: 'C:\\af_oasis\\.env', names: [{ name: 'OPENAI_API_KEY', filled: true }] }] }))
    expect(found).toEqual([{ source: 'env-file', label: 'OPENAI_API_KEY in af_oasis/.env', file: 'C:\\af_oasis\\.env', name: 'OPENAI_API_KEY' }])
  })

  it('an empty "KEY=" is not a key; a name that belongs to another key is not this one', () => {
    const f = facts({ envFiles: [{ file: '/x/.env', names: [{ name: 'OPENAI_API_KEY', filled: false }, { name: 'ANTHROPIC_API_KEY', filled: true }] }] })
    expect(findKey(keyOf('openai'), f)).toEqual([])
    expect(findKey(keyOf('anthropic'), f)).toHaveLength(1)
  })

  it('the environment counts only where no file already shows the name', () => {
    const file = { file: '/x/.env', names: [{ name: 'OPENAI_API_KEY', filled: true }] }
    expect(findKey(keyOf('openai'), facts({ envFiles: [file], environment: ['OPENAI_API_KEY'] }))).toHaveLength(1)
    expect(findKey(keyOf('openai'), facts({ environment: ['OPENAI_API_KEY'] }))).toEqual([{ source: 'environment', label: 'OPENAI_API_KEY in the environment', name: 'OPENAI_API_KEY' }])
  })

  it('a Claude login is a subscription login, not an API key: only claude.ai counts', () => {
    const login = (method: string) => facts({ logins: { claude: { loggedIn: true, method, plan: 'max' }, codex: null, gh: null } })
    expect(findKey(keyOf('claude'), login('claude.ai'))).toEqual([{ source: 'login', label: 'Claude CLI login (claude.ai, max)' }])
    expect(findKey(keyOf('claude'), login('api_key'))).toEqual([])
    // ...and a Claude login does not make the Anthropic API key held.
    expect(findKey(keyOf('anthropic'), login('claude.ai'))).toEqual([])
  })

  it('a plugin and a mark count', () => {
    expect(findKey(keyOf('vercel'), facts({ plugins: ['vercel'] }))[0]).toMatchObject({ source: 'plugin', label: 'Claude plugin: vercel' })
    expect(findKey(keyOf('card'), facts({ marks: { card: { at: 1 } } }))).toEqual([{ source: 'marked', label: 'marked as held by you' }])
  })

  it('have / missing / unknown', () => {
    const f = empty
    expect(keyState(keyOf('openai'), [], f)).toBe('missing')
    expect(keyState(keyOf('claude'), [], f)).toBe('missing')
    expect(keyState(keyOf('claude'), [], facts({ logins: { claude: null, codex: null, gh: null } }))).toBe('unknown')
    expect(keyState(keyOf('card'), [], f)).toBe('unknown')
    expect(keyState(keyOf('pi'), [], f)).toBe('unknown')
    expect(keyState(keyOf('openai'), [{ source: 'marked', label: '' }], f)).toBe('have')
  })

  it('the content may add variable names, valid ones only', () => {
    expect(keyEnvNames(keyOf('custom'))).toEqual(['CUSTOM_API_KEY'])
    expect(keyEnvNames(keyOf('openai'))).toEqual(KEY_RULES.openai.env)
  })
})

describe('which skills a key opens', () => {
  const held = facts({ envFiles: [{ file: '/x/.env', names: [{ name: 'ANTHROPIC_API_KEY', filled: true }] }] })
  const view = buildKeychain(content.keys, content.skills, held)
  const by = (id: string) => view.find(item => item.id === id)!

  it('a skill is open without keys, or with any one key it lists', () => {
    expect(skillOpen({ keys: [] }, new Set())).toBe(true)
    expect(skillOpen({ keys: ['x', 'y'] }, new Set(['y']))).toBe(true)
    expect(skillOpen({ keys: ['x', 'y'] }, new Set(['z']))).toBe(false)
  })

  it('lists the skills that name the key, with whether each is open now', () => {
    expect(by('openai').skills).toEqual([{ id: 'a', name: 'A', open: true }, { id: 'e', name: 'E', open: false }])
    expect(by('claude').skills).toEqual([{ id: 'b', name: 'B', open: false }])
    expect(by('pi').skills).toEqual([])
  })

  it('says what can be stored where, and what can be marked', () => {
    expect(by('openai')).toMatchObject({ state: 'missing', envNames: ['OPENAI_API_KEY'], canMark: false })
    expect(by('anthropic')).toMatchObject({ state: 'have', canMark: false })
    expect(by('claude')).toMatchObject({ envNames: [], canMark: true })
    expect(by('card')).toMatchObject({ state: 'unknown', canMark: true, marked: false })
  })
})
