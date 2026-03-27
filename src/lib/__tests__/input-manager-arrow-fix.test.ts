// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ARROW BUG FIX TESTS — Non-text inputs excluded from keyboard capture
// Verifies range/color/checkbox/radio/file/button/image/reset/submit
// don't block arrow keys, while text/number inputs still capture keys.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// NON_TEXT_INPUT_TYPES membership — input-manager.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('NON_TEXT_INPUT_TYPES in input-manager.ts', () => {
  // Read source to verify the set contents
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'input-manager.ts'),
    'utf-8',
  )

  // Extract the set literal from source
  const match = src.match(/NON_TEXT_INPUT_TYPES\s*=\s*new\s+Set\(\[([^\]]+)\]\)/)
  const setContents = match ? match[1] : ''

  const expectedTypes = ['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit']

  for (const t of expectedTypes) {
    it(`includes '${t}'`, () => {
      expect(setContents).toContain(`'${t}'`)
    })
  }

  it('does NOT include text', () => {
    // 'text' should NOT be in the set — text inputs must block shortcuts
    expect(setContents).not.toMatch(/\btext\b/)
  })

  it('does NOT include number', () => {
    expect(setContents).not.toMatch(/\bnumber\b/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// focusin handler in input-manager.ts — excludes non-text inputs
// ═══════════════════════════════════════════════════════════════════════════

describe('focusin handler excludes non-text inputs (source verification)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'input-manager.ts'),
    'utf-8',
  )

  it('checks NON_TEXT_INPUT_TYPES before entering ui-focused', () => {
    // The onFocusIn handler should check the set before calling enterUIFocus
    expect(src).toContain('NON_TEXT_INPUT_TYPES.has')
  })

  it('returns early (skips enterUIFocus) for non-text inputs', () => {
    // Pattern: if (NON_TEXT_INPUT_TYPES.has(...)) return
    expect(src).toMatch(/NON_TEXT_INPUT_TYPES\.has\(.*\)\s*\)\s*return/)
  })

  it('still calls enterUIFocus for TEXTAREA and SELECT', () => {
    // TEXTAREA and SELECT are handled in the else-if branch — no NON_TEXT check
    expect(src).toMatch(/tag\s*===\s*'TEXTAREA'/)
    expect(src).toMatch(/tag\s*===\s*'SELECT'/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// isTyping guard in WorldObjects.tsx — excludes non-text inputs
// ═══════════════════════════════════════════════════════════════════════════

describe('isTyping guard in WorldObjects.tsx', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'components', 'forge', 'WorldObjects.tsx'),
    'utf-8',
  )

  it('defines NON_TEXT_INPUTS set', () => {
    expect(src).toContain("NON_TEXT_INPUTS = new Set([")
  })

  const expectedTypes = ['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit']

  for (const t of expectedTypes) {
    it(`NON_TEXT_INPUTS includes '${t}'`, () => {
      // Extract the WorldObjects set contents
      const match = src.match(/NON_TEXT_INPUTS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/)
      const contents = match ? match[1] : ''
      expect(contents).toContain(`'${t}'`)
    })
  }

  it('isTyping excludes non-text inputs via set check', () => {
    // Pattern: tag === 'INPUT' && !NON_TEXT_INPUTS.has(...)
    expect(src).toMatch(/tag\s*===\s*'INPUT'\s*&&\s*!NON_TEXT_INPUTS\.has/)
  })

  it('isTyping still blocks for TEXTAREA', () => {
    expect(src).toMatch(/tag\s*===\s*'TEXTAREA'/)
  })

  it('isTyping still blocks for SELECT', () => {
    expect(src).toMatch(/tag\s*===\s*'SELECT'/)
  })

  it('isTyping still blocks for contentEditable', () => {
    expect(src).toContain('isContentEditable')
  })

  it('does NOT exclude text or number inputs (they still block shortcuts)', () => {
    const match = src.match(/NON_TEXT_INPUTS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/)
    const contents = match ? match[1] : ''
    expect(contents).not.toMatch(/\btext\b/)
    expect(contents).not.toMatch(/\bnumber\b/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// focusin handler logic flow — verify the guard structure in source
// ═══════════════════════════════════════════════════════════════════════════

describe('focusin handler logic flow (source verification)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'input-manager.ts'),
    'utf-8',
  )

  // Extract the onFocusIn handler body
  const focusInStart = src.indexOf('const onFocusIn')
  const focusInEnd = src.indexOf('const onFocusOut')
  const focusInBody = src.slice(focusInStart, focusInEnd)

  it('text inputs (no type match) still trigger enterUIFocus', () => {
    // The handler calls enterUIFocus() for INPUT when type is NOT in the set
    // text/number/email/etc. will pass through the guard and call enterUIFocus
    expect(focusInBody).toContain('enterUIFocus()')
  })

  it('non-text input types return early before enterUIFocus', () => {
    // The return statement comes BEFORE enterUIFocus for INPUT elements
    const returnIdx = focusInBody.indexOf('NON_TEXT_INPUT_TYPES.has')
    const enterIdx = focusInBody.indexOf('enterUIFocus()')
    expect(returnIdx).toBeLessThan(enterIdx)
    expect(returnIdx).toBeGreaterThan(-1)
  })

  it('TEXTAREA triggers enterUIFocus (no NON_TEXT check)', () => {
    // TEXTAREA is in the else-if branch, unconditionally enters ui-focused
    expect(focusInBody).toContain("tag === 'TEXTAREA'")
  })

  it('SELECT triggers enterUIFocus (no NON_TEXT check)', () => {
    expect(focusInBody).toContain("tag === 'SELECT'")
  })

  it('contentEditable triggers enterUIFocus', () => {
    expect(focusInBody).toContain('isContentEditable')
  })

  it('canvas elements are excluded via closest check', () => {
    expect(focusInBody).toContain("el.closest('#uploader-canvas')")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SelectableWrapper onClick — includes document.activeElement.blur()
// ═══════════════════════════════════════════════════════════════════════════

describe('SelectableWrapper onClick includes blur()', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'components', 'forge', 'WorldObjects.tsx'),
    'utf-8',
  )

  it('calls document.activeElement.blur() in onClick handler', () => {
    // The onClick handler in SelectableWrapper should blur the active element
    // to break the ui-focused trance when clicking on 3D objects
    expect(src).toContain('document.activeElement.blur()')
  })

  it('checks activeElement instanceof HTMLElement before blur', () => {
    expect(src).toContain('document.activeElement instanceof HTMLElement')
  })

  it('blur happens inside the onClick of SelectableWrapper group', () => {
    // Verify the blur is inside the SelectableWrapper function
    const swStart = src.indexOf('export function SelectableWrapper')
    const swEnd = src.indexOf('\nexport ', swStart + 1)
    const swBody = src.slice(swStart, swEnd > -1 ? swEnd : undefined)
    expect(swBody).toContain('document.activeElement.blur()')
    expect(swBody).toContain('onClick')
  })
})
