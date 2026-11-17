// One sound language for the whole Oasis: every button, tab, menu entry and link makes the same
// hover tick and the same click, whoever wrote the panel. The set is the one picked for the main
// menu (Settings > Experiments > Main menu > Sound).
//
// Two ways in, one way out:
//   - a listener on the page hears the pointer enter or click anything button-like;
//   - code that asks the audio manager for 'buttonHover' / 'buttonClick' is routed here.
// Both end in playMenuSound, which lets one hover tick through per 45 ms and one click per 70 ms,
// so nothing ever sounds twice.

import { setUiSoundRouter } from '@/lib/audio-manager'
import { useGameMenu } from '@/lib/game-menu/menu-store'
import { isPlayingClassicSample, playMenuSound } from '@/lib/game-menu/menu-sounds'

/** What counts as a button for sound. `data-ui-sound="off"` on it or an ancestor keeps it silent. */
const SOUNDING = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], a[href], select, summary, input[type="checkbox"], input[type="radio"], input[type="range"], [data-ui-sound]'

export function soundingElement(target: EventTarget | null): Element | null {
  const el = target as Element | null
  if (!el || typeof el.closest !== 'function') return null
  const hit = el.closest(SOUNDING)
  if (!hit) return null
  if (hit.closest('[data-ui-sound="off"]')) return null
  if ((hit as HTMLButtonElement).disabled || hit.getAttribute('aria-disabled') === 'true') return null
  return hit
}

/** Start the Oasis-wide button sounds. Returns the function that stops them. */
export function startUiSounds(): () => void {
  let hovered: Element | null = null
  const style = () => useGameMenu.getState().prefs.sound

  const onOver = (event: Event) => {
    const hit = soundingElement(event.target)
    if (hit === hovered) return
    hovered = hit
    if (hit) playMenuSound(style(), 'hover')
  }
  const onOut = (event: MouseEvent) => {
    if (!hovered) return
    const to = event.relatedTarget as Node | null
    if (!to || !hovered.contains(to)) hovered = null
  }
  const onClick = (event: Event) => {
    if (soundingElement(event.target)) playMenuSound(style(), 'click')
  }

  setUiSoundRouter(event => {
    if (isPlayingClassicSample()) return false // the Classic set is the manager's own sample
    playMenuSound(style(), event === 'buttonHover' ? 'hover' : 'click')
    return true
  })
  document.addEventListener('pointerover', onOver, true)
  document.addEventListener('pointerout', onOut as EventListener, true)
  document.addEventListener('click', onClick, true)
  return () => {
    setUiSoundRouter(null)
    document.removeEventListener('pointerover', onOver, true)
    document.removeEventListener('pointerout', onOut as EventListener, true)
    document.removeEventListener('click', onClick, true)
  }
}
