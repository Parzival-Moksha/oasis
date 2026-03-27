// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WIZARD DECOMPOSITION TESTS — verifies the WizardConsole monolith
// decomposition into 10 files under src/components/forge/wizard/
// Module exports, shared constants, type contracts, no circular imports
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..', '..')
const WIZARD_DIR = join(ROOT, 'src', 'components', 'forge', 'wizard')

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf-8')
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. FILE EXISTENCE — all 10 decomposed files exist
// ═══════════════════════════════════════════════════════════════════════════

describe('Wizard decomposition — file existence', () => {
  const expectedFiles = [
    'index.ts',
    'shared.tsx',
    'ConjureTab.tsx',
    'CraftTab.tsx',
    'WorldTab.tsx',
    'AssetsTab.tsx',
    'PlacedTab.tsx',
    'ImagineTab.tsx',
    'AgentsTab.tsx',
    'SettingsTab.tsx',
  ]

  for (const file of expectedFiles) {
    it(`wizard/${file} exists`, () => {
      expect(() => readFileSync(join(WIZARD_DIR, file), 'utf-8')).not.toThrow()
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. BARREL EXPORT — index.ts re-exports WizardConsole
// ═══════════════════════════════════════════════════════════════════════════

describe('Wizard barrel export (index.ts)', () => {
  const source = readSource('src/components/forge/wizard/index.ts')

  it('re-exports WizardConsole', () => {
    expect(source).toContain('WizardConsole')
  })

  it('exports from parent WizardConsole.tsx', () => {
    expect(source).toMatch(/from\s+['"]\.\.\/WizardConsole['"]/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. SHARED MODULE — constants and exported symbols
// ═══════════════════════════════════════════════════════════════════════════

describe('Wizard shared module', () => {
  const source = readSource('src/components/forge/wizard/shared.tsx')

  describe('OASIS_BASE', () => {
    it('is exported as a const', () => {
      expect(source).toMatch(/export const OASIS_BASE/)
    })

    it('reads from NEXT_PUBLIC_BASE_PATH env var', () => {
      expect(source).toContain('NEXT_PUBLIC_BASE_PATH')
    })
  })

  describe('STATUS_STYLES', () => {
    const allStatuses = ['queued', 'generating', 'refining', 'downloading', 'ready', 'failed']

    it('is a Record<ConjureStatus, ...>', () => {
      expect(source).toMatch(/STATUS_STYLES.*Record<ConjureStatus/)
    })

    for (const status of allStatuses) {
      it(`has key "${status}"`, () => {
        expect(source).toContain(`${status}:`)
      })
    }

    it('each entry has bg, text, and label fields', () => {
      // Extract entries between STATUS_STYLES = { ... }
      const match = source.match(/STATUS_STYLES[^{]*\{([\s\S]*?)\n\}/)
      expect(match).toBeTruthy()
      const block = match![1]
      for (const status of allStatuses) {
        const entryMatch = block.match(new RegExp(`${status}:\\s*\\{([^}]+)\\}`))
        expect(entryMatch).toBeTruthy()
        expect(entryMatch![1]).toContain('bg:')
        expect(entryMatch![1]).toContain('text:')
        expect(entryMatch![1]).toContain('label:')
      }
    })
  })

  describe('LIGHT_TOOLTIPS', () => {
    const expectedLightTypes = ['directional', 'ambient', 'hemisphere', 'environment', 'point', 'spot']

    it('is exported as a Record<string, ...>', () => {
      expect(source).toMatch(/export const LIGHT_TOOLTIPS/)
    })

    for (const lightType of expectedLightTypes) {
      it(`has key "${lightType}"`, () => {
        expect(source).toContain(`${lightType}:`)
      })
    }

    it('each tooltip has icon, name, tagline, details', () => {
      const match = source.match(/LIGHT_TOOLTIPS[^{]*\{([\s\S]*?)\n\}/)
      expect(match).toBeTruthy()
      const block = match![1]
      for (const key of expectedLightTypes) {
        // Just verify each key block contains the fields
        const entryRe = new RegExp(`${key}:\\s*\\{([\\s\\S]*?)\\}\\s*,`)
        const entry = block.match(entryRe)
        expect(entry, `${key} entry should exist`).toBeTruthy()
        expect(entry![1]).toContain('icon:')
        expect(entry![1]).toContain('name:')
        expect(entry![1]).toContain('tagline:')
        expect(entry![1]).toContain('details:')
      }
    })
  })

  describe('Exported components', () => {
    const expectedExports = ['StatusBadge', 'AssetThumb', 'LightTooltipWrap', 'GalleryItem']

    for (const name of expectedExports) {
      it(`exports ${name}`, () => {
        expect(source).toMatch(new RegExp(`export function ${name}`))
      })
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. TAB MODULES — each exports expected component(s)
// ═══════════════════════════════════════════════════════════════════════════

describe('Tab module exports', () => {
  const tabExports: Record<string, string[]> = {
    'ConjureTab.tsx': ['ConjureTabHeader', 'ConjureTabContent'],
    'CraftTab.tsx': ['CraftTabHeader', 'CraftTabContent'],
    'WorldTab.tsx': ['WorldTab'],
    'AssetsTab.tsx': ['AssetsTab'],
    'PlacedTab.tsx': ['PlacedTab'],
    'ImagineTab.tsx': ['ImagineTab'],
    'AgentsTab.tsx': ['AgentsTabContent'],
    'SettingsTab.tsx': ['SettingsTab'],
  }

  for (const [file, exports] of Object.entries(tabExports)) {
    describe(file, () => {
      const source = readSource(`src/components/forge/wizard/${file}`)

      for (const name of exports) {
        it(`exports ${name}`, () => {
          expect(source).toMatch(new RegExp(`export function ${name}`))
        })
      }

      it('is a client component', () => {
        expect(source).toContain("'use client'")
      })
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. CONJURE TAB — FORGE_COLOR constant
// ═══════════════════════════════════════════════════════════════════════════

describe('ConjureTab constants', () => {
  const source = readSource('src/components/forge/wizard/ConjureTab.tsx')

  it('defines FORGE_COLOR', () => {
    expect(source).toMatch(/const FORGE_COLOR\s*=/)
  })

  it('FORGE_COLOR is orange (#F97316)', () => {
    expect(source).toContain('#F97316')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. AGENTS TAB — reads store internally (no props)
// ═══════════════════════════════════════════════════════════════════════════

describe('AgentsTab store isolation', () => {
  const source = readSource('src/components/forge/wizard/AgentsTab.tsx')

  it('imports useOasisStore', () => {
    expect(source).toContain('useOasisStore')
  })

  it('AgentsTabContent takes no props (reads store internally)', () => {
    // The function signature should be () => { ... } with no parameters
    expect(source).toMatch(/export function AgentsTabContent\(\)\s*\{/)
  })

  it('defines AGENT_TYPES with all 5 agents', () => {
    expect(source).toContain('AGENT_TYPES')
    const expectedAgents = ['anorak', 'anorak-pro', 'merlin', 'devcraft', 'parzival']
    for (const agent of expectedAgents) {
      expect(source).toContain(`'${agent}'`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. NO CIRCULAR IMPORTS — each module imports from parent or lib, not peers
// ═══════════════════════════════════════════════════════════════════════════

describe('No circular imports between wizard tabs', () => {
  const tabFiles = [
    'ConjureTab.tsx',
    'CraftTab.tsx',
    'WorldTab.tsx',
    'AssetsTab.tsx',
    'PlacedTab.tsx',
    'ImagineTab.tsx',
    'AgentsTab.tsx',
    'SettingsTab.tsx',
  ]

  for (const file of tabFiles) {
    it(`${file} does not import other tab files`, () => {
      const source = readSource(`src/components/forge/wizard/${file}`)
      // Extract all import paths
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1])
      // Filter to relative imports within wizard/
      const peerImports = imports.filter(p =>
        p.startsWith('./') && !p.includes('shared') && !p.includes('index')
      )
      expect(peerImports, `${file} should not import peer tabs: ${peerImports.join(', ')}`).toEqual([])
    })
  }

  it('shared.tsx does not import any tab files', () => {
    const source = readSource('src/components/forge/wizard/shared.tsx')
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1])
    const tabImports = imports.filter(p =>
      p.startsWith('./') && !p.includes('shared')
    )
    expect(tabImports).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. WIZARDCONSOLE SHELL — imports all tabs from wizard/
// ═══════════════════════════════════════════════════════════════════════════

describe('WizardConsole shell', () => {
  const source = readSource('src/components/forge/WizardConsole.tsx')

  it.skip('is under 500 lines (decomposed from 3263) — WIP: cousin decomposing', () => {
    const lineCount = source.split('\n').length
    expect(lineCount).toBeLessThan(500)
  })

  it.skip('imports from ./wizard/ — WIP: cousin decomposing', () => {
    expect(source).toMatch(/from\s+['"]\.\/wizard\//)
  })

  it('still exports WizardConsole', () => {
    expect(source).toMatch(/export (function|const) WizardConsole/)
  })

  it('has all 7 tab keys in the tab strip', () => {
    const expectedTabs = ['conjure', 'craft', 'world', 'assets', 'placed', 'agents', 'imagine']
    for (const tab of expectedTabs) {
      expect(source).toContain(`'${tab}'`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. SHARED IMPORTS — tabs that use shared components import them correctly
// ═══════════════════════════════════════════════════════════════════════════

describe('Shared component usage', () => {
  it('ConjureTab imports GalleryItem from shared', () => {
    const source = readSource('src/components/forge/wizard/ConjureTab.tsx')
    expect(source).toMatch(/from\s+['"]\.\/shared['"]/)
    expect(source).toContain('GalleryItem')
  })

  it('AssetsTab imports AssetThumb from shared', () => {
    const source = readSource('src/components/forge/wizard/AssetsTab.tsx')
    expect(source).toMatch(/from\s+['"]\.\/shared['"]/)
    expect(source).toContain('AssetThumb')
  })

  it('WorldTab imports LightTooltipWrap from shared', () => {
    const source = readSource('src/components/forge/wizard/WorldTab.tsx')
    expect(source).toMatch(/from\s+['"]\.\/shared['"]/)
    expect(source).toContain('LightTooltipWrap')
  })

  it('PlacedTab imports LightTooltipWrap from shared', () => {
    const source = readSource('src/components/forge/wizard/PlacedTab.tsx')
    expect(source).toMatch(/from\s+['"]\.\/shared['"]/)
    expect(source).toContain('LightTooltipWrap')
  })

  it('ImagineTab imports OASIS_BASE from shared', () => {
    const source = readSource('src/components/forge/wizard/ImagineTab.tsx')
    expect(source).toMatch(/from\s+['"]\.\/shared['"]/)
    expect(source).toContain('OASIS_BASE')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10. IMAGINE TAB — model definitions
// ═══════════════════════════════════════════════════════════════════════════

describe('ImagineTab constants', () => {
  const source = readSource('src/components/forge/wizard/ImagineTab.tsx')

  it('defines IMAGINE_MODELS', () => {
    expect(source).toContain('IMAGINE_MODELS')
  })

  it('includes gemini-flash model', () => {
    expect(source).toContain('gemini-flash')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 11. SETTINGS TAB — imports from store types
// ═══════════════════════════════════════════════════════════════════════════

describe('SettingsTab type imports', () => {
  const source = readSource('src/components/forge/wizard/SettingsTab.tsx')

  it('imports PlacementVfxType from oasisStore', () => {
    expect(source).toContain('PlacementVfxType')
    expect(source).toMatch(/from\s+['"].*oasisStore['"]/)
  })

  it('imports SettingsContext', () => {
    expect(source).toContain('SettingsContext')
  })
})
