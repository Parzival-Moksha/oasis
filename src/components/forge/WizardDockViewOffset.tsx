'use client'

// Inside the Canvas: while the Wizard console is docked on the right, the camera's projection is shifted by half the
// panel's width, so what the camera looks at sits in the middle of the world that is still visible (src/lib/forge/wizard-dock.ts).
// Pointer picking stays right (raycasts use the shifted projection). Eases in and out over about 0.2 s.

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { subscribeWizardDock, wizardDockInset } from '@/lib/forge/wizard-dock'

export function WizardDockViewOffset() {
  const camera = useThree(s => s.camera)
  const size = useThree(s => s.size)
  const target = useRef(0)
  const current = useRef(0)

  useEffect(() => {
    const update = () => { target.current = wizardDockInset(size.width) / 2 }
    update()
    return subscribeWizardDock(update)
  }, [size.width])

  useFrame((_, delta) => {
    const cam = camera as THREE.PerspectiveCamera
    if (!cam.isPerspectiveCamera) return
    const goal = target.current
    if (Math.abs(current.current - goal) < 0.5) {
      if (current.current === goal && (goal === 0 ? !cam.view?.enabled : cam.view?.fullWidth === size.width && cam.view?.fullHeight === size.height)) return
      current.current = goal
    } else {
      current.current += (goal - current.current) * Math.min(1, delta * 12)
    }
    if (current.current === 0) {
      if (cam.view?.enabled) cam.clearViewOffset()
      return
    }
    cam.setViewOffset(size.width, size.height, current.current, 0, size.width, size.height)
  })

  useEffect(() => () => {
    const cam = camera as THREE.PerspectiveCamera
    if (cam.isPerspectiveCamera && cam.view?.enabled) cam.clearViewOffset()
  }, [camera])

  return null
}
