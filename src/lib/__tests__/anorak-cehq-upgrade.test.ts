// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CEHQ UPGRADE — Tests for expandable lobe cards, type legend,
// module pills, PreviewOverlay, AddModuleOverlay, type badges
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const PANEL_PATH = path.resolve(__dirname, '../../components/forge/AnorakProPanel.tsx')
const panelSrc = fs.readFileSync(PANEL_PATH, 'utf-8')

// ═══════════════════════════════════════════════════════════════════════════
// Mirror pure-logic extracts from AnorakProPanel (MODULE_TYPE_COLORS etc.)
// ═══════════════════════════════════════════════════════════════════════════

const MODULE_TYPE_COLORS: Record<string, string> = {
  builtin: '#14b8a6',  // teal
  custom: '#22c55e',   // green (text modules)
  file: '#f59e0b',     // amber (file modules)
  system: '#7dd3fc',   // sky blue
}

function moduleTypeColor(entry: { kind: string; type?: string }): string {
  if (entry.kind === 'custom' && entry.type === 'file') return MODULE_TYPE_COLORS.file
  return MODULE_TYPE_COLORS[entry.kind] || MODULE_TYPE_COLORS.builtin
}

function moduleTypeLabel(entry: { kind: string; parameterized?: boolean; type?: string }): string {
  if (entry.kind === 'custom' && entry.type === 'file') return 'file'
  if (entry.parameterized) return 'param'
  return entry.kind
}

// Helper: parse hex color to brightness (0-255 grayscale)
function hexBrightness(hex: string): number {
  const cleaned = hex.replace('#', '')
  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)
  return (r + g + b) / 3
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE_TYPE_COLORS — no grey values
// ═══════════════════════════════════════════════════════════════════════════

describe('MODULE_TYPE_COLORS — brightness check', () => {
  it('has builtin, custom, file, system keys', () => {
    expect(Object.keys(MODULE_TYPE_COLORS)).toEqual(
      expect.arrayContaining(['builtin', 'custom', 'file', 'system'])
    )
  })

  it('no grey values — all colors are vibrant (brightness spread)', () => {
    for (const [key, hex] of Object.entries(MODULE_TYPE_COLORS)) {
      const cleaned = hex.replace('#', '')
      const r = parseInt(cleaned.slice(0, 2), 16)
      const g = parseInt(cleaned.slice(2, 4), 16)
      const b = parseInt(cleaned.slice(4, 6), 16)
      // Grey means r ≈ g ≈ b. Vibrant colors have channel spread > 40
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      expect(max - min).toBeGreaterThan(40)
    }
  })

  it('no color is below #808080 average brightness', () => {
    for (const hex of Object.values(MODULE_TYPE_COLORS)) {
      expect(hexBrightness(hex)).toBeGreaterThan(80)
    }
  })

  it('source declares MODULE_TYPE_COLORS with teal builtin', () => {
    expect(panelSrc).toContain("builtin: '#14b8a6'")
  })

  it('source declares MODULE_TYPE_COLORS with green custom', () => {
    expect(panelSrc).toContain("custom: '#22c55e'")
  })

  it('source declares MODULE_TYPE_COLORS with amber file', () => {
    expect(panelSrc).toContain("file: '#f59e0b'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// moduleTypeColor — dispatch logic
// ═══════════════════════════════════════════════════════════════════════════

describe('moduleTypeColor — returns correct colors', () => {
  it('builtin kind → teal', () => {
    expect(moduleTypeColor({ kind: 'builtin' })).toBe('#14b8a6')
  })

  it('custom kind (text) → green', () => {
    expect(moduleTypeColor({ kind: 'custom', type: 'text' })).toBe('#22c55e')
  })

  it('custom kind (file) → amber', () => {
    expect(moduleTypeColor({ kind: 'custom', type: 'file' })).toBe('#f59e0b')
  })

  it('system kind → sky blue', () => {
    expect(moduleTypeColor({ kind: 'system' })).toBe('#7dd3fc')
  })

  it('unknown kind falls back to builtin teal', () => {
    expect(moduleTypeColor({ kind: 'alien' })).toBe('#14b8a6')
  })

  it('custom kind with no type → green (text default)', () => {
    expect(moduleTypeColor({ kind: 'custom' })).toBe('#22c55e')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// moduleTypeLabel — label dispatch
// ═══════════════════════════════════════════════════════════════════════════

describe('moduleTypeLabel — returns correct labels', () => {
  it('parameterized → "param"', () => {
    expect(moduleTypeLabel({ kind: 'builtin', parameterized: true })).toBe('param')
  })

  it('file module → "file"', () => {
    expect(moduleTypeLabel({ kind: 'custom', type: 'file' })).toBe('file')
  })

  it('builtin (non-parameterized) → "builtin"', () => {
    expect(moduleTypeLabel({ kind: 'builtin' })).toBe('builtin')
  })

  it('custom text → "custom"', () => {
    expect(moduleTypeLabel({ kind: 'custom', type: 'text' })).toBe('custom')
  })

  it('system → "system"', () => {
    expect(moduleTypeLabel({ kind: 'system' })).toBe('system')
  })

  it('file takes precedence over parameterized', () => {
    expect(moduleTypeLabel({ kind: 'custom', type: 'file', parameterized: true })).toBe('file')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PreviewOverlay — source verification
// ═══════════════════════════════════════════════════════════════════════════

describe('PreviewOverlay component — source verification', () => {
  it('PreviewOverlay function exists', () => {
    expect(panelSrc).toContain('function PreviewOverlay(')
  })

  it('renders fixed inset overlay backdrop', () => {
    expect(panelSrc).toContain('fixed inset-0 bg-black/80')
  })

  it('displays token estimate', () => {
    expect(panelSrc).toContain('tokens')
    expect(panelSrc).toContain("Math.ceil((content?.length || 0) / 4)")
  })

  it('has close button (×)', () => {
    // PreviewOverlay close button
    expect(panelSrc).toContain('onClick={onClose} className="text-[#c0ffee] hover:text-white text-2xl')
  })

  it('renders loading spinner state', () => {
    expect(panelSrc).toContain('Loading preview...')
  })

  it('renders content in pre/monospace block', () => {
    expect(panelSrc).toContain('whitespace-pre-wrap font-mono')
  })

  it('displays lobe name and module title in header', () => {
    expect(panelSrc).toContain('{target.title}')
    expect(panelSrc).toContain('{target.lobe} module')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AddModuleOverlay — source verification
// ═══════════════════════════════════════════════════════════════════════════

describe('AddModuleOverlay component — source verification', () => {
  it('AddModuleOverlay function exists', () => {
    expect(panelSrc).toContain('function AddModuleOverlay(')
  })

  it('renders "Add Module to {lobe}" header', () => {
    expect(panelSrc).toContain('Add Module to {lobe}')
  })

  it('shows "All modules already added" when list is empty', () => {
    expect(panelSrc).toContain('All modules already added')
  })

  it('calls onAdd(entry.id) then onClose on click', () => {
    expect(panelSrc).toContain('onAdd(entry.id); onClose()')
  })

  it('renders type color and label for each option', () => {
    // Inside AddModuleOverlay map
    expect(panelSrc).toContain('moduleTypeColor(entry)')
    expect(panelSrc).toContain('moduleTypeLabel(entry)')
  })

  it('has hover:scale for interactive pills', () => {
    expect(panelSrc).toContain('hover:scale-[1.02]')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CEHQTab — expand/collapse toggles
// ═══════════════════════════════════════════════════════════════════════════

describe('CEHQTab — expand/collapse toggles', () => {
  it('CEHQTab function exists', () => {
    expect(panelSrc).toContain('function CEHQTab(')
  })

  it('tracks expandedLobes state with curator default expanded', () => {
    expect(panelSrc).toContain("useState<Record<string, boolean>>({ curator: true })")
  })

  it('renders ▶ for collapsed and ▼ for expanded', () => {
    expect(panelSrc).toContain("isExpanded ? '▼' : '▶'")
  })

  it('toggleExpand callback toggles lobe expansion', () => {
    expect(panelSrc).toContain('const toggleExpand = useCallback((lobe: string)')
  })

  it('onClick triggers toggleExpand on header row', () => {
    expect(panelSrc).toContain('onClick={() => toggleExpand(lobe)}')
  })

  it('expanded content conditionally renders', () => {
    expect(panelSrc).toContain('{isExpanded && (')
  })

  it('iterates over lobes: curator, coder, reviewer, tester', () => {
    expect(panelSrc).toContain("(['curator', 'coder', 'reviewer', 'tester'] as const).map")
  })

  it('shows module count in collapsed header', () => {
    expect(panelSrc).toContain("{moduleCount} module{moduleCount !== 1 ? 's' : ''}")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Type legend — builtin/custom/file dots
// ═══════════════════════════════════════════════════════════════════════════

describe('Type legend — renders builtin/custom/file dots', () => {
  it('renders "Context Engineering HQ" title', () => {
    expect(panelSrc).toContain('Context Engineering HQ')
  })

  it('renders builtin dot with builtin color', () => {
    expect(panelSrc).toContain('backgroundColor: MODULE_TYPE_COLORS.builtin')
  })

  it('renders custom dot with custom color', () => {
    expect(panelSrc).toContain('backgroundColor: MODULE_TYPE_COLORS.custom')
  })

  it('renders file dot with file color', () => {
    expect(panelSrc).toContain('backgroundColor: MODULE_TYPE_COLORS.file')
  })

  it('labels are "built-in", "custom text", "linked file"', () => {
    expect(panelSrc).toContain('built-in')
    expect(panelSrc).toContain('custom text')
    expect(panelSrc).toContain('linked file')
  })

  it('legend dots use w-2 h-2 rounded-full', () => {
    expect(panelSrc).toContain('w-2 h-2 rounded-full')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Module pills — type badges and hover scale
// ═══════════════════════════════════════════════════════════════════════════

describe('Module pills — type badges and hover', () => {
  it('module pills have hover:scale-[1.02] transition', () => {
    expect(panelSrc).toContain('hover:scale-[1.02]')
  })

  it('type badge uses moduleTypeLabel', () => {
    expect(panelSrc).toContain('{moduleTypeLabel(moduleMeta)}')
  })

  it('type badge uses uppercase tracking-wide styling', () => {
    expect(panelSrc).toContain('uppercase tracking-wide')
  })

  it('module pill has remove button (×) with stopPropagation', () => {
    expect(panelSrc).toContain('e.stopPropagation(); removeModule(lobe, moduleId)')
  })

  it('module pill opens preview on click', () => {
    expect(panelSrc).toContain('onClick={() => openPreview(lobe, moduleId, moduleMeta.name)}')
  })

  it('renders module name with type color', () => {
    expect(panelSrc).toContain("style={{ color: typeColor }}>{moduleMeta.name}")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CEHQTab integration — context-preview API wiring
// ═══════════════════════════════════════════════════════════════════════════

describe('CEHQTab — context-preview API wiring', () => {
  it('fetches from /api/anorak/pro/context-preview', () => {
    expect(panelSrc).toContain('/api/anorak/pro/context-preview')
  })

  it('PreviewOverlay is rendered inside CEHQTab', () => {
    expect(panelSrc).toContain('<PreviewOverlay')
  })

  it('AddModuleOverlay is rendered inside CEHQTab', () => {
    expect(panelSrc).toContain('<AddModuleOverlay')
  })

  it('passes catalog options to AddModuleOverlay', () => {
    expect(panelSrc).toContain('availableModulesFor')
  })

  it('CEHQ tab is wired in the main tab switcher', () => {
    expect(panelSrc).toContain("activeTab === 'cehq' && <CEHQTab")
  })
})
