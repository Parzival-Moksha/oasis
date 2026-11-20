'use client'

// ░▒▓ AWAY MODE — stops drawing the 3D world while the owner is away (src/lib/away-mode.ts) ▓▒░
// AwayModeDriver lives inside the Canvas: it watches input and visibility and switches R3F's
// render loop off ('never') while resting and back on ('always') on any input. The loop is
// stopped, not slowed: nothing in the 3D world needs to move while nobody looks, and the browser
// then does no WebGL work at all. Sounds, spoken replies, the engine connection, the chime and the
// title count are not part of the render loop and keep going.
// AwayOverlay lives outside the Canvas: the dim and the one line.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useThree } from '@react-three/fiber'

import {
  AwayTracker, getAwayState, getServerAwayState, registerRestNow, setAwayState, subscribeAwayState,
} from '../../lib/away-mode'
import { useSavedGraphicsPrefs } from '../../lib/use-graphics-prefs'

const INPUT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const
const TICK_MS = 1000

export function AwayModeDriver() {
  const { restAfter } = useSavedGraphicsPrefs()
  const setFrameloop = useThree(s => s.setFrameloop)
  const clock = useThree(s => s.clock)
  const tracker = useMemo(() => new AwayTracker(performance.now(), restAfter), []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAwayState(tracker.setAfter(restAfter))
  }, [restAfter, tracker])

  // The render loop follows the state.
  useEffect(() => {
    const apply = () => {
      if (getAwayState().resting) {
        setFrameloop('never')
      } else {
        // The first frame after a pause must not see minutes of delta (animations, spring bones).
        clock.getDelta()
        setFrameloop('always')
      }
    }
    apply()
    const off = subscribeAwayState(apply)
    return () => { off(); setFrameloop('always') }
  }, [setFrameloop, clock])

  useEffect(() => {
    const onInput = (event: Event) => {
      // F8 rests; every other key wakes.
      if (event.type === 'keydown' && (event as KeyboardEvent).code === 'F8') {
        event.preventDefault()
        setAwayState(tracker.restNow(performance.now()))
        return
      }
      setAwayState(tracker.input(performance.now()))
    }
    const onVisibility = () => setAwayState(tracker.visibility(document.visibilityState === 'hidden', performance.now()))
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { capture: true, passive: type !== 'keydown' })
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    const timer = window.setInterval(() => setAwayState(tracker.tick(performance.now())), TICK_MS)
    registerRestNow(() => setAwayState(tracker.restNow(performance.now())))
    return () => {
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
      registerRestNow(null)
      setAwayState({ resting: false, reason: null })
    }
  }, [tracker])

  return null
}

export function useAwayState() {
  return useSyncExternalStore(subscribeAwayState, getAwayState, getServerAwayState)
}

/** The dim and its one line, over everything, while resting (and not hidden: then nobody sees it). */
export function AwayOverlay() {
  const away = useAwayState()
  if (!away.resting || away.reason === 'hidden') return null
  return (
    <div
      data-testid="oasis-away-overlay"
      className="fixed inset-0 z-[400] flex items-center justify-center pointer-events-none select-none"
      style={{ background: 'rgba(2, 6, 23, 0.55)' }}
    >
      <span
        className="font-mono text-sm tracking-[0.2em] uppercase"
        style={{ color: '#e2e8f0', textShadow: '0 1px 0 #000, 0 0 8px rgba(0,0,0,0.9)' }}
      >
        Resting. Move to wake.
      </span>
    </div>
  )
}
