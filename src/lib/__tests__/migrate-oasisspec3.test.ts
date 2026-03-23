// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASISSPEC3 PARSER TESTS — parseOasisSpec pure function
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'

// ── Inline copy of parseOasisSpec (pure function, no deps) ──────────────

interface ParsedMission {
  name: string
  description: string
  questName: string
  phase: string
}

function parseOasisSpec(content: string): ParsedMission[] {
  const missions: ParsedMission[] = []
  let currentPhase = ''
  let currentQuest = ''

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // Phase headers
    const phaseMatch = trimmed.match(/^## ░▒▓█ (.+) █▓▒░$/)
    if (phaseMatch) {
      currentPhase = phaseMatch[1]
      continue
    }

    // Quest/section headers
    const questMatch = trimmed.match(/^### (.+?)(?:\s*—.*)?$/)
    if (questMatch) {
      currentQuest = questMatch[1].replace(/\s*✅$/, '').trim()
      continue
    }

    // Skip checked items
    if (trimmed.startsWith('- [x]') || trimmed.includes('✅')) continue

    // Unchecked items → missions
    const unchecked = trimmed.match(/^- \[ \] (.+)$/)
    if (unchecked) {
      const text = unchecked[1].trim()
      missions.push({
        name: text.length > 80 ? text.substring(0, 77) + '...' : text,
        description: text,
        questName: currentQuest,
        phase: currentPhase,
      })
      continue
    }

    // Bare text lines in backlog sections (no checkbox)
    if (currentPhase.includes('FEATURES') || currentPhase.includes('OLDER BUGS') || currentPhase.includes('freshbugs')) {
      const isNoise = /^[-═░▓█╔╚║╗╝╠╣│┌┐└┘─┼*>]/.test(trimmed)
        || /^\d+\./.test(trimmed) // numbered lists
        || trimmed.startsWith('#')
        || trimmed.startsWith('http')
        || trimmed.startsWith('$')
        || trimmed.length <= 5
      if (trimmed && !isNoise) {
        missions.push({
          name: trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed,
          description: trimmed,
          questName: currentPhase,
          phase: currentPhase,
        })
      }
    }
  }

  return missions
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('parseOasisSpec', () => {
  it('returns empty array for empty input', () => {
    expect(parseOasisSpec('')).toEqual([])
  })

  it('returns empty array for whitespace-only input', () => {
    expect(parseOasisSpec('   \n\n  \n')).toEqual([])
  })

  it('returns 0 missions when all items are checked', () => {
    const input = `## ░▒▓█ PHASE 1 █▓▒░
### Some Quest
- [x] Already done
- [x] Also done ✅`
    expect(parseOasisSpec(input)).toEqual([])
  })

  it('extracts unchecked items as missions', () => {
    const input = `## ░▒▓█ PHASE 1 █▓▒░
### Camera Systems
- [ ] Fix noclip mouse drift
- [ ] Add third-person collision`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Fix noclip mouse drift')
    expect(result[1].name).toBe('Add third-person collision')
  })

  it('tracks current phase correctly', () => {
    const input = `## ░▒▓█ PHASE 1 — Foundation █▓▒░
### Quest A
- [ ] Task in phase 1

## ░▒▓█ PHASE 2 — Polish █▓▒░
### Quest B
- [ ] Task in phase 2`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(2)
    expect(result[0].phase).toBe('PHASE 1 — Foundation')
    expect(result[1].phase).toBe('PHASE 2 — Polish')
  })

  it('tracks current quest correctly', () => {
    const input = `## ░▒▓█ P1 █▓▒░
### Camera Systems
- [ ] Fix drift
### World Builder
- [ ] Add terrain tools`
    const result = parseOasisSpec(input)
    expect(result[0].questName).toBe('Camera Systems')
    expect(result[1].questName).toBe('World Builder')
  })

  it('strips trailing checkmark from quest names', () => {
    const input = `## ░▒▓█ P1 █▓▒░
### Completed Quest ✅
- [ ] One leftover task`
    const result = parseOasisSpec(input)
    expect(result[0].questName).toBe('Completed Quest')
  })

  it('strips em-dash suffix from quest names', () => {
    const input = `## ░▒▓█ P1 █▓▒░
### Camera Systems — smooth movement
- [ ] Do something`
    const result = parseOasisSpec(input)
    expect(result[0].questName).toBe('Camera Systems')
  })

  it('skips checked items with [x]', () => {
    const input = `## ░▒▓█ P1 █▓▒░
### Q
- [x] Done thing
- [ ] Not done thing`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Not done thing')
  })

  it('skips lines containing ✅ emoji', () => {
    const input = `## ░▒▓█ P1 █▓▒░
### Q
- [ ] This has ✅ in it
- [ ] Normal task`
    const result = parseOasisSpec(input)
    // The line with ✅ is skipped even if it looks unchecked
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Normal task')
  })

  it('truncates names longer than 80 chars', () => {
    const longText = 'A'.repeat(100)
    const input = `## ░▒▓█ P1 █▓▒░
### Q
- [ ] ${longText}`
    const result = parseOasisSpec(input)
    expect(result[0].name).toHaveLength(80)
    expect(result[0].name).toBe('A'.repeat(77) + '...')
    // description keeps full text
    expect(result[0].description).toBe(longText)
  })

  it('captures bare text lines in FEATURES phase', () => {
    const input = `## ░▒▓█ FEATURES BACKLOG █▓▒░
Add lighting system to forge
Implement undo for object placement`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Add lighting system to forge')
    expect(result[0].questName).toBe('FEATURES BACKLOG')
    expect(result[0].phase).toBe('FEATURES BACKLOG')
  })

  it('captures bare text lines in OLDER BUGS phase', () => {
    const input = `## ░▒▓█ OLDER BUGS █▓▒░
Camera snaps on mode switch`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Camera snaps on mode switch')
  })

  it('captures bare text lines in freshbugs phase', () => {
    const input = `## ░▒▓█ freshbugs █▓▒░
World save fails on empty state`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(1)
  })

  it('filters box-drawing noise in FEATURES sections', () => {
    const input = `## ░▒▓█ FEATURES █▓▒░
╔═══════════════════════╗
║ some box art          ║
╚═══════════════════════╝
───────────────
- bullet noise
* star noise
> quote noise
Real task here`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Real task here')
  })

  it('filters numbered lists in FEATURES sections', () => {
    const input = `## ░▒▓█ FEATURES █▓▒░
1. This is a numbered list item
2. Another numbered item
Real task not numbered`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Real task not numbered')
  })

  it('filters short lines (<=5 chars) in FEATURES sections', () => {
    const input = `## ░▒▓█ FEATURES █▓▒░
OK
Yes
Actual meaningful task here`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Actual meaningful task here')
  })

  it('filters URLs and $ lines in FEATURES sections', () => {
    const input = `## ░▒▓█ FEATURES █▓▒░
https://example.com/some-reference
$SOME_VAR
Real feature request`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Real feature request')
  })

  it('filters heading lines in FEATURES sections', () => {
    const input = `## ░▒▓█ FEATURES █▓▒░
# Some heading
## Another heading
Real feature line`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Real feature line')
  })

  it('does NOT capture bare text outside FEATURES/BUGS phases', () => {
    const input = `## ░▒▓█ PHASE 1 █▓▒░
### Camera Systems
This is just a description, not a task
- [ ] Actual task`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Actual task')
  })

  it('handles mixed checked and unchecked items', () => {
    const input = `## ░▒▓█ P1 █▓▒░
### Q
- [x] Done A
- [ ] Todo B
- [x] Done C
- [ ] Todo D
- [x] Done E`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Todo B')
    expect(result[1].name).toBe('Todo D')
  })

  it('handles realistic multi-phase spec content', () => {
    const input = `## ░▒▓█ PHASE 1 — Core █▓▒░
### Camera Systems — smooth controls
- [x] Orbit mode
- [x] Noclip mode
- [ ] Third-person collision detection
### World Persistence
- [x] Auto-save debounce
- [ ] Cross-device sync via Supabase

## ░▒▓█ PHASE 2 — Agents █▓▒░
### Merlin
- [ ] Streaming response handling
### DevCraft ✅
- [x] Mission CRUD

## ░▒▓█ FEATURES BACKLOG █▓▒░
╔═══════════════════════╗
VR mode support
Multiplayer prototype`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(5)
    // Phase 1
    expect(result[0]).toEqual({
      name: 'Third-person collision detection',
      description: 'Third-person collision detection',
      questName: 'Camera Systems',
      phase: 'PHASE 1 — Core',
    })
    expect(result[1].questName).toBe('World Persistence')
    expect(result[1].phase).toBe('PHASE 1 — Core')
    // Phase 2
    expect(result[2].phase).toBe('PHASE 2 — Agents')
    expect(result[2].questName).toBe('Merlin')
    // Features backlog bare text
    expect(result[3].name).toBe('VR mode support')
    expect(result[4].name).toBe('Multiplayer prototype')
    expect(result[3].questName).toBe('FEATURES BACKLOG')
  })

  it('truncates bare text lines over 80 chars in FEATURES', () => {
    const longLine = 'B'.repeat(100)
    const input = `## ░▒▓█ FEATURES █▓▒░
${longLine}`
    const result = parseOasisSpec(input)
    expect(result[0].name).toHaveLength(80)
    expect(result[0].name).toBe('B'.repeat(77) + '...')
    expect(result[0].description).toBe(longLine)
  })

  it('preserves empty phase and quest when not yet encountered', () => {
    const input = `- [ ] Orphan task before any headers`
    const result = parseOasisSpec(input)
    expect(result).toHaveLength(1)
    expect(result[0].phase).toBe('')
    expect(result[0].questName).toBe('')
  })
})
