import { describe, expect, it } from 'vitest'
import { answerCarbonMission, formatAnswerNote, isCarbonFile, parseCarbonMission, quickAnswer, sortCarbon } from '../village/carbon-missions'

const FILE = `state: open
kind: question
asked: 2026-11-19
by: Hustler
score: ease 5 · impact 4 · urgency 3
minutes: 2
blocks: the install line, the npm name
recommend: yes
predict: yes, and he will ask what the name on npm is

# Should the main Oasis repository on GitHub go private?

## What it is
Two lines.

## Options
- **Yes:** this.
- **No:** that.

## Recommendation
Yes, Hustler's.
`

describe('parseCarbonMission', () => {
  it('reads the header, the score and the title', () => {
    const m = parseCarbonMission('2026-11-19_repo-private.md', FILE)
    expect(m).toMatchObject({
      title: 'Should the main Oasis repository on GitHub go private?',
      state: 'open', kind: 'question', asked: '2026-11-19', by: 'Hustler',
      ease: 5, impact: 4, urgency: 3, priority: 0.48, minutes: 2,
      blocks: 'the install line, the npm name', recommend: 'yes', predict: 'yes, and he will ask what the name on npm is',
      answer: '', took: null,
    })
    expect(m.body.startsWith('## What it is')).toBe(true)
  })
  it('falls back to the file name for the date and title; odd states read as open', () => {
    const m = parseCarbonMission('2026-11-18_pay-the-bill.md', 'state: weird\nkind: task\n\nJust do it.')
    expect(m).toMatchObject({ title: 'pay the bill', asked: '2026-11-18', state: 'open', kind: 'task', priority: null, body: 'Just do it.' })
  })
  it('takes mission files, not the README or hidden ones', () => {
    expect(['a.md', 'README.md', '_draft.md', '.x.md', 'b.txt'].filter(isCarbonFile)).toEqual(['a.md'])
  })
})

describe('sortCarbon', () => {
  const m = (file: string, state: 'open' | 'parked' | 'answered', asked: string, priority: number | null, urgency = 3, impact = 3, ease = 3) => ({ file, state, asked, priority, urgency, impact, ease })
  const list = [m('a', 'open', '2026-11-10', 0.2, 2, 5, 1), m('b', 'open', '2026-11-19', 0.6, 5, 3, 4), m('c', 'answered', '2026-11-01', 1), m('d', 'parked', '2026-11-05', 0.9), m('e', 'open', '2026-11-15', null, 1, 1, 5)]
  it('open first, then parked, then answered; highest priority first by default', () => {
    expect(sortCarbon(list).map(x => x.file)).toEqual(['b', 'a', 'e', 'd', 'c'])
  })
  it('by date, oldest or newest; by urgency, impact, ease', () => {
    expect(sortCarbon(list, 'oldest').map(x => x.file)).toEqual(['a', 'e', 'b', 'd', 'c'])
    expect(sortCarbon(list, 'newest').map(x => x.file)).toEqual(['b', 'e', 'a', 'd', 'c'])
    expect(sortCarbon(list, 'urgency').map(x => x.file).slice(0, 3)).toEqual(['b', 'a', 'e'])
    expect(sortCarbon(list, 'impact').map(x => x.file).slice(0, 3)).toEqual(['a', 'b', 'e'])
    expect(sortCarbon(list, 'ease').map(x => x.file).slice(0, 3)).toEqual(['e', 'b', 'a'])
  })
})

describe('answering', () => {
  it('writes state, answered, answer and took into the header; the rest stays', () => {
    const out = answerCarbonMission(FILE, { answer: 'yes,\nbut keep the stars', state: 'answered', took: 3.4, date: '2026-11-20' })
    const lines = out.split('\n')
    expect(lines[0]).toBe('state: answered')
    expect(lines.slice(1, 9)).toEqual(FILE.split('\n').slice(1, 9))
    expect(lines.slice(9, 12)).toEqual(['answered: 2026-11-20', 'answer: yes, but keep the stars', 'took: 3'])
    expect(out.slice(out.indexOf('# Should'))).toBe(FILE.slice(FILE.indexOf('# Should')))
    expect(parseCarbonMission('x.md', out)).toMatchObject({ state: 'answered', answered: '2026-11-20', answer: 'yes, but keep the stars', took: 3 })
  })
  it('later parks it; answering again replaces the answer', () => {
    const parked = answerCarbonMission(FILE, { ...quickAnswer('later', { recommend: 'yes' }), took: null, date: '2026-11-20' })
    expect(parseCarbonMission('x.md', parked)).toMatchObject({ state: 'parked', answer: 'later' })
    expect(parked).toContain('parked: 2026-11-20')
    const again = answerCarbonMission(parked, { answer: 'no', state: 'answered', took: 1, date: '2026-11-21' })
    expect(parseCarbonMission('x.md', again)).toMatchObject({ state: 'answered', answer: 'no', answered: '2026-11-21' })
  })
  it('quick answers: yes is the recommendation', () => {
    expect(quickAnswer('yes', { recommend: 'keep both' })).toEqual({ answer: 'yes (as recommended: keep both)', state: 'answered' })
    expect(quickAnswer('no', { recommend: '' })).toEqual({ answer: 'no', state: 'answered' })
    expect(quickAnswer('done', { recommend: '' })).toEqual({ answer: 'done', state: 'answered' })
  })
  it('tells Anorak the file, the answer, and what he predicted', () => {
    const note = formatAnswerNote({ file: 'a.md', title: 'T', recommend: 'yes', predict: 'yes' }, 'no', 'answered', 2)
    expect(note).toContain('answered "T" (docs/questions/a.md) after 2 min')
    expect(note).toContain('\nno\n')
    expect(note).toContain('Your prediction was: yes')
  })
})

describe('the garden wall shows his open missions', () => {
  it('open only, highest priority first, at most max; the caption says minutes and what waits', async () => {
    const { carbonWallMissions } = await import('../village/carbon-missions')
    const a = parseCarbonMission('a.md', FILE)
    const b = parseCarbonMission('b.md', 'state: open\nkind: task\nscore: ease 5 · impact 5 · urgency 5\nminutes: 3\n\n# Pay the bill')
    const c = parseCarbonMission('c.md', 'state: parked\nscore: ease 5 · impact 5 · urgency 5\n\n# Later')
    const wall = carbonWallMissions([a, b, c], 24)
    expect(wall.map(m => m.file)).toEqual(['b.md', 'a.md'])
    expect(wall[0]).toMatchObject({ title: 'Pay the bill', column: 'to do', state: 'task', priority: 1, tldr: 'about 3 min of your time' })
    expect(wall[1]).toMatchObject({ who: 'asked by Hustler', tldr: 'about 2 min of your time · waits: the install line, the npm name' })
    expect(carbonWallMissions([a, b], 1)).toHaveLength(1)
  })
})
