'use client'

import { useEffect, useRef, useState } from 'react'

import { useAudioManager } from '@/lib/audio-manager'
import { useUILayer } from '@/lib/input-manager'
import { useOasisCapabilities } from '@/lib/oasis-mode-client'

import { GameMenuButton } from './GameMenuButton'
import { useIsMobileOasis } from './MobileOasisControls'
import { PlacementPalette } from './PlacementPalette'

export function PlaceMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { canUseFullWizard } = useOasisCapabilities()
  const isMobile = useIsMobileOasis()
  useUILayer('place-menu', isOpen)

  const playClick = () => useAudioManager.getState().play('buttonClick')

  useEffect(() => {
    const openMenu = () => setIsOpen(true)
    window.addEventListener('oasis:open-place-menu', openMenu)
    return () => window.removeEventListener('oasis:open-place-menu', openMenu)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={menuRef} className="relative select-none">
      <GameMenuButton
        label="Place"
        marker="+"
        accent="#34D399"
        active={isOpen}
        aria-label="Place menu"
        data-oasis-tooltip="Place"
        onClick={() => {
          playClick()
          setIsOpen(open => !open)
        }}
      />

      {isOpen && (
        <div
          data-ui-panel
          data-place-menu-panel
          className="absolute left-full top-0 z-[280] ml-2 max-h-[76vh] w-[460px] overflow-y-auto rounded-lg border border-white/10 bg-black/[0.92] p-3 font-mono text-white shadow-[0_0_54px_rgba(0,0,0,0.68),0_0_38px_rgba(52,211,153,0.14)] backdrop-blur-md max-[700px]:fixed max-[700px]:left-2 max-[700px]:right-2 max-[700px]:top-[58px] max-[700px]:ml-0 max-[700px]:max-h-[calc(100vh-70px)] max-[700px]:w-auto max-[700px]:p-1.5"
          onMouseDown={event => event.stopPropagation()}
        >
          <div className="mb-3 flex items-center gap-3 border-b border-white/10 pb-3 max-[700px]:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-emerald-300/35 bg-emerald-300/10 text-lg font-black text-emerald-100">
              +
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-black uppercase tracking-[0.16em] text-white max-[700px]:text-[10px]">Place</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-white/45 max-[700px]:hidden">
                pick an object, then click the world
              </div>
            </div>
          </div>
          <PlacementPalette
            showConjured={canUseFullWizard}
            columns={isMobile ? 2 : 3}
            onPlace={() => {
              playClick()
              setIsOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
