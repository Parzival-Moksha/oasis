// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// REVIEW FIXES BATCH TEST — verifies 8 HIGH fixes from deep review
// Purple purge, WAL mode, anorak-pro case, null guard, production guard
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..', '..')

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf-8')
}

// ═══════════════════════════════════════════════════════════════════════════
// PURPLE PURGE — MATURITY_COLORS must contain NO purple hex values
// ═══════════════════════════════════════════════════════════════════════════

const PURPLE_HEXES = ['#a855f7', '#818cf8', '#7c3aed', '#9333ea', '#8b5cf6']

function extractMaturityColors(source: string): string[] {
  const match = source.match(/const MATURITY_COLORS\s*=\s*\[([^\]]+)\]/)
  if (!match) return []
  return match[1].match(/'[^']+'/g)?.map(s => s.replace(/'/g, '')) ?? []
}

describe('Purple purge — MATURITY_COLORS', () => {
  const files = [
    'src/components/forge/Mindcraft2.tsx',
    'src/components/forge/AnorakProPanel.tsx',
    'src/components/forge/ParzivalMissions.tsx',
  ]

  for (const file of files) {
    describe(file.split('/').pop()!, () => {
      const source = readSource(file)
      const colors = extractMaturityColors(source)

      it('has MATURITY_COLORS defined', () => {
        expect(colors.length).toBeGreaterThan(0)
      })

      for (const purple of PURPLE_HEXES) {
        it(`does not contain ${purple}`, () => {
          expect(colors).not.toContain(purple)
        })
      }

      it('uses sky-blue or turquoise for mid levels', () => {
        // Level 1 should be sky blue (#0ea5e9), level 2 should be turquoise (#14b8a6)
        expect(colors).toContain('#0ea5e9')
        expect(colors).toContain('#14b8a6')
      })
    })
  }
})

describe('Purple purge — parzival-missions.test.ts mirrored constants', () => {
  const source = readSource('src/lib/__tests__/parzival-missions.test.ts')
  const colors = extractMaturityColors(source)

  it('test file mirrors component colors (no purple)', () => {
    for (const purple of PURPLE_HEXES) {
      expect(colors).not.toContain(purple)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// WAL MODE — db.ts must set PRAGMA journal_mode=WAL
// ═══════════════════════════════════════════════════════════════════════════

describe('WAL mode — db.ts', () => {
  const source = readSource('src/lib/db.ts')

  it('contains PRAGMA journal_mode=WAL', () => {
    expect(source).toContain('PRAGMA journal_mode=WAL')
  })

  it('contains PRAGMA busy_timeout', () => {
    expect(source).toContain('PRAGMA busy_timeout=5000')
  })

  it('only sets PRAGMAs on first init (guarded by !globalForPrisma.prisma)', () => {
    expect(source).toContain('if (!globalForPrisma.prisma)')
  })
})

describe('WAL mode — mission-mcp/index.js', () => {
  const source = readSource('tools/mission-mcp/index.js')

  it('contains PRAGMA journal_mode=WAL', () => {
    expect(source).toContain('PRAGMA journal_mode=WAL')
  })

  it('contains PRAGMA busy_timeout', () => {
    expect(source).toContain('PRAGMA busy_timeout=5000')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK-PRO CASE — AgentWindow3D must handle 'anorak-pro' type
// ═══════════════════════════════════════════════════════════════════════════

describe('AgentWindow3D — anorak-pro case', () => {
  const source = readSource('src/components/forge/AgentWindow3D.tsx')

  it("contains case 'anorak-pro'", () => {
    expect(source).toContain("case 'anorak-pro'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// NULL GUARD — execute route checks freshMission for null
// ═══════════════════════════════════════════════════════════════════════════

describe('Execute route — freshMission null guard', () => {
  const source = readSource('src/app/api/anorak/pro/execute/route.ts')

  it('reads freshMission from DB before building coder prompt', () => {
    expect(source).toContain('const freshMission = await prisma.mission.findUnique')
  })

  it('checks freshMission for null', () => {
    expect(source).toContain('if (!freshMission)')
  })

  it('sends error and breaks on null freshMission', () => {
    const idx = source.indexOf('if (!freshMission)')
    const after = source.substring(idx, idx + 200)
    expect(after).toContain('deleted mid-execution')
    expect(after).toContain('break')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ABORT LISTENER CLEANUP — spawnAgent removes abort listener on close
// ═══════════════════════════════════════════════════════════════════════════

describe('Execute route — abort listener cleanup', () => {
  const source = readSource('src/app/api/anorak/pro/execute/route.ts')

  it('adds abort listener to signal', () => {
    expect(source).toContain("signal.addEventListener('abort'")
  })

  it('removes abort listener on child close', () => {
    expect(source).toContain("signal.removeEventListener('abort'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTION GUARD — test-harness.ts returns early in production
// ═══════════════════════════════════════════════════════════════════════════

describe('Test harness — production guard', () => {
  const source = readSource('src/lib/test-harness.ts')

  it("checks NODE_ENV === 'production' and returns early", () => {
    expect(source).toContain("process.env.NODE_ENV === 'production'")
  })

  it('production guard is before harness installation', () => {
    const prodIdx = source.indexOf("process.env.NODE_ENV === 'production'")
    const harnessIdx = source.indexOf('const harness')
    expect(prodIdx).toBeLessThan(harnessIdx)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// FRESH DB READ — finalScore uses completedMission from DB, not stale data
// ═══════════════════════════════════════════════════════════════════════════

describe('Execute route — fresh finalScore from DB', () => {
  const source = readSource('src/app/api/anorak/pro/execute/route.ts')

  it('reads completedMission from DB for final score', () => {
    // Should read from DB after tester phase, not use stale mission object
    expect(source).toMatch(/completedMission.*findUnique|findUnique.*completedMission/)
  })

  it('computes finalScore from completedMission', () => {
    expect(source).toContain('completedMission?.priority')
  })
})
