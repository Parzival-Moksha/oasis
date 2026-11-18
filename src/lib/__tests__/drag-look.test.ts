import { beforeEach, describe, expect, it } from 'vitest'

import { DRAG_START_PX, createDragTracker, isDragLookOn, noteLockFailed, noteLockGranted, resetDragLook, softwareRendererName } from '../drag-look'

describe('drag look switches on only when this browser cannot lock', () => {
  beforeEach(() => resetDragLook())

  it('needs two refusals and no lock ever', () => {
    expect(noteLockFailed('refused')).toBe(false)
    expect(noteLockFailed('no answer')).toBe(true)
    expect(isDragLookOn()).toBe(true)
  })

  it('a browser that locked before is only cooling down (Esc then a quick click): no switch', () => {
    noteLockGranted()
    noteLockFailed('refused'); noteLockFailed('refused'); noteLockFailed('refused')
    expect(isDragLookOn()).toBe(false)
  })

  it('a lock that works after all turns it off again', () => {
    noteLockFailed('a'); noteLockFailed('b')
    noteLockGranted()
    expect(isDragLookOn()).toBe(false)
  })
})

describe('the drag gesture', () => {
  const at = (clientX: number, clientY: number, movementX = 0, movementY = 0) => ({ clientX, clientY, movementX, movementY, pointerId: 1 })

  it('right button turns at once and never swallows a click', () => {
    const t = createDragTracker()
    t.down({ button: 2, clientX: 0, clientY: 0, pointerId: 1 })
    expect(t.move(at(3, 0, 3, 0))).toEqual({ x: 3, y: 0 })
    t.up({ pointerId: 1 })
    expect(t.takeSwallowClick()).toBe(false)
  })

  it('left button: a click stays a click; a drag turns and swallows the click after it', () => {
    const t = createDragTracker()
    t.down({ button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    expect(t.move(at(11, 10, 1, 0))).toEqual({ x: 0, y: 0 })
    t.up({ pointerId: 1 })
    expect(t.takeSwallowClick()).toBe(false)

    t.down({ button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    expect(t.move(at(10 + DRAG_START_PX + 2, 10, 6, 0))).toEqual({ x: DRAG_START_PX + 2, y: 0 })
    expect(t.move(at(20, 12, 4, 2))).toEqual({ x: 4, y: 2 })
    t.up({ pointerId: 1 })
    expect(t.takeSwallowClick()).toBe(true)
    expect(t.takeSwallowClick()).toBe(false)
  })
})

describe('software rendering', () => {
  it('names the renderers that mean no GPU', () => {
    expect(softwareRendererName('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe('SwiftShader')
    expect(softwareRendererName('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)')).toContain('WARP')
    expect(softwareRendererName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBeNull()
  })
})
