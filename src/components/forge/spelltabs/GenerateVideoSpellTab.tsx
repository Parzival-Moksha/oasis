// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// GENERATE VIDEO SPELL TAB — Standalone text-to-video popup for `text-to-video`.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useEffect, useState } from 'react'
import { SpellTabFrame } from './SpellTabFrame'
import { VideoBody } from './bodies/VideoBody'

const SPELL_ID = 'text-to-video'

export function GenerateVideoSpellTab() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ spellId?: string }>).detail
      if (!detail || typeof detail.spellId !== 'string') return
      setIsOpen(detail.spellId === SPELL_ID)
    }
    const onClose = () => setIsOpen(false)
    window.addEventListener('oasis:open-spelltab', onOpen as EventListener)
    window.addEventListener('oasis:close-spelltabs', onClose as EventListener)
    return () => {
      window.removeEventListener('oasis:open-spelltab', onOpen as EventListener)
      window.removeEventListener('oasis:close-spelltabs', onClose as EventListener)
    }
  }, [])

  return (
    <SpellTabFrame
      isOpen={isOpen}
      title="Text to Video"
      spellId={SPELL_ID}
      accentColor="#FB7185"
      onClose={() => setIsOpen(false)}
    >
      <VideoBody />
    </SpellTabFrame>
  )
}
