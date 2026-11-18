'use client'

// ░▒▓ WORK VOW CLOCK — today's time in the Oasis, big, over the mission wall ▓▒░
// Readable from across the plaza: the time so far, the 3:00:00 goal, a bar. Two draw calls (a frame
// and one printed face). The face is a small canvas redrawn when the shown second changes, driven by
// the work counter's one tick a second: no useFrame, no React re-render, no SDF text.

import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { formatClock, timeToGo } from '../../lib/village/work-vow'
import type { Vec3 } from '../../lib/village/village-layout'
import { getWorkVowState, subscribeWorkVow } from './work-vow-client'

const SIZE = { width: 5.2, height: 1.9, depth: 0.09, border: 0.09 }
const PX = { width: 1040, height: 380 }
const FONT = 'Bahnschrift, "Barlow Condensed", "Segoe UI", system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
const NO_RAYCAST = () => {}

function draw(ctx: CanvasRenderingContext2D): string {
  const state = getWorkVowState()
  const snapshot = state.snapshot
  const seconds = (snapshot?.today.seconds || 0) + state.pendingSeconds
  const target = snapshot?.targetSeconds || 3 * 3600
  const done = seconds >= target
  const color = done ? '#34d399' : '#fbbf24'
  const status = !snapshot ? 'reading the book' : state.automated ? 'test browser: not counting' : state.otherTab ? `another tab is counting${state.other?.client ? ` (${state.other.client})` : ''}` : done ? 'the day is done' : state.running ? 'counting' : 'paused'
  const key = `${seconds}|${target}|${status}`
  const { width, height } = PX
  ctx.fillStyle = '#070b14'
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(226,232,240,0.7)'
  ctx.font = `700 40px ${FONT}`
  ctx.fillText(snapshot ? `TODAY IN THE OASIS · ${timeToGo(seconds, target).toUpperCase()}` : 'TODAY IN THE OASIS', 44, 52)
  ctx.textAlign = 'right'
  ctx.fillStyle = state.running ? color : 'rgba(226,232,240,0.5)'
  ctx.fillText(status.toUpperCase(), width - 44, 52)
  ctx.textAlign = 'left'
  ctx.fillStyle = done ? '#34d399' : '#f8fafc'
  ctx.font = `700 210px ${FONT}`
  // No book yet is not zero hours: dashes, until the same number the counter shows is there.
  ctx.fillText(snapshot ? formatClock(seconds) : '–:––:––', 36, 196)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(226,232,240,0.6)'
  ctx.font = `700 72px ${FONT}`
  ctx.fillText(`/ ${formatClock(target)}`, width - 44, 228)
  // The bar toward the goal.
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(44, height - 58, width - 88, 26)
  ctx.fillStyle = color
  ctx.fillRect(44, height - 58, (width - 88) * Math.min(1, seconds / target), 26)
  return key
}

/** `position`: the ground point it hangs over; `rotationY`: facing the plaza. */
export function WorkVowClock3D({ position, rotationY, height = 5.6 }: { position: Vec3; rotationY: number; height?: number }) {
  const invalidate = useThree(s => s.invalidate)
  const face = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = PX.width
    canvas.height = PX.height
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    return { canvas, texture, material }
  }, [])
  useEffect(() => () => {
    face.texture.dispose()
    face.material.dispose()
  }, [face])

  // Reprint only when what it shows changed: at most once a second.
  useEffect(() => {
    const ctx = face.canvas.getContext('2d')
    if (!ctx) return
    let shown = ''
    const print = () => {
      const state = getWorkVowState()
      const next = `${(state.snapshot?.today.seconds || 0) + state.pendingSeconds}|${state.snapshot?.targetSeconds}|${state.running}|${state.otherTab}|${state.other?.client}|${state.automated}|${Boolean(state.snapshot)}`
      if (next === shown) return
      shown = next
      draw(ctx)
      face.texture.needsUpdate = true
      invalidate()
    }
    print()
    // The page's fonts may arrive after the first print.
    document.fonts?.ready.then(() => { shown = ''; print() }).catch(() => {})
    return subscribeWorkVow(print)
  }, [face, invalidate])

  return (
    <group position={[position[0], position[1] + height, position[2]]} rotation-y={rotationY}>
      <mesh raycast={NO_RAYCAST}>
        <boxGeometry args={[SIZE.width + SIZE.border * 2, SIZE.height + SIZE.border * 2, SIZE.depth]} />
        <meshStandardMaterial color="#1b2230" roughness={0.45} metalness={0.55} />
      </mesh>
      <mesh position={[0, 0, SIZE.depth / 2 + 0.004]} material={face.material} raycast={NO_RAYCAST}>
        <planeGeometry args={[SIZE.width, SIZE.height]} />
      </mesh>
    </group>
  )
}
