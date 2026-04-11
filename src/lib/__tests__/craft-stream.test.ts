import { describe, it, expect } from 'vitest'
import { extractPartialCraftData, validatePrimitive } from '../craft-stream'

// ═══════════════════════════════════════════════════════════════════════════
// CODE FENCE STRIPPING — Claude Code models wrap JSON in ```json ... ```
// ═══════════════════════════════════════════════════════════════════════════

describe('extractPartialCraftData — code fence stripping', () => {
  it('strips single ```json fence and parses objects', () => {
    const input = '```json\n{"name":"Test","objects":[{"type":"box","position":[0,0.5,0],"scale":[1,1,1],"color":"#888888"}]}\n```'
    const result = extractPartialCraftData(input)
    expect(result.name).toBe('Test')
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0].type).toBe('box')
  })

  it('strips bare ``` fence (no json tag)', () => {
    const input = '```\n{"name":"Bare","objects":[{"type":"sphere","position":[0,0.5,0],"scale":[1,1,1],"color":"#ff0000"}]}\n```'
    const result = extractPartialCraftData(input)
    expect(result.name).toBe('Bare')
    expect(result.objects).toHaveLength(1)
  })

  it('concatenates multiple fence blocks', () => {
    // Two separate fences whose contents together form valid JSON
    const block1 = '{"name":"Multi","objects":[{"type":"box","position":[0,0.5,0],"scale":[1,1,1],"color":"#aaa"}'
    const block2 = ',{"type":"sphere","position":[2,0.5,0],"scale":[1,1,1],"color":"#bbb"}]}'
    const input = `Here is part 1:\n\`\`\`json\n${block1}\n\`\`\`\nAnd part 2:\n\`\`\`json\n${block2}\n\`\`\``
    const result = extractPartialCraftData(input)
    expect(result.name).toBe('Multi')
    expect(result.objects).toHaveLength(2)
    expect(result.objects[0].type).toBe('box')
    expect(result.objects[1].type).toBe('sphere')
  })

  it('leaves raw JSON unchanged when no fences present', () => {
    const input = '{"name":"NoFence","objects":[{"type":"cylinder","position":[0,1,0],"scale":[0.5,2,0.5],"color":"#00ff00"}]}'
    const result = extractPartialCraftData(input)
    expect(result.name).toBe('NoFence')
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0].type).toBe('cylinder')
  })

  it('handles partial fence mid-stream (no closing ```)', () => {
    // No closing ``` — global regex won't match, falls through to raw
    const input = '```json\n{"name":"Partial","objects":[{"type":"box","position":[0,0.5,0],"scale":[1,1,1],"color":"#888"}'
    const result = extractPartialCraftData(input)
    // Raw input starts with ``` so parsing is best-effort
    expect(result).toBeDefined()
    expect(result.objects).toBeDefined()
  })

  it('handles empty fences as no-op', () => {
    const input = '```json\n\n```'
    const result = extractPartialCraftData(input)
    expect(result.name).toBeNull()
    expect(result.objects).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// BRACE-DEPTH PARSING — incremental JSON extraction
// ═══════════════════════════════════════════════════════════════════════════

describe('extractPartialCraftData — brace-depth parsing', () => {
  it('extracts complete objects from truncated stream', () => {
    const input = '{"name":"Castle","objects":[{"type":"box","position":[0,2,0],"scale":[5,4,0.3],"color":"#888888"},{"type":"co'
    const result = extractPartialCraftData(input)
    expect(result.name).toBe('Castle')
    expect(result.objects).toHaveLength(1) // only the complete box
    expect(result.objects[0].type).toBe('box')
  })

  it('handles nested objects like animation sub-objects', () => {
    const input = '{"name":"Animated","objects":[{"type":"box","position":[0,0.5,0],"scale":[1,1,1],"color":"#888","animation":{"type":"rotate","speed":1,"axis":"y"}}]}'
    const result = extractPartialCraftData(input)
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0].animation?.type).toBe('rotate')
  })

  it('returns empty when no objects key found yet', () => {
    const input = '{"name":"Early'
    const result = extractPartialCraftData(input)
    expect(result.name).toBeNull() // name quote is incomplete
    expect(result.objects).toHaveLength(0)
  })

  it('extracts scene name even when objects array is still streaming', () => {
    const input = '{"name":"My Cool Scene","objects":['
    const result = extractPartialCraftData(input)
    expect(result.name).toBe('My Cool Scene')
    expect(result.objects).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATE PRIMITIVE — field validation and clamping
// ═══════════════════════════════════════════════════════════════════════════

describe('validatePrimitive', () => {
  it('rejects invalid primitive types', () => {
    expect(validatePrimitive({ type: 'invalid', position: [0, 0, 0], scale: [1, 1, 1], color: '#888' })).toBeNull()
  })

  it('accepts valid geometric primitive types', () => {
    for (const type of ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule']) {
      const result = validatePrimitive({ type, position: [0, 0.5, 0], scale: [1, 1, 1], color: '#888' })
      expect(result, `${type} should be valid`).not.toBeNull()
      expect(result!.type).toBe(type)
    }
  })

  it('accepts valid shader primitive types', () => {
    for (const type of ['flame', 'flag', 'crystal', 'water', 'particle_emitter', 'glow_orb', 'aurora']) {
      const result = validatePrimitive({ type, position: [0, 1, 0], scale: [0.5, 0.5, 0.5], color: '#FFFFDD' })
      expect(result, `${type} should be valid`).not.toBeNull()
      expect(result!.type).toBe(type)
    }
  })

  it('clamps values within valid ranges', () => {
    const prim = validatePrimitive({
      type: 'box', position: [0, 0, 0], scale: [1, 1, 1], color: '#888',
      metalness: 5, roughness: -1, emissiveIntensity: 10, opacity: 2,
    })
    expect(prim).not.toBeNull()
    expect(prim!.metalness).toBe(1)          // clamped from 5
    expect(prim!.roughness).toBe(0)          // clamped from -1
    expect(prim!.emissiveIntensity).toBe(2)  // clamped from 10
    expect(prim!.opacity).toBe(1)            // clamped from 2
  })

  it('provides default position and scale when missing', () => {
    const prim = validatePrimitive({ type: 'box', color: '#888' })
    expect(prim).not.toBeNull()
    expect(prim!.position).toEqual([0, 0.5, 0])
    expect(prim!.scale).toEqual([1, 1, 1])
  })

  it('defaults color to grey when invalid', () => {
    const prim = validatePrimitive({ type: 'box', position: [0, 0, 0], scale: [1, 1, 1], color: 'notacolor' })
    expect(prim).not.toBeNull()
    expect(prim!.color).toBe('#888888')
  })

  it('accepts valid texturePresetId for geometric primitives', () => {
    const prim = validatePrimitive({
      type: 'box', position: [0, 2, 0], scale: [5, 4, 0.3], color: '#ffffff',
      texturePresetId: 'stone', textureRepeat: 3,
    })
    expect(prim).not.toBeNull()
    expect(prim!.texturePresetId).toBe('stone')
    expect(prim!.textureRepeat).toBe(3)
  })

  it('rejects texturePresetId for shader primitives', () => {
    const prim = validatePrimitive({
      type: 'flame', position: [0, 1, 0], scale: [0.1, 0.3, 0.1], color: '#FFFFDD',
      texturePresetId: 'stone',
    })
    expect(prim).not.toBeNull()
    expect(prim!.texturePresetId).toBeUndefined()
  })

  it('rejects unknown texturePresetId', () => {
    const prim = validatePrimitive({
      type: 'box', position: [0, 0, 0], scale: [1, 1, 1], color: '#888',
      texturePresetId: 'nonexistent_texture',
    })
    expect(prim).not.toBeNull()
    expect(prim!.texturePresetId).toBeUndefined()
  })

  it('clamps textureRepeat to 1-50', () => {
    const prim = validatePrimitive({
      type: 'box', position: [0, 0, 0], scale: [1, 1, 1], color: '#888',
      texturePresetId: 'cobblestone', textureRepeat: 100,
    })
    expect(prim!.textureRepeat).toBe(50)
  })

  it('filters parasitic ground planes', () => {
    // Large flat box at ground level → parasitic, should be filtered
    const prim = validatePrimitive({
      type: 'box', position: [0, 0.05, 0], scale: [10, 0.1, 10], color: '#228B22',
    })
    expect(prim).toBeNull()
  })

  it('preserves text primitive fields', () => {
    const prim = validatePrimitive({
      type: 'text', position: [0, 2, 0], scale: [1, 1, 1], color: '#ff00ff',
      text: 'HELLO', fontSize: 2,
    })
    expect(prim).not.toBeNull()
    expect(prim!.text).toBe('HELLO')
    expect(prim!.fontSize).toBe(2)
  })
})
