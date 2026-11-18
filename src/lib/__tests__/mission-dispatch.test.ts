import { describe, expect, it } from 'vitest'
import { findMissionAgent, formatMissionNote, isNamedIn, missionForAgent } from '../village/mission-dispatch'

const agent = (name: string, patch: Partial<{ owned: boolean; alive: boolean }> = {}) => ({ id: name.toLowerCase(), name, owned: true, alive: true, ...patch })

describe('who gets a note left on a mission card', () => {
  it('the mission agent when it is in the village, whatever its desk says', () => {
    expect(findMissionAgent([agent('Anorak'), agent('Mission Wall')], 'Anorak Pro')).toMatchObject({ agent: { id: 'mission wall' }, as: 'master' })
    expect(findMissionAgent([agent('Anorak'), agent('Morrow')], 'owner')?.agent.name).toBe('Morrow')
  })
  it('else an agent the mission names; a live one wins; observed agents never', () => {
    expect(findMissionAgent([agent('Debugger'), agent('Anorak')], 'owner + Anorak Pro')).toMatchObject({ agent: { id: 'anorak' }, as: 'named' })
    expect(findMissionAgent([agent('Morrow', { alive: false }), agent('Morrow 2')], 'x')?.agent.name).toBe('Morrow 2')
    expect(findMissionAgent([agent('Morrow', { owned: false }), agent('Rick', { owned: false })], 'Rick')).toBeNull()
    expect(findMissionAgent([agent('Debugger')], 'Anorak Pro')).toBeNull()
  })
  it('names match as whole words, any case', () => {
    expect(isNamedIn('owner + Anorak Pro', 'anorak')).toBe(true)
    expect(isNamedIn('Debugger (a village agent in C:\\af_oasis)', 'Debugger')).toBe(true)
    expect(isNamedIn('Rickshaw', 'Rick')).toBe(false)
    expect(isNamedIn('anything', '')).toBe(false)
    expect(isNamedIn('C++ (dev)', 'C++')).toBe(true)
  })
  it('the message says which mission, where its file is, and what to do', () => {
    const text = formatMissionNote({ file: 'work-vow.md', title: 'The work vow', who: 'Morrow', text: '  make the timer bigger ', dir: 'C:\7c_oasis\docs\missions\', villageAgents: ['Anorak', 'Debugger'] })
    // The folder is the machine's own: a forward-slash one keeps its slashes, none leaves the file's name.
    expect(formatMissionNote({ file: 'a.md', title: 'A', who: '', text: 'x', dir: '/home/me/missions' })).toContain('"A" (/home/me/missions/a.md)')
    expect(formatMissionNote({ file: 'a.md', title: 'A', who: '', text: 'x' })).toContain('"A" (a.md)')
    expect(text).toContain('"The work vow" (C:\\7c_oasis\\docs\\missions\\work-vow.md)')
    expect(text).toContain('\nmake the timer bigger\n')
    expect(text).toContain('Agents in the village now: Anorak, Debugger.')
    expect(text).toContain('who has it')
  })
})

describe('the mission an agent\'s minutes count on', () => {
  const missions = [
    { file: 'a.md', who: 'Anorak Pro', column: 'to do', priority: 0.3 },
    { file: 'b.md', who: 'owner + Anorak Pro', column: 'doing', priority: 0.6 },
    { file: 'c.md', who: 'Anorak', column: 'done', priority: 0.9 },
    { file: 'd.md', who: 'Morrow', column: 'doing', priority: null },
  ]
  it('the highest-priority open mission that names it; done ones never; none: null', () => {
    expect(missionForAgent(missions, 'Anorak')?.file).toBe('b.md')
    expect(missionForAgent(missions, 'Morrow')?.file).toBe('d.md')
    expect(missionForAgent(missions, 'Debugger')).toBeNull()
  })
})
