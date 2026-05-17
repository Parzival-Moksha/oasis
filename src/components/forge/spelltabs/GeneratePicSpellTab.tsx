// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// GENERATE PIC SPELL TAB — Text-to-Pic popup, two flavors:
//   • `text-to-pic` → toggle OFF, title "Text to Pic"
//   • `text-to-pic-building` → toggle ON, title "Text to Pic Building"
// ─═̷─ One component, two instances mount in Scene.tsx — one per spell. ─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useEffect, useState } from 'react'
import { SpellTabFrame } from './SpellTabFrame'
import { GeneratePicBody } from './bodies/GeneratePicBody'

interface GeneratePicSpellTabProps {
  /** When true, the 4-sided building toggle is pre-set ON and the title is "Text to Pic Building". */
  buildingMode?: boolean
}

export function GeneratePicSpellTab({ buildingMode = false }: GeneratePicSpellTabProps) {
  const spellId = buildingMode ? 'text-to-pic-building' : 'text-to-pic'
  const title = buildingMode ? 'Text to Pic Building' : 'Text to Pic'
  const accent = buildingMode ? '#F59E0B' : '#EC4899'
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ spellId?: string }>).detail
      if (!detail || typeof detail.spellId !== 'string') return
      setIsOpen(detail.spellId === spellId)
    }
    const onClose = () => setIsOpen(false)
    window.addEventListener('oasis:open-spelltab', onOpen as EventListener)
    window.addEventListener('oasis:close-spelltabs', onClose as EventListener)
    return () => {
      window.removeEventListener('oasis:open-spelltab', onOpen as EventListener)
      window.removeEventListener('oasis:close-spelltabs', onClose as EventListener)
    }
  }, [spellId])

  return (
    <SpellTabFrame
      isOpen={isOpen}
      title={title}
      spellId={spellId}
      accentColor={accent}
      onClose={() => setIsOpen(false)}
    >
      <GeneratePicBody
        defaultBuildingMode={buildingMode}
        showBuildingToggle
        accentColor={accent}
      />
    </SpellTabFrame>
  )
}
