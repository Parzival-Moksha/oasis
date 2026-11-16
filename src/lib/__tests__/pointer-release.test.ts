// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The page objects pointer-release.ts touches, enough for node: EventTargets standing in for document, window, elements.
class FakeElement extends EventTarget { releasePointerCapture = vi.fn() }
const doc = Object.assign(new EventTarget(), { pointerLockElement: null as unknown, exitPointerLock: vi.fn() })
beforeAll(() => {
  Object.assign(globalThis, { document: doc, window: new EventTarget(), Element: FakeElement })
})

const { freeMouse, heldCaptures, installPointerRelease, lockRequestPending, noteLockRequested, noteLockSettled } = await import('../pointer-release')

const pointerEvent = (type: string, pointerId: number) => Object.assign(new Event(type, { bubbles: true }), { pointerId })
const escapeUp = () => Object.assign(new Event('keyup'), { key: 'Escape' })

describe('Escape always gives the mouse back', () => {
  let uninstall: (() => void) | null = null
  afterEach(() => { uninstall?.(); uninstall = null; noteLockSettled(); doc.pointerLockElement = null; doc.exitPointerLock.mockReset() })

  it('one pointer-lock request at a time: pending until the browser answers, or 1.5 s', () => {
    noteLockRequested(1000)
    expect(lockRequestPending(1200)).toBe(true)
    expect(lockRequestPending(2600)).toBe(false)
    noteLockRequested(5000)
    noteLockSettled()
    expect(lockRequestPending(5001)).toBe(false)
  })

  it('releases a held pointer capture (a drag that never ended)', () => {
    uninstall = installPointerRelease()
    const grip = new FakeElement()
    const got = pointerEvent('gotpointercapture', 7)
    Object.defineProperty(got, 'target', { value: grip })
    doc.dispatchEvent(got)
    expect(heldCaptures()).toBe(1)
    ;(globalThis as unknown as { window: EventTarget }).window.dispatchEvent(escapeUp())
    expect(grip.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(heldCaptures()).toBe(0)
  })

  it('exits a pointer lock, and a lock still on its way is given back when it lands', () => {
    uninstall = installPointerRelease()
    noteLockRequested()
    expect(freeMouse()).toEqual(['a pending pointer lock'])
    doc.pointerLockElement = {}
    doc.dispatchEvent(new Event('pointerlockchange'))
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1)
    expect(freeMouse()).toEqual(['pointer lock'])
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(2)
  })
})
