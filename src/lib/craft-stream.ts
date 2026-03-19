// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PARTIAL JSON EXTRACTOR — panning for gold in the token stream
// ─═̷─═̷─ॐ─═̷─═̷─ Brace-depth state machine ─═̷─═̷─ॐ─═̷─═̷─
// The LLM streams JSON token by token. Mid-stream, the JSON is broken.
// But we can find COMPLETE {...} blocks inside the "objects" array
// by tracking brace depth. Every time depth returns to 0, we have
// a parseable object that we can validate and render immediately.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import type { CraftedPrimitive, PrimitiveType, CraftAnimation, CraftAnimationType } from './conjure/types'

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION — same logic as /api/craft but for individual primitives
// ═══════════════════════════════════════════════════════════════════════════

const VALID_TYPES: PrimitiveType[] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule', 'text']
const VALID_ANIM_TYPES: CraftAnimationType[] = ['rotate', 'bob', 'pulse', 'swing', 'orbit']
const VALID_AXES = ['x', 'y', 'z'] as const

function validateAnimation(raw: unknown): CraftAnimation | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Record<string, unknown>
  if (typeof a.type !== 'string' || !VALID_ANIM_TYPES.includes(a.type as CraftAnimationType)) return undefined
  return {
    type: a.type as CraftAnimationType,
    ...(typeof a.speed === 'number' && { speed: Math.max(0.1, Math.min(10, a.speed)) }),
    ...(typeof a.axis === 'string' && VALID_AXES.includes(a.axis as typeof VALID_AXES[number]) && { axis: a.axis as 'x' | 'y' | 'z' }),
    ...(typeof a.amplitude === 'number' && { amplitude: Math.max(0.01, Math.min(20, a.amplitude)) }),
  }
}

export function validatePrimitive(raw: unknown): CraftedPrimitive | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const type = o.type as string
  if (!VALID_TYPES.includes(type as PrimitiveType)) return null

  const position = Array.isArray(o.position) && o.position.length === 3
    ? o.position.map(Number) as [number, number, number]
    : [0, 0.5, 0] as [number, number, number]

  const scale = Array.isArray(o.scale) && o.scale.length === 3
    ? o.scale.map(Number) as [number, number, number]
    : [1, 1, 1] as [number, number, number]

  const rotation = Array.isArray(o.rotation) && o.rotation.length === 3
    ? o.rotation.map(Number) as [number, number, number]
    : undefined

  const color = typeof o.color === 'string' && o.color.startsWith('#') ? o.color : '#888888'
  const animation = validateAnimation(o.animation)

  // Filter parasitic ground planes inline
  const [, py] = position
  const [sx, sy, sz] = scale
  if ((type === 'plane' || type === 'box') && Math.min(sx, sy, sz) < 0.15 && py < 0.15) {
    const sorted = [sx, sy, sz].sort((a, b) => a - b)
    if (sorted[1] * sorted[2] > 3) return null // large flat thing at ground level = parasitic
  }

  return {
    type: type as PrimitiveType,
    position,
    scale,
    color,
    ...(rotation && { rotation }),
    ...(typeof o.metalness === 'number' && { metalness: Math.max(0, Math.min(1, o.metalness)) }),
    ...(typeof o.roughness === 'number' && { roughness: Math.max(0, Math.min(1, o.roughness)) }),
    ...(typeof o.emissive === 'string' && o.emissive.startsWith('#') && { emissive: o.emissive }),
    ...(typeof o.emissiveIntensity === 'number' && { emissiveIntensity: Math.max(0, Math.min(5, o.emissiveIntensity)) }),
    ...(typeof o.opacity === 'number' && { opacity: Math.max(0, Math.min(1, o.opacity)) }),
    ...(animation && { animation }),
    ...(type === 'text' && typeof o.text === 'string' && { text: o.text.slice(0, 500) }),
    ...(type === 'text' && typeof o.fontSize === 'number' && { fontSize: Math.max(0.1, Math.min(20, o.fontSize)) }),
    ...(type === 'text' && typeof o.anchorX === 'string' && ['left', 'center', 'right'].includes(o.anchorX) && { anchorX: o.anchorX as 'left' | 'center' | 'right' }),
    ...(type === 'text' && typeof o.anchorY === 'string' && ['top', 'middle', 'bottom'].includes(o.anchorY) && { anchorY: o.anchorY as 'top' | 'middle' | 'bottom' }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTIAL EXTRACTION — the brace-depth state machine
// ═══════════════════════════════════════════════════════════════════════════

export interface PartialCraftResult {
  name: string | null
  objects: CraftedPrimitive[]
}

/**
 * Extract scene name and all COMPLETE objects from a partial JSON stream.
 *
 * The LLM outputs: {"name":"Castle","objects":[{...},{...},{...}]}
 * Mid-stream we might have: {"name":"Castle","objects":[{...},{...},{"type":"co
 *
 * This function:
 * 1. Extracts the scene name via regex (appears early in the stream)
 * 2. Finds the "objects": [ boundary
 * 3. Scans for complete {...} blocks using brace-depth tracking
 * 4. Validates each complete object and returns all valid ones
 */
export function extractPartialCraftData(accumulated: string): PartialCraftResult {
  // Extract name — appears before objects array
  const nameMatch = accumulated.match(/"name"\s*:\s*"([^"]*)"/)
  const name = nameMatch ? nameMatch[1] : null

  // Find the objects array start
  const objectsIdx = accumulated.indexOf('"objects"')
  if (objectsIdx === -1) return { name, objects: [] }

  const bracketStart = accumulated.indexOf('[', objectsIdx)
  if (bracketStart === -1) return { name, objects: [] }

  // Scan for complete {...} blocks inside the array
  const objects: CraftedPrimitive[] = []
  let i = bracketStart + 1

  while (i < accumulated.length) {
    // Skip whitespace and commas
    while (i < accumulated.length && ' \n\r\t,'.includes(accumulated[i])) i++

    if (i >= accumulated.length || accumulated[i] === ']') break

    if (accumulated[i] === '{') {
      const objEnd = findMatchingBrace(accumulated, i)
      if (objEnd === -1) break // incomplete object — stop here

      const objStr = accumulated.slice(i, objEnd + 1)
      try {
        const parsed = JSON.parse(objStr)
        const validated = validatePrimitive(parsed)
        if (validated) objects.push(validated)
      } catch {
        // malformed — skip this object
      }
      i = objEnd + 1
    } else {
      i++ // unexpected char — skip
    }
  }

  return { name, objects }
}

/**
 * Find the matching closing brace for an opening brace at position `start`.
 * Handles nested braces and string escaping.
 * Returns the index of the closing `}`, or -1 if not yet complete.
 */
function findMatchingBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false

  for (let j = start; j < text.length; j++) {
    const ch = text[j]

    if (escaped) { escaped = false; continue }
    if (ch === '\\' && inString) { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return j
    }
  }

  return -1 // not yet complete
}
