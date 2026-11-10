import { describe, expect, it } from 'vitest'
import {
  appendMissionLog,
  guessMatch,
  missionFileName,
  newMissionMarkdown,
  parseMissionLog,
  setMissionHeader,
  splitMissionLog,
} from '../village/village-mission-edit'
import { missionKeyAction, missionPanelScale, parseMission } from '../village/village-missions'

const FILE = `state: doing
who: Morrow
done when: it works.
score: ease 3 · impact 5 · urgency 4
picture: wall.jpg

# Missions in the world

Some text.

## Log
- 2026-11-10. Asked for.
- 2026-11-10. Shipped.
  - **API:** a route.
  - **Wall:** arcs.
`

describe('setMissionHeader', () => {
  it('changes only the named lines and says what changed', () => {
    const { markdown, changes } = setMissionHeader(FILE, { state: 'shipped', impact: 4 })
    expect(changes).toEqual(['state doing → shipped', 'impact 5 → 4'])
    expect(markdown.split('\n').slice(0, 5)).toEqual([
      'state: shipped', 'who: Morrow', 'done when: it works.', 'score: ease 3 · impact 4 · urgency 4', 'picture: wall.jpg',
    ])
    expect(markdown.slice(markdown.indexOf('# Missions'))).toBe(FILE.slice(FILE.indexOf('# Missions')))
    expect(parseMission('a.md', markdown).priority).toBe(0.38)
  })
  it('does nothing when nothing changes', () => {
    expect(setMissionHeader(FILE, { state: 'doing', ease: 3, who: 'Morrow' })).toEqual({ markdown: FILE, changes: [] })
  })
  it('adds a missing line, clamps scores, flattens line breaks', () => {
    const { markdown, changes } = setMissionHeader('state: idea\n\n# A\n', { ease: 9, doneWhen: 'one\ntwo', who: 'owner' })
    expect(markdown).toBe('state: idea\nwho: owner\ndone when: one two\nscore: ease 5 · impact 3 · urgency 3\n\n# A\n')
    expect(changes).toContain('ease – → 5')
  })
  it('gives a file with no header one', () => {
    expect(setMissionHeader('# Loose\n\nwords\n', { state: 'agreed' }).markdown).toBe('state: agreed\n\n# Loose\n\nwords\n')
  })
})

describe('the log', () => {
  it('reads old entries, with their sub-lines', () => {
    const entries = parseMissionLog(FILE)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ date: '2026-11-10', time: '', who: '', text: 'Asked for.' })
    expect(entries[1].text).toBe('Shipped.\n- **API:** a route.\n- **Wall:** arcs.')
  })
  it('appends an entry with a time, an author and a guess', () => {
    const next = appendMissionLog(FILE, { at: '2026-11-10 14:02', who: 'Morrow', text: 'Editing is in.\nTry it.', guess: { who: 'owner', text: 'Nice, make the panels bigger.' } })
    expect(next.endsWith('- 2026-11-10 14:02 · Morrow: Editing is in.\n  Try it.\n  - guess (owner): Nice, make the panels bigger.\n')).toBe(true)
    const last = parseMissionLog(next).pop()
    expect(last).toMatchObject({ date: '2026-11-10', time: '14:02', who: 'Morrow', text: 'Editing is in.\nTry it.', guess: { who: 'owner', text: 'Nice, make the panels bigger.' } })
  })
  it('records how close the guess was when the owner answers, once', () => {
    let text = appendMissionLog(FILE, { at: '2026-11-10 14:02', who: 'Morrow', text: 'Done.', guess: { who: 'owner', text: 'make the panels bigger' } })
    text = appendMissionLog(text, { at: '2026-11-10 14:20', who: 'Owner', text: 'Make the panels much bigger please' })
    text = appendMissionLog(text, { at: '2026-11-10 14:21', who: 'owner', text: 'And add pictures' })
    const entries = parseMissionLog(text)
    expect(entries.at(-2)).toMatchObject({ who: 'Owner', guessMatch: 0.67 })
    expect(entries.at(-1)?.guessMatch).toBeNull()
    expect(entries).toHaveLength(5)
  })
  it('creates the section, and keeps what follows it', () => {
    expect(appendMissionLog('# A\n\nText.\n', { at: '2026-11-10 09:00', who: 'owner', text: 'First.' })).toBe('# A\n\nText.\n\n## Log\n- 2026-11-10 09:00 · owner: First.\n')
    const withTail = appendMissionLog('# A\n\n## Log\n- 2026-11-09. Old.\n\n## Notes\nKeep me.\n', { at: '2026-11-10 09:00', who: 'owner: x', text: 'New.' })
    expect(withTail).toBe('# A\n\n## Log\n- 2026-11-09. Old.\n- 2026-11-10 09:00 · owner  x: New.\n\n## Notes\nKeep me.\n')
    expect(splitMissionLog(withTail).after).toBe('## Notes\nKeep me.\n')
  })
  it('ignores an empty entry', () => {
    expect(appendMissionLog(FILE, { at: 'x', who: 'owner', text: '  \n ' })).toBe(FILE)
  })
  it('guessMatch: shared words over all words', () => {
    expect(guessMatch('yes do it', 'Yes, do it!')).toBe(1)
    expect(guessMatch('yes', 'no')).toBe(0)
    expect(guessMatch('', 'no')).toBe(0)
  })
})

describe('new missions', () => {
  it('makes a file name and a parsable file', () => {
    expect(missionFileName('  Parzival moves in! (v2) ')).toBe('parzival-moves-in-v2.md')
    expect(missionFileName('???')).toBe('mission.md')
    const mission = parseMission('x.md', newMissionMarkdown('Parzival moves in', 'owner', '2026-11-10 10:00'))
    expect(mission).toMatchObject({ title: 'Parzival moves in', state: 'idea', who: 'owner', priority: 0.22 })
    expect(parseMissionLog(mission.markdown)).toHaveLength(1)
  })
})

describe('the wall follows', () => {
  it('scales a panel with its share of the top priority', () => {
    expect(missionPanelScale(0.6, 0.6)).toBe(1.15)
    expect(missionPanelScale(0.3, 0.6)).toBe(0.935)
    expect(missionPanelScale(null, 0.6)).toBe(0.72)
    expect(missionPanelScale(0.5, 0)).toBe(0.72)
  })
  it('Esc closes the reader even from a text field; other keys are typing', () => {
    const base = { ctrl: false, meta: false, alt: false, repeat: false, nearby: true, agent: false, worldKeysFree: false }
    expect(missionKeyAction({ ...base, code: 'Escape', typing: true, reader: 'side' })).toBe('close')
    expect(missionKeyAction({ ...base, code: 'KeyE', typing: true, reader: 'side' })).toBeNull()
    expect(missionKeyAction({ ...base, code: 'KeyF', typing: true, reader: 'full' })).toBeNull()
  })
})
