'use client'

import { AnorakPanel } from './AnorakPanel'

export function AnorakWindowContent({
  windowId,
  initialSessionId,
  windowBlur = 0,
}: {
  windowId: string
  initialSessionId?: string
  windowBlur?: number
}) {
  return (
    <AnorakPanel
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
