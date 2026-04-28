'use client'

import { CodexPanel } from './CodexPanel'

export function CodexWindowContent({
  windowId,
  initialSessionId,
  windowBlur = 0,
}: {
  windowId: string
  initialSessionId?: string
  windowBlur?: number
}) {
  return (
    <CodexPanel
      isOpen
      embedded
      hideCloseButton
      onClose={() => {}}
      windowId={windowId}
      initialSessionId={initialSessionId}
      windowBlur={windowBlur}
    />
  )
}
