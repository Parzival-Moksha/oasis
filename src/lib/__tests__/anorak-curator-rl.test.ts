import { describe, it, expect } from 'vitest'
import { parseHistory, formatThread, formatMission, regenerateCuratorRL } from '../anorak-curator-rl'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

// ═══════════════════════════════════════════════════════════════════════════
// parseHistory
// ═══════════════════════════════════════════════════════════════════════════

describe('parseHistory', () => {
  it('returns empty array for null', () => {
    expect(parseHistory(null)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseHistory('')).toEqual([])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseHistory('not json')).toEqual([])
  })

  it('returns empty array for non-array JSON', () => {
    expect(parseHistory('{"a":1}')).toEqual([])
  })

  it('parses valid JSON array', () => {
    const entries = [
      { actor: 'curator', curatorMsg: 'hello', flawlessPercent: 80 },
      { actor: 'carbondev', verdict: 'accept', rating: 8 },
    ]
    expect(parseHistory(JSON.stringify(entries))).toEqual(entries)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// formatThread
// ═══════════════════════════════════════════════════════════════════════════

describe('formatThread', () => {
  it('returns empty string for empty entries', () => {
    expect(formatThread([])).toBe('')
  })

  it('filters out non-curator/carbondev entries', () => {
    const entries = [
      { actor: 'coder', action: 'started' },
      { actor: 'tester', action: 'test' },
    ]
    expect(formatThread(entries)).toBe('')
  })

  it('formats curator entry with flawless% and silicondev confidence', () => {
    const entries = [
      { actor: 'curator', curatorMsg: 'deep dive done', silicondevMsg: 'ship it', silicondevConfidence: 0.85, flawlessPercent: 87 },
    ]
    const result = formatThread(entries)
    expect(result).toContain('curator: "deep dive done"')
    expect(result).toContain('[flawless:87%]')
    expect(result).toContain('silicondev: "ship it"')
    expect(result).toContain('[conf:0.85]')
  })

  it('formats carbondev entry with verdict and rating', () => {
    const entries = [
      { actor: 'carbondev', verdict: 'accept', rating: 9, mature: true, carbonSeconds: 120, carbondevMsg: 'looks good' },
    ]
    const result = formatThread(entries)
    expect(result).toContain('[ACCEPT]')
    expect(result).toContain('rating:9')
    expect(result).toContain('BUMP')
    expect(result).toContain('120s')
    expect(result).toContain('"looks good"')
  })

  it('shows REFINE for non-mature feedback', () => {
    const entries = [
      { actor: 'carbondev', mature: false },
    ]
    expect(formatThread(entries)).toContain('REFINE')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// formatMission
// ═══════════════════════════════════════════════════════════════════════════

describe('formatMission', () => {
  const baseMission = {
    id: 42,
    name: 'Fix race condition',
    description: 'the save ghost bug',
    urgency: 8,
    easiness: 6,
    impact: 9,
    priority: 3.46,
    valor: 1.5,
    score: 5.18,
    actualSeconds: 300,
    reviewerScore: 92,
    testerScore: 100,
    flawlessPercent: 87,
    dharmaPath: 'view,mindfulness',
    history: null,
    createdAt: '2026-03-24T10:00:00.000Z',
  }

  it('formats mission header with UEI and scores', () => {
    const result = formatMission(baseMission)
    expect(result).toContain('#42: "Fix race condition"')
    expect(result).toContain('U8 E6 I9')
    expect(result).toContain('Valor: 1.5')
  })

  it('includes dharma path', () => {
    expect(formatMission(baseMission)).toContain('Dharma: view,mindfulness')
  })

  it('includes carbon description', () => {
    expect(formatMission(baseMission)).toContain('the save ghost bug')
  })

  it('includes reviewer and tester scores', () => {
    const result = formatMission(baseMission)
    expect(result).toContain('Reviewer: 92/100')
    expect(result).toContain('Tester: 100%')
    expect(result).toContain('Flawless: 87%')
  })

  it('handles null scores gracefully', () => {
    const result = formatMission({ ...baseMission, reviewerScore: null, testerScore: null, flawlessPercent: null })
    expect(result).toContain('Reviewer: ?/100')
    expect(result).toContain('Tester: ?%')
  })

  it('counts maturation rounds from history', () => {
    const history = JSON.stringify([
      { actor: 'curator', action: 'mature' },
      { actor: 'carbondev', action: 'feedback' },
      { actor: 'curator', action: 'mature' },
    ])
    const result = formatMission({ ...baseMission, history })
    expect(result).toContain('Maturation: 2 rounds')
  })

  it('includes curator thread when history exists', () => {
    const history = JSON.stringify([
      { actor: 'curator', curatorMsg: 'found the root', flawlessPercent: 85 },
    ])
    const result = formatMission({ ...baseMission, history })
    expect(result).toContain('Thread:')
    expect(result).toContain('found the root')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// regenerateCuratorRL
// ═══════════════════════════════════════════════════════════════════════════

describe('regenerateCuratorRL', () => {
  it('writes empty RL file when no missions', async () => {
    const tmpDir = path.join(os.tmpdir(), `curator-rl-test-${Date.now()}`)
    const result = await regenerateCuratorRL([], tmpDir)
    expect(result.missionsIncluded).toBe(0)

    const content = await fs.readFile(path.join(tmpDir, 'curator-rl.md'), 'utf-8')
    expect(content).toContain('No Done Missions Yet')

    await fs.rm(tmpDir, { recursive: true })
  })

  it('writes RL file with mission data', async () => {
    const tmpDir = path.join(os.tmpdir(), `curator-rl-test-${Date.now()}`)
    const missions = [{
      id: 1, name: 'Test mission', description: 'vibes', urgency: 5, easiness: 5,
      impact: 5, priority: 1, valor: 1, score: 1, actualSeconds: 60,
      reviewerScore: 90, testerScore: 100, flawlessPercent: 80,
      dharmaPath: 'effort', history: null, createdAt: new Date().toISOString(),
    }]
    const result = await regenerateCuratorRL(missions, tmpDir)
    expect(result.missionsIncluded).toBe(1)
    expect(result.tokensEstimate).toBeGreaterThan(0)

    const content = await fs.readFile(path.join(tmpDir, 'curator-rl.md'), 'utf-8')
    expect(content).toContain('Test mission')
    expect(content).toContain('Flawless: 80%')

    await fs.rm(tmpDir, { recursive: true })
  })
})
