'use client'

// ░▒▓ FLOP SAVER DRIVER — feeds the watcher every frame and applies what the canvas itself owns ▓▒░
// The level decides (src/lib/flop-saver.ts); effects read it through useGraphicsPrefs /
// useFlopCaps. Two caps belong to the canvas and are applied here: the pixel ratio (resolution)
// and the camera's far plane (draw distance).

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'

import { useSavedGraphicsPrefs } from '../../lib/use-graphics-prefs'
import { useFlopCaps } from '../../lib/use-flop-caps'
import { FlopWatcher, getFlopLevel, levelForMode, setFlopLevel } from '../../lib/flop-saver'

export function FlopSaverDriver() {
  const { flopSaver: mode } = useSavedGraphicsPrefs()
  const caps = useFlopCaps()
  const setDpr = useThree(s => s.setDpr)
  const initialDpr = useThree(s => s.viewport.initialDpr)
  const camera = useThree(s => s.camera)
  const watcher = useMemo(() => new FlopWatcher(), [])
  const last = useRef<number | null>(null)
  /** Dev: a level forced for measurements (null: the mode decides). */
  const forced = useRef<number | null>(null)

  useEffect(() => {
    if (mode !== 'auto') watcher.reset()
    setFlopLevel(forced.current ?? levelForMode(mode, watcher.level))
  }, [mode, watcher])

  useEffect(() => () => setFlopLevel(0), [])

  useFrame(() => {
    const now = performance.now()
    const duration = last.current === null ? 0 : now - last.current
    last.current = now
    if (forced.current !== null || mode !== 'auto') return
    const level = watcher.frame(duration, now)
    if (level !== getFlopLevel()) setFlopLevel(level)
  })

  // Resolution: a multiplier on the screen's own pixel ratio.
  useEffect(() => {
    setDpr(initialDpr * caps.resolution)
  }, [caps.resolution, initialDpr, setDpr])

  // Draw distance: the far plane, put back when the cap lifts.
  const homeFar = useRef<number | null>(null)
  useEffect(() => {
    const cam = camera as PerspectiveCamera
    if (!('far' in cam)) return
    if (caps.drawDistance !== null) {
      if (homeFar.current === null) homeFar.current = cam.far
      cam.far = Math.min(homeFar.current, caps.drawDistance)
    } else if (homeFar.current !== null) {
      cam.far = homeFar.current
      homeFar.current = null
    } else return
    cam.updateProjectionMatrix()
  }, [caps.drawDistance, camera])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const host = window as unknown as { __oasisFlop?: unknown }
    host.__oasisFlop = {
      level: () => getFlopLevel(),
      /** Force a level for measurements; null hands it back to the setting. */
      force: (level: number | null) => { forced.current = level; setFlopLevel(level ?? levelForMode(mode, watcher.level)) },
    }
    return () => { delete host.__oasisFlop }
  }, [mode, watcher])

  return null
}
