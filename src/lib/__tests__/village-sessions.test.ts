import { describe, expect, it } from 'vitest'
import { filterSessions, normalizeCwd, pickSuggestions } from '../village/village-sessions'
import type { EngineSessionMeta } from '../agent-engine-types'

function session(id: string, patch: Partial<EngineSessionMeta> = {}): EngineSessionMeta {
  return {
    sessionId: `${id}-0000-4000-8000-000000000000`,
    path: `C:/Users/x/.claude/projects/p/${id}.jsonl`,
    cwd: 'C:\\work',
    title: id,
    size: 1000,
    mtime: 0,
    live: null,
    ownedBy: null,
    observedBy: null,
    ...patch,
  }
}

describe('village session helpers', () => {
  it('normalizes Windows folders for comparison', () => {
    expect(normalizeCwd('C:/7c_oasis/')).toBe('c:\\7c_oasis')
    expect(normalizeCwd('C:\\7c_oasis')).toBe('c:\\7c_oasis')
    expect(normalizeCwd(null)).toBe('')
  })

  it('filters on every term across title, folder, prompts and branch', () => {
    const sessions = [
      session('a', { title: 'Fix the login bug', cwd: 'C:\\7p_nocrastination', gitBranch: 'main' }),
      session('b', { title: 'Clip the podcast', cwd: 'C:\\cb_video\\claude', firstPrompt: 'cut the moonshots episode' }),
      session('c', { title: 'Disk cleanup', cwd: 'C:\\7m_sysadmin' }),
    ]
    expect(filterSessions(sessions, '').map(s => s.title)).toHaveLength(3)
    expect(filterSessions(sessions, 'moonshots').map(s => s.title)).toEqual(['Clip the podcast'])
    expect(filterSessions(sessions, 'nocrastination login').map(s => s.title)).toEqual(['Fix the login bug'])
    expect(filterSessions(sessions, 'sysadmin podcast')).toEqual([])
  })

  it('suggests Anorak Pro from its folder plus the five newest sessions', () => {
    const sessions = [
      session('old7c', { cwd: 'C:/7c_oasis', mtime: 10 }),
      session('new7c', { cwd: 'C:\\7c_oasis', mtime: 50 }),
      ...Array.from({ length: 6 }, (_, i) => session(`s${i}`, { mtime: 100 + i })),
    ]
    const { anorak, recent } = pickSuggestions(sessions, 'C:\\7c_oasis')
    expect(anorak?.title).toBe('new7c')
    expect(recent.map(s => s.title)).toEqual(['s5', 's4', 's3', 's2', 's1'])
    expect(pickSuggestions([session('x')], 'C:\\nowhere').anorak).toBeNull()
  })
})
