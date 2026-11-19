'use client'

// Runs the scene-wide render fixes of src/lib/forge/render-hygiene.ts once a second, so objects
// that appear later (a portal, a placed model) are covered too. A scan is a plain tree walk.

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

import { setRenderHygieneEnabled, singlePassFlatTransparents } from '../../lib/forge/render-hygiene'

const SCAN_MS = 1000

export function RenderHygiene() {
  const scene = useThree(s => s.scene)
  useEffect(() => {
    singlePassFlatTransparents(scene)
    const timer = window.setInterval(() => singlePassFlatTransparents(scene), SCAN_MS)
    const host = window as unknown as { __oasisRenderHygiene?: unknown }
    if (process.env.NODE_ENV !== 'production') {
      host.__oasisRenderHygiene = { setEnabled: (on: boolean) => { setRenderHygieneEnabled(on, scene); if (on) singlePassFlatTransparents(scene) } }
    }
    return () => { window.clearInterval(timer); delete host.__oasisRenderHygiene }
  }, [scene])
  return null
}
