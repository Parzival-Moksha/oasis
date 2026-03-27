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
  children: React.ReactNode
}

export function OffscreenPortal({ windowId, width, height, agentType, children }: OffscreenPortalProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const mountedRef = useRef(false)
  const initialDimsRef = useRef<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const mgr = getOffscreenUIManager()
    if (!mgr) return

    const { container: c } = mgr.mount(windowId, width, height, agentType)
    setContainer(c)
    mountedRef.current = true
    initialDimsRef.current = { w: width, h: height }

    return () => {
      mountedRef.current = false
      mgr.unmount(windowId)
      setContainer(null)
    }
  }, [windowId]) // only remount if windowId changes

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
