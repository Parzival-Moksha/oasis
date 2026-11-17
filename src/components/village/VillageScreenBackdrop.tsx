'use client'

// ░▒▓ SCREEN BACKDROP — the blur behind an agent's full screen (F) ▓▒░
// The F screen is HTML placed in the 3D view (drei <Html transform>, a CSS 3D transform), and Chromium draws no
// backdrop-filter inside a 3D-transformed layer: the chat look's blur did nothing there, while the side panel (E)
// blurred fine (the owner, 2026-11-17). So while F is open, a flat, untransformed layer carrying the blur sits
// right behind the screen: same rectangle, same rounded corners, in the same stacking context just under it.
// The world shows through the screen blurred, as it does through the side panel. Follows the blur setting
// (lib/village/panel-look.ts); none when it is 0.

import { useEffect, useSyncExternalStore } from 'react'

import { getPanelLook, getPanelLookVersion, subscribePanelLook } from '../../lib/village/panel-look'
import { getVillageScreen, subscribeVillageScreen } from './village-actions'

const SCREEN_PANEL = '[data-ui-panel="village-desk-window"][data-desk-mode="screen"]'

/** The wrapper drei put the panel in: its ancestor that sits beside the canvas (whose parent holds the canvas). */
function htmlHost(panel: HTMLElement, canvas: Element): HTMLElement | null {
  let node: HTMLElement | null = panel
  while (node?.parentElement) {
    if (node.parentElement.contains(canvas)) return node
    node = node.parentElement
  }
  return null
}

export function VillageScreenBackdrop() {
  const screenAgentId = useSyncExternalStore(subscribeVillageScreen, getVillageScreen, () => null)
  useSyncExternalStore(subscribePanelLook, getPanelLookVersion, () => 0)
  const blur = getPanelLook().blur

  useEffect(() => {
    if (!screenAgentId || blur <= 0) return
    const layer = document.createElement('div')
    layer.setAttribute('data-village-screen-backdrop', '')
    const filter = `blur(${blur}px)`
    layer.style.position = 'absolute'
    layer.style.pointerEvents = 'none'
    layer.style.display = 'none'
    layer.style.backdropFilter = filter
    layer.style.setProperty('-webkit-backdrop-filter', filter)
    let frame = 0
    let last = ''
    const hide = () => {
      if (layer.style.display !== 'none') layer.style.display = 'none'
      last = ''
    }
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const canvas = document.querySelector('#uploader-canvas canvas')
      const panel = document.querySelector<HTMLElement>(SCREEN_PANEL)
      const host = panel && canvas ? htmlHost(panel, canvas) : null
      const parent = host?.parentElement
      if (!panel || !host || !parent) return hide()
      // Same z as the screen's wrapper, placed before it: drawn just under it, over the world.
      if (layer.parentElement !== parent || layer.nextSibling !== host) parent.insertBefore(layer, host)
      const box = panel.getBoundingClientRect()
      const origin = parent.getBoundingClientRect()
      if (box.width < 2 || box.height < 2) return hide()
      const scale = panel.offsetWidth ? box.width / panel.offsetWidth : 1
      const radius = (parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0) * scale
      const next = `${box.left - origin.left}|${box.top - origin.top}|${box.width}|${box.height}|${radius}|${host.style.zIndex}`
      if (next === last) return
      last = next
      layer.style.left = `${box.left - origin.left}px`
      layer.style.top = `${box.top - origin.top}px`
      layer.style.width = `${box.width}px`
      layer.style.height = `${box.height}px`
      layer.style.borderRadius = `${radius}px`
      layer.style.zIndex = host.style.zIndex
      layer.style.display = 'block'
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      layer.remove()
    }
  }, [screenAgentId, blur])

  return null
}
