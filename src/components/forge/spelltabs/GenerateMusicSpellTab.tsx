// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// GENERATE MUSIC SPELL TAB — Standalone text-to-music popup for `text-to-music`.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useEffect, useState } from 'react'
import { SpellTabFrame } from './SpellTabFrame'
import { MusicBody } from './bodies/MusicBody'

const SPELL_ID = 'text-to-music'

export function GenerateMusicSpellTab() {
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
      title="Text to Music"
      spellId={SPELL_ID}
      accentColor="#A78BFA"
      onClose={() => setIsOpen(false)}
    >
      <MusicBody />
    </SpellTabFrame>
  )
}
