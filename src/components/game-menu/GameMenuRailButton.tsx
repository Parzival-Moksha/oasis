'use client'

// The Menu button on the always-on rail: the same main menu Escape opens.

import { GameMenuButton } from '@/components/forge/GameMenuButton'
import { useGameMenu } from '@/lib/game-menu/menu-store'
import { playMenuSound } from '@/lib/game-menu/menu-sounds'

export function GameMenuRailButton() {
  const open = useGameMenu(s => s.phase === 'open')
  return (
    <GameMenuButton
      label="Menu"
      marker="Esc"
      accent="#7DD3FC"
      active={open}
      aria-label="Main menu (M)"
      data-oasis-tooltip="Menu (M)"
      title="Main menu (M, or Esc when nothing else is open)"
      data-rail-button="menu"
      className="oasis-tooltip"
      onClick={() => {
        const menu = useGameMenu.getState()
        if (menu.phase === 'open') {
          playMenuSound(menu.prefs.sound, 'close')
          menu.closeMenu()
        } else {
          menu.openMenu({ fromMouseLook: false })
        }
      }}
    />
  )
}
