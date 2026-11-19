// ░▒▓ POINTER RELEASE — Escape always gives the mouse back ▓▒░
// The owner's cursor got stuck in the upper-left two thirds of the screen (2026-11-16, Brave on a 125 % display
// at 90 % zoom). Inside a page only pointer lock can hold the cursor, and Chromium confines it to a rectangle
// that a scaling mix-up makes too small; every lock taken and dropped in a hurry is a chance for that. So:
// - one pointer-lock request at a time (a click used to ask twice, on pointerdown and on click);
// - Escape (on key up, so no menu swallows it) releases a lock, cancels a lock still on its way, releases every
//   pointer capture an element holds and ends that drag (pointercancel), whatever else Escape does;
// - leaving the window releases captures too (a drag interrupted by Alt+Tab never sees its pointerup), and the
//   page gives its pointer lock back itself when the window loses focus, the tab is hidden or the page unloads
//   (reload, navigation): the browser should, but a confinement it left behind followed the owner into other
//   apps (2026-11-17). The engine's clip watchdog (Windows) releases any that still slips through.
// - Held keys: the browser sends no keyup to a page that lost focus (Alt-Tab, a window popping up, the tab hidden).
//   W held while a console window flashed up stayed "held": the owner kept running until he hit W again (2026-11-19).
//   Every key down is noted; when focus goes, the page is hidden or pointer lock is lost, each one still down gets
//   a keyup (synthetic, on window): drei's KeyboardControls (walk, run, noclip, jump, sprint), the mana key, all.
// Pure bookkeeping plus the listeners; input-manager.ts installs it.

const PENDING_MS = 1500

let lockRequestedAt = -Infinity
let cancelLockUntil = -Infinity
const captures = new Map<number, Element>()
/** Keys down right now: code -> key (what a keyup for it needs). */
const heldKeys = new Map<string, string>()
let notify: ((what: string) => void) | null = null

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** A pointer-lock request is on its way (asked less than PENDING_MS ago, no answer yet). */
export function lockRequestPending(at = now()): boolean {
  return at - lockRequestedAt < PENDING_MS
}

export function noteLockRequested(at = now()): void {
  lockRequestedAt = at
}

/** The browser answered (locked, freed or refused). */
export function noteLockSettled(): void {
  lockRequestedAt = -Infinity
}

/** Something to tell the owner when Escape had to free the mouse (GlobalNotice; set by a component). */
export function setPointerReleaseNotifier(fn: ((what: string) => void) | null): void {
  notify = fn
}

export function heldCaptures(): number {
  return captures.size
}

/** Codes of the keys this page thinks are down (tests). */
export function heldKeyCodes(): string[] {
  return [...heldKeys.keys()]
}

/** Let go of every key still down: a keyup for each, as if it had been released here. Returns their codes. */
export function releaseHeldKeys(): string[] {
  const codes = [...heldKeys.keys()]
  if (typeof window === 'undefined' || !codes.length) return codes
  const keys = [...heldKeys.entries()]
  heldKeys.clear()
  for (const [code, key] of keys) {
    try { window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })) } catch { /* no KeyboardEvent */ }
  }
  return codes
}

/** Release whatever holds the mouse. Returns what was released (for the notice and the tests). */
export function freeMouse(at = now()): string[] {
  const freed: string[] = []
  if (typeof document === 'undefined') return freed
  if (document.pointerLockElement) {
    document.exitPointerLock()
    freed.push('pointer lock')
  }
  if (lockRequestPending(at)) {
    // The lock may still land: give it straight back when it does.
    cancelLockUntil = at + PENDING_MS
    noteLockSettled()
    freed.push('a pending pointer lock')
  }
  for (const [pointerId, element] of [...captures]) {
    captures.delete(pointerId)
    try { (element as Element & { releasePointerCapture(id: number): void }).releasePointerCapture(pointerId) } catch { /* already gone */ }
    try { element.dispatchEvent(new PointerEvent('pointercancel', { pointerId, bubbles: true })) } catch { /* no PointerEvent */ }
    freed.push('a drag')
  }
  return freed
}

export function installPointerRelease(): () => void {
  if (typeof window === 'undefined') return () => {}
  const onGot = (event: PointerEvent) => { if (event.target instanceof Element) captures.set(event.pointerId, event.target) }
  const onLost = (event: PointerEvent) => { captures.delete(event.pointerId) }
  const onLockChange = () => {
    // Mouse-look ended (Esc, another app took the mouse): nothing keeps walking by itself.
    if (!document.pointerLockElement) releaseHeldKeys()
    noteLockSettled()
    if (document.pointerLockElement && now() < cancelLockUntil) {
      cancelLockUntil = -Infinity
      document.exitPointerLock()
    }
  }
  const onKeyDownTrack = (event: KeyboardEvent) => {
    if (event.isTrusted && event.code) heldKeys.set(event.code, event.key)
  }
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code) heldKeys.delete(event.code)
    if (event.key !== 'Escape') return
    const freed = freeMouse()
    // A lock Escape itself ends is normal; a drag or a late lock it had to stop is worth a word.
    const unusual = freed.filter(what => what !== 'pointer lock')
    if (unusual.length) notify?.(`Mouse released (${unusual.join(', ')})`)
  }
  const giveBackLock = () => {
    releaseHeldKeys()
    if (document.pointerLockElement) document.exitPointerLock()
    noteLockSettled()
  }
  const onHidden = () => { if (document.visibilityState === 'hidden') giveBackLock() }
  const onBlur = () => {
    giveBackLock()
    for (const [pointerId, element] of [...captures]) {
      captures.delete(pointerId)
      try { (element as Element & { releasePointerCapture(id: number): void }).releasePointerCapture(pointerId) } catch { /* already gone */ }
    }
  }
  document.addEventListener('gotpointercapture', onGot, true)
  document.addEventListener('lostpointercapture', onLost, true)
  document.addEventListener('pointerlockchange', onLockChange)
  document.addEventListener('pointerlockerror', noteLockSettled)
  window.addEventListener('keydown', onKeyDownTrack, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('blur', onBlur)
  window.addEventListener('pagehide', giveBackLock)
  window.addEventListener('beforeunload', giveBackLock)
  document.addEventListener('visibilitychange', onHidden)
  return () => {
    window.removeEventListener('pagehide', giveBackLock)
    window.removeEventListener('beforeunload', giveBackLock)
    document.removeEventListener('visibilitychange', onHidden)
    document.removeEventListener('gotpointercapture', onGot, true)
    document.removeEventListener('lostpointercapture', onLost, true)
    document.removeEventListener('pointerlockchange', onLockChange)
    document.removeEventListener('pointerlockerror', noteLockSettled)
    window.removeEventListener('keydown', onKeyDownTrack, true)
    window.removeEventListener('keyup', onKeyUp, true)
    window.removeEventListener('blur', onBlur)
  }
}
