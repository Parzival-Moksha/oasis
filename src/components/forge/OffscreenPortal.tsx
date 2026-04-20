'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OFFSCREEN PORTAL — React portal into OffscreenUIManager's hidden container
// ─═̷─═̷─ॐ─═̷─═̷─ Renders children offscreen for texture capture ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getOffscreenUIManager } from '../../lib/forge/offscreen-ui-manager'

interface OffscreenPortalProps {
  windowId: string
  width: number
  height: number
  agentType?: string
  captureMode?: 'snapdom' | 'foreign-object'
  children: React.ReactNode
}

export function OffscreenPortal({ windowId, width, height, agentType, captureMode, children }: OffscreenPortalProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const mountedRef = useRef(false)
  const initialDimsRef = useRef<{ w: number; h: number } | null>(null)
  const mountSizeRef = useRef({ width, height })
  mountSizeRef.current = { width, height }

  useEffect(() => {
    const mgr = getOffscreenUIManager()
    if (!mgr) return

    const { width: mountWidth, height: mountHeight } = mountSizeRef.current
    const { container: c } = mgr.mount(windowId, mountWidth, mountHeight, agentType, captureMode)
    setContainer(c)
    mountedRef.current = true
    initialDimsRef.current = { w: mountWidth, h: mountHeight }

    return () => {
      mountedRef.current = false
      mgr.unmount(windowId)
      setContainer(null)
    }
  }, [windowId, agentType, captureMode]) // only remount if the rendering container identity changes

  // Handle resize without remounting — skip if dimensions match initial mount
  useEffect(() => {
    if (!mountedRef.current) return
    const init = initialDimsRef.current
    if (init && init.w === width && init.h === height) return
    const mgr = getOffscreenUIManager()
    mgr?.resize(windowId, width, height)
  }, [windowId, width, height])

  if (!container) return null
  return createPortal(children, container)
}
