// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CRAFT SPELL TAB — Standalone text-to-3D popup for the `text-to-3d` spell
// ─═̷─ Listens for window event `oasis:open-spelltab` { spellId: 'text-to-3d' }.
// Other spelltabs share the listener but only open if their spellId matches —
// firing the event for one spellId closes any other open spelltab. ─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useEffect, useState } from 'react'
import { SpellTabFrame } from './SpellTabFrame'
import { CraftSpellBody } from './bodies/CraftSpellBody'

const SPELL_ID = 'text-to-3d'

export function CraftSpellTab() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ spellId?: string }>).detail
      if (!detail || typeof detail.spellId !== 'string') return
      // Open only when this spell is summoned; any other spell closes this tab.
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
      title="Text to 3D"
      spellId={SPELL_ID}
      accentColor="#60A5FA"
      onClose={() => setIsOpen(false)}
    >
      <CraftSpellBody />
    </SpellTabFrame>
  )
}
