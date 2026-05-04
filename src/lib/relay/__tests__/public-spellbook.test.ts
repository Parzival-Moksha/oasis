import { describe, expect, it } from 'vitest'

import {
  PUBLIC_TOOL_NAMES,
  isPublicToolName,
  requiredScopeForPublicTool,
} from '../public-spellbook.js'

describe('hosted public spellbook', () => {
  it('exposes self-craft guide and direct self-craft, but not broad prompt craft_scene', () => {
    expect(PUBLIC_TOOL_NAMES).toContain('get_craft_guide')
    expect(PUBLIC_TOOL_NAMES).toContain('self_craft_scene')
    expect(isPublicToolName('craft_scene')).toBe(false)
  })

  it('assigns safe hosted scopes to self-craft tools', () => {
    expect(requiredScopeForPublicTool('get_craft_guide')).toBe('world.read')
    expect(requiredScopeForPublicTool('self_craft_scene')).toBe('world.write.safe')
  })
})
