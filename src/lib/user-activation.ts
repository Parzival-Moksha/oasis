// ░▒▓ USER ACTIVATION — has the page had a click / key press yet? (browser autoplay rules) ▓▒░
// Sound may only start after the first gesture: media unmuted before it gets paused by the browser.

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const

export function pageHasUserActivation(): boolean {
  if (typeof navigator === 'undefined') return false
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
  // Browsers without the API (old Safari): assume yes, as before.
  return activation ? activation.hasBeenActive : true
}

/** Calls `fn` once, on the page's first click / key / tap (now, if that already happened). Returns a cancel. */
export function onFirstUserGesture(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  if (pageHasUserActivation()) {
    fn()
    return () => {}
  }
  let done = false
  const fire = () => {
    if (done) return
    done = true
    cancel()
    fn()
  }
  const cancel = () => {
    for (const type of GESTURES) window.removeEventListener(type, fire, { capture: true })
  }
  for (const type of GESTURES) window.addEventListener(type, fire, { capture: true })
  return () => {
    done = true
    cancel()
  }
}
