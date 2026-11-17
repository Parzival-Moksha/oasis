'use client'

// The main menu: Escape (when nothing else is open) lays it over the live world, which is dimmed
// and blurred behind it while the camera drifts (GameMenuCameraDrift, inside the Canvas).
// Six tiles in the middle 60% of the screen, the title above. The rail and the HUD stay above the
// dimming and stay clickable: using one of them closes the menu.
//
// Cost: nothing while closed (this component renders null and only holds three listeners). While
// open, one requestAnimationFrame loop moves the tiles, and it stops whenever they are at rest.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useInputManager } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'
import { openMindcraft } from '@/components/village/MindcraftView'
import { openAcademyMap } from '@/components/village/academy-store'
import { openKeychain } from '@/components/village/keychain-store'
import { showNotice } from '@/components/forge/GlobalNotice'
import { isVillageProfileClient } from '@/lib/oasis-profile'
import { cellsPath, textCells, textWidth } from '@/components/forge/splash/intro-overlay'
import { useGameMenu } from '@/lib/game-menu/menu-store'
import { getSelectedVillageAgent, selectVillageAgent } from '@/lib/village/agent-selection'
import { menuShouldOpenOnEscape } from '@/lib/game-menu/menu-escape'
import { menuLayout, type MenuRect } from '@/lib/game-menu/menu-layout'
import { playMenuSound } from '@/lib/game-menu/menu-sounds'
import {
  feelStyle,
  followTilt,
  releaseTile,
  restingTile,
  stepSpring,
  stepTile,
  tapTile,
  tileAtRest,
  tileTransform,
  type Spring,
  type TileInput,
  type TileMotion,
} from '@/lib/game-menu/menu-feel'
import { GameMenuTileArt, MENU_TILES, type MenuTileId } from './GameMenuTileArt'

export const OPEN_PROFILE_EVENT = 'oasis:open-profile'
export const OPEN_CONFIG_EVENT = 'oasis:open-config'
export const OPEN_HELP_EVENT = 'oasis:open-help'

const INVITE_TEXT = [
  'The Oasis is a 3D world on your own computer where your Claude Code agents live: each has a body and a desk, you walk up to one, tell it by voice what you need, and watch it work.',
  'To get in, paste this to your Claude Code: "Clone https://github.com/Parzival-Moksha/oasis, follow its README to install and start it, then open http://localhost:4516/?profile=village in my browser."',
].join('\n\n')

// ── Escape, and Escape out of mouse-look ──────────────────────────────────────────────────────

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

function useMenuTriggers() {
  useEffect(() => {
    let lastInputChangeAt = 0
    let lastProgrammaticUnlockAt = 0
    let pending: { event: KeyboardEvent; reachedBubble: boolean } | null = null

    const stopWatching = useInputManager.subscribe((state, prev) => {
      if (state.inputState !== prev.inputState || state._uiLayerStack !== prev._uiLayerStack) lastInputChangeAt = performance.now()
    })

    // Tell an Escape-made pointer unlock (the browser's own, no call) from one the Oasis asked for.
    const originalExit = document.exitPointerLock
    const stampedExit = function (this: Document) {
      lastProgrammaticUnlockAt = performance.now()
      return originalExit.call(document)
    }
    document.exitPointerLock = stampedExit

    const nothingOpen = () => {
      const input = useInputManager.getState()
      const store = useOasisStore.getState()
      return {
        inputState: input.inputState,
        uiLayers: input._uiLayerStack.length,
        selectedObject: Boolean(store.selectedObjectId),
        agentOpen: Boolean(store.agentEngine?.focusedAgentId),
        panels: document.querySelectorAll('[data-ui-panel]').length,
      }
    }

    const onKeyCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return
      const menu = useGameMenu.getState()
      if (menu.phase === 'open') {
        event.preventDefault()
        event.stopImmediatePropagation()
        playMenuSound(menu.prefs.sound, 'close')
        menu.closeMenu()
        return
      }
      if (menu.phase === 'returning') {
        // The camera is on its way back: this key must not reach the handlers that change camera mode.
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      const before = nothingOpen()
      const typing = isTypingTarget(event.target)
      const wasLocked = useInputManager.getState().pointerLocked
      const startedAt = performance.now()
      const entry = { event, reachedBubble: false }
      pending = entry
      window.setTimeout(() => {
        if (pending === entry) pending = null
        const after = nothingOpen()
        const open = menuShouldOpenOnEscape({
          inputState: before.inputState,
          uiLayers: before.uiLayers,
          typing,
          selectedObject: before.selectedObject,
          agentOpen: before.agentOpen,
          panelsBefore: before.panels,
          panelsAfter: after.panels,
          inputStateAfter: after.inputState,
          reachedBubble: entry.reachedBubble,
          defaultPrevented: event.defaultPrevented,
          menuPhase: useGameMenu.getState().phase,
        })
        // Something reacted to this key just before it reached here (a panel closing itself).
        if (!open || lastInputChangeAt >= startedAt - 250) return
        // An agent is selected: this Escape lets go of it; the next one opens the menu.
        if (getSelectedVillageAgent()) { selectVillageAgent(null); return }
        useGameMenu.getState().openMenu({ fromMouseLook: wasLocked })
      }, 0)
    }
    const onKeyBubble = (event: KeyboardEvent) => {
      if (pending && pending.event === event) pending.reachedBubble = true
    }

    // Chrome keeps the Escape that ends mouse-look to itself: no keydown arrives. The unlock does.
    let wasLocked = Boolean(document.pointerLockElement)
    const onLockChange = () => {
      const locked = Boolean(document.pointerLockElement)
      const justUnlocked = wasLocked && !locked
      wasLocked = locked
      if (!justUnlocked) return
      const at = performance.now()
      if (at - lastProgrammaticUnlockAt < 400) return
      window.setTimeout(() => {
        const menu = useGameMenu.getState()
        if (!menu.prefs.openFromMouseLook || menu.phase !== 'closed') return
        if (!document.hasFocus() || document.visibilityState !== 'visible') return // alt-tab, not Escape
        if (document.pointerLockElement || performance.now() - lastProgrammaticUnlockAt < 400) return
        const now = nothingOpen()
        const base = now.inputState === 'third-person' || now.inputState === 'noclip' || now.inputState === 'orbit'
        if (!base || now.uiLayers > 0 || now.selectedObject || now.agentOpen) return
        if (lastInputChangeAt >= at - 250) return
        // An agent is selected: this Escape lets go of it, as it does with the mouse free.
        if (getSelectedVillageAgent()) { selectVillageAgent(null); return }
        menu.openMenu({ fromMouseLook: true })
      }, 60)
    }

    window.addEventListener('keydown', onKeyCapture, { capture: true })
    window.addEventListener('keydown', onKeyBubble)
    document.addEventListener('pointerlockchange', onLockChange)
    return () => {
      stopWatching()
      if (document.exitPointerLock === stampedExit) document.exitPointerLock = originalExit
      window.removeEventListener('keydown', onKeyCapture, { capture: true })
      window.removeEventListener('keydown', onKeyBubble)
      document.removeEventListener('pointerlockchange', onLockChange)
    }
  }, [])

  // Using the rail or the HUD while the menu is open (Spells, Agents, a panel): the menu steps aside.
  useEffect(() => useInputManager.subscribe((state, prev) => {
    if (state._uiLayerStack === prev._uiLayerStack) return
    if (useGameMenu.getState().phase !== 'open') return
    if (state._uiLayerStack.some(id => id !== 'game-menu')) useGameMenu.getState().closeMenu()
  }), [])
}

// ── The title: dot-matrix letters with real depth (stacked layers in CSS 3D) ───────────────────

const TITLE_TEXT = 'OASIS'
const TITLE_LAYERS = 7

function MenuTitle({ rect, tiltRef }: { rect: MenuRect; tiltRef: React.RefObject<HTMLDivElement> }) {
  const path = useMemo(() => cellsPath(textCells(TITLE_TEXT, 0, 0, 1).flat(), 1, 'square', 0.86), [])
  const cells = textWidth(TITLE_TEXT, 1)
  const cellPx = Math.min(rect.h / 9.5, rect.w / (cells + 2))
  const width = cells * cellPx
  const height = 7 * cellPx
  return (
    <div className="ogm-title" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <div ref={tiltRef} className="ogm-title-tilt" style={{ width, height }}>
        {Array.from({ length: TITLE_LAYERS }).map((_, i) => {
          const depth = TITLE_LAYERS - 1 - i // drawn back to front
          const front = depth === 0
          return (
            <svg
              key={i}
              viewBox={`0 0 ${cells} 7`}
              width={width}
              height={height}
              className="ogm-title-layer"
              style={{ transform: `translateZ(${(-depth * cellPx * 0.24).toFixed(2)}px)` }}
              aria-hidden
            >
              {front && (
                <defs>
                  <linearGradient id="ogm-title-face" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset="0.55" stopColor="#c9f4ff" />
                    <stop offset="1" stopColor="#6fd8ff" />
                  </linearGradient>
                </defs>
              )}
              <path d={path} fill={front ? 'url(#ogm-title-face)' : `rgb(${22 + depth * 3}, ${96 - depth * 9}, ${138 - depth * 11})`} />
            </svg>
          )
        })}
      </div>
      <div className="ogm-tagline" style={{ fontSize: Math.max(10, Math.min(15, cellPx * 0.62)) }}>
        04515 <span>·</span> D3BU9 Y0UR531F
      </div>
    </div>
  )
}

// ── The screen ─────────────────────────────────────────────────────────────────────────────────

function useViewSize() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

function GameMenuScreen({ closing }: { closing: boolean }) {
  const prefs = useGameMenu(s => s.prefs)
  const size = useViewSize()
  const layout = useMemo(() => menuLayout(size.w, size.h, MENU_TILES.length), [size.w, size.h])
  const [view, setView] = useState<'tiles' | 'invite'>('tiles')
  const [copied, setCopied] = useState(false)

  const tileEls = useRef<Array<HTMLButtonElement | null>>([])
  const motions = useRef<TileMotion[]>(MENU_TILES.map(() => restingTile()))
  const inputs = useRef<TileInput[]>(MENU_TILES.map(() => ({ hovered: false, pressed: false, tiltX: 0, tiltY: 0 })))
  const stageRef = useRef<HTMLDivElement>(null)
  const titleTiltRef = useRef<HTMLDivElement>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const sway = useRef<{ x: Spring; y: Spring }>({ x: { x: 0, v: 0 }, y: { x: 0, v: 0 } })
  const loop = useRef<{ raf: number; last: number }>({ raf: 0, last: 0 })
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const closingRef = useRef(closing)
  closingRef.current = closing

  // One loop for everything that moves; it ends when everything is at rest.
  const kick = useCallback(() => {
    if (loop.current.raf) return
    loop.current.last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - loop.current.last) / 1000))
      loop.current.last = now
      const style = feelStyle(prefsRef.current.feel)
      let moving = false
      for (let i = 0; i < MENU_TILES.length; i++) {
        const input = inputs.current[i]
        const motion = stepTile(motions.current[i], input, style, dt)
        motions.current[i] = motion
        const el = tileEls.current[i]
        if (el) el.style.transform = tileTransform(motion)
        if (!tileAtRest(motion, input, style)) moving = true
      }
      const tilt = prefsRef.current.tilt
      const tx = tilt ? pointer.current.x : 0
      const ty = tilt ? pointer.current.y : 0
      sway.current.x = stepSpring(sway.current.x, tx, 60, 14, dt)
      sway.current.y = stepSpring(sway.current.y, ty, 60, 14, dt)
      const sx = sway.current.x.x
      const sy = sway.current.y.x
      if (stageRef.current) stageRef.current.style.transform = `translate3d(${(-sx * 10).toFixed(2)}px, ${(-sy * 7).toFixed(2)}px, 0)`
      if (titleTiltRef.current) titleTiltRef.current.style.transform = `rotateX(${(-sy * 9 + 6).toFixed(2)}deg) rotateY(${(sx * 16).toFixed(2)}deg)`
      if (Math.abs(sx - tx) > 0.002 || Math.abs(sy - ty) > 0.002 || Math.abs(sway.current.x.v) + Math.abs(sway.current.y.v) > 0.01) moving = true
      loop.current.raf = moving && !closingRef.current ? requestAnimationFrame(frame) : 0
    }
    loop.current.raf = requestAnimationFrame(frame)
  }, [])

  useEffect(() => {
    kick()
    const raf = loop.current
    return () => { if (raf.raf) cancelAnimationFrame(raf.raf); raf.raf = 0 }
  }, [kick])

  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    playMenuSound(prefsRef.current.sound, 'open')
    // Take the keyboard so the arrow keys reach the tiles without tabbing through the rail first.
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  const onStageMove = (event: React.PointerEvent) => {
    pointer.current.x = (event.clientX / Math.max(1, size.w)) * 2 - 1
    pointer.current.y = (event.clientY / Math.max(1, size.h)) * 2 - 1
    if (prefsRef.current.tilt) kick()
  }

  const localPoint = (event: React.PointerEvent | React.MouseEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return {
      px: Math.max(-1, Math.min(1, ((event.clientX - r.left) / Math.max(1, r.width)) * 2 - 1)),
      py: Math.max(-1, Math.min(1, ((event.clientY - r.top) / Math.max(1, r.height)) * 2 - 1)),
    }
  }

  const close = useCallback((sound = true) => {
    const menu = useGameMenu.getState()
    if (sound) playMenuSound(menu.prefs.sound, 'close')
    menu.closeMenu()
  }, [])

  const run = useCallback((id: MenuTileId) => {
    const menu = useGameMenu.getState()
    if (id === 'invite') { setView('invite'); setCopied(false); return }
    // Continue from mouse-look gives the mouse back to the camera once the menu is gone.
    menu.closeMenu({ relock: id === 'continue' && menu.openedFromMouseLook })
    if (id === 'mindcraft') openMindcraft()
    // The Academy's skill map (also K): it lives in the Agent Village.
    if (id === 'skills') {
      if (isVillageProfileClient()) openAcademyMap()
      else showNotice('Skills live in the Agent Village: open the Oasis with ?profile=village.', 'info')
    }
    // The Academy's keychain: which keys the agents hold.
    if (id === 'keychain') {
      if (isVillageProfileClient()) openKeychain()
      else showNotice('The keychain lives in the Agent Village: open the Oasis with ?profile=village.', 'info')
    }
    if (id === 'profile') window.dispatchEvent(new CustomEvent(OPEN_PROFILE_EVENT))
    if (id === 'config') window.dispatchEvent(new CustomEvent(OPEN_CONFIG_EVENT))
    if (id === 'help') window.dispatchEvent(new CustomEvent(OPEN_HELP_EVENT))
  }, [])

  const pressedBy = useRef<number | null>(null)
  const clickTimer = useRef<number | null>(null)
  useEffect(() => () => { if (clickTimer.current) window.clearTimeout(clickTimer.current) }, [])

  const tileHandlers = (index: number, id: MenuTileId) => ({
    onPointerEnter: () => {
      inputs.current[index].hovered = true
      playMenuSound(prefsRef.current.sound, 'hover')
      kick()
    },
    onPointerLeave: () => {
      const input = inputs.current[index]
      input.hovered = false
      input.pressed = false
      input.tiltX = 0
      input.tiltY = 0
      kick()
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!prefsRef.current.tilt) return
      const { px, py } = localPoint(event, event.currentTarget.parentElement ?? event.currentTarget)
      Object.assign(inputs.current[index], followTilt(px, py))
      kick()
    },
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      inputs.current[index].pressed = true
      pressedBy.current = index
      kick()
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!inputs.current[index].pressed) return
      inputs.current[index].pressed = false
      const { px, py } = localPoint(event, event.currentTarget.parentElement ?? event.currentTarget)
      motions.current[index] = releaseTile(motions.current[index], feelStyle(prefsRef.current.feel), px, py)
      kick()
    },
    onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.matches(':focus-visible')) return
      inputs.current[index].hovered = true
      kick()
    },
    onBlur: () => {
      inputs.current[index].hovered = false
      kick()
    },
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      // A keyboard click never showed the press: show it now.
      if (pressedBy.current !== index) motions.current[index] = tapTile(motions.current[index], feelStyle(prefsRef.current.feel))
      pressedBy.current = null
      event.currentTarget.blur()
      playMenuSound(prefsRef.current.sound, 'click')
      kick()
      // Let the push and the first of the wobble be seen before the menu gives way.
      if (clickTimer.current) window.clearTimeout(clickTimer.current)
      clickTimer.current = window.setTimeout(() => run(id), 170)
    },
  })

  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: layout.cols, ArrowUp: -layout.cols }
    const step = keys[event.key]
    if (step === undefined || view !== 'tiles') return
    event.preventDefault()
    const at = tileEls.current.findIndex(el => el === document.activeElement)
    const next = at < 0 ? (step > 0 ? 0 : MENU_TILES.length - 1) : Math.max(0, Math.min(MENU_TILES.length - 1, at + step))
    tileEls.current[next]?.focus()
  }

  const copyInvite = async () => {
    let ok = false
    try { await navigator.clipboard.writeText(INVITE_TEXT); ok = true } catch { /* fall through */ }
    if (!ok) {
      const area = document.createElement('textarea')
      area.value = INVITE_TEXT
      area.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.appendChild(area)
      area.select()
      try { ok = document.execCommand('copy') } catch { ok = false }
      area.remove()
    }
    setCopied(ok)
    playMenuSound(prefsRef.current.sound, 'click')
  }

  const first = layout.tiles[0]
  const labelSize = Math.max(11, Math.min(21, first.w * 0.075))

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="ogm-root"
      data-closing={closing ? '1' : '0'}
      data-game-menu="open"
      onPointerMove={onStageMove}
      onKeyDown={onKeyDown}
      onContextMenu={event => event.preventDefault()}
    >
      <style dangerouslySetInnerHTML={{ __html: MENU_CSS }} />
      <div className="ogm-backdrop" onClick={() => close()} />
      <div ref={stageRef} className="ogm-stage">
        <MenuTitle rect={layout.title} tiltRef={titleTiltRef} />
        {view === 'tiles' && MENU_TILES.map((tile, i) => {
          const r = layout.tiles[i]
          return (
            <div
              key={tile.id}
              className="ogm-slot"
              style={{ left: r.x, top: r.y, width: r.w, height: r.h, animationDelay: `${60 + i * 45}ms` }}
            >
              <button
                ref={el => { tileEls.current[i] = el }}
                type="button"
                className="ogm-tile"
                data-menu-tile={tile.id}
                style={{ ['--ogm-accent' as string]: tile.accent, fontSize: labelSize }}
                {...tileHandlers(i, tile.id)}
              >
                <span className="ogm-art"><GameMenuTileArt id={tile.id} /></span>
                <span className="ogm-text">
                  <span className="ogm-label">{tile.label}</span>
                  <span className="ogm-sub">{tile.sub}</span>
                </span>
              </button>
            </div>
          )
        })}
        {view === 'invite' && (
          <div
            className="ogm-invite"
            data-ui-panel="game-menu-invite"
            style={{ left: layout.region.x, top: layout.region.y, width: layout.region.w, maxHeight: layout.region.h }}
          >
            <div className="ogm-invite-title">Invite a friend</div>
            <p className="ogm-invite-hint">Send them this. Their Claude Code does the rest.</p>
            <pre className="ogm-invite-text">{INVITE_TEXT}</pre>
            <div className="ogm-invite-row">
              <button type="button" className="ogm-btn ogm-btn-main" data-menu-action="copy-invite" onClick={copyInvite}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button type="button" className="ogm-btn" data-menu-action="invite-back" onClick={() => { playMenuSound(prefsRef.current.sound, 'hover'); setView('tiles') }}>
                Back
              </button>
            </div>
          </div>
        )}
        <div className="ogm-foot" style={{ top: size.h * 0.94 }}>
          <kbd>Esc</kbd> back to the world
        </div>
      </div>
    </div>
  )
}

export function GameMenu() {
  useMenuTriggers()
  const phase = useGameMenu(s => s.phase)
  const openCount = useGameMenu(s => s.openCount)
  // Keep the screen for the short fade while the camera comes back.
  const [shown, setShown] = useState(false)
  useLayoutEffect(() => {
    if (phase === 'open') { setShown(true); return }
    const timer = window.setTimeout(() => setShown(false), 260)
    return () => window.clearTimeout(timer)
  }, [phase])
  if (!shown && phase !== 'open') return null
  return <GameMenuScreen key={openCount} closing={phase !== 'open'} />
}

const MENU_CSS = `
.ogm-root { position: fixed; inset: 0; z-index: 150; outline: none; font-family: inherit; color: #fff; user-select: none; }
.ogm-root[data-closing="1"] { pointer-events: none; }
.ogm-backdrop {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 75% 70% at 50% 52%, rgba(6,10,22,0.38) 0%, rgba(4,6,14,0.74) 100%);
  -webkit-backdrop-filter: blur(7px) saturate(0.85);
  backdrop-filter: blur(7px) saturate(0.85);
  animation: ogmFade 260ms ease-out both;
  transition: opacity 240ms ease-in;
}
.ogm-root[data-closing="1"] .ogm-backdrop { opacity: 0; }
.ogm-stage { position: absolute; inset: 0; pointer-events: none; transition: opacity 180ms ease-in; }
.ogm-root[data-closing="1"] .ogm-stage { opacity: 0; }
@keyframes ogmFade { from { opacity: 0; } to { opacity: 1; } }

.ogm-title { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; perspective: 900px; animation: ogmTitleIn 420ms cubic-bezier(0.2, 0.9, 0.25, 1) both; }
.ogm-title-tilt { position: relative; transform-style: preserve-3d; transform: rotateX(6deg); filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.55)); }
.ogm-title-layer { position: absolute; left: 0; top: 0; }
.ogm-tagline { margin-top: 0.9em; font-family: ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace; font-weight: 700; letter-spacing: 0.42em; color: rgba(190, 240, 255, 0.82); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8); white-space: nowrap; }
.ogm-tagline span { opacity: 0.5; }
@keyframes ogmTitleIn { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: none; } }

.ogm-slot { position: absolute; perspective: 700px; pointer-events: auto; animation: ogmTileIn 380ms cubic-bezier(0.2, 0.9, 0.25, 1.1) both; }
.ogm-slot:hover, .ogm-slot:focus-within { z-index: 2; }
@keyframes ogmTileIn { from { opacity: 0; transform: translateY(22px) scale(0.94); } to { opacity: 1; transform: none; } }
.ogm-tile {
  position: absolute; inset: 0; display: block; padding: 0; margin: 0; cursor: pointer; overflow: hidden;
  border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.2); background: #0b0f1a; color: #fff; text-align: left;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);
  transition: border-color 140ms ease-out, box-shadow 140ms ease-out;
  transform-origin: 50% 50%; outline: none; -webkit-tap-highlight-color: transparent;
}
.ogm-tile:hover, .ogm-tile:focus-visible {
  border-color: var(--ogm-accent);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--ogm-accent), 0 0 34px -6px var(--ogm-accent);
}
.ogm-art { position: absolute; inset: 0; display: block; }
.ogm-art svg { display: block; }
.ogm-text { position: absolute; left: 0.9em; right: 0.9em; bottom: 0.75em; display: flex; flex-direction: column; gap: 0.15em; pointer-events: none; }
.ogm-label { font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; line-height: 1.1; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.85); }
.ogm-label::after { content: ''; display: block; width: 2.2em; height: 0.16em; margin-top: 0.4em; border-radius: 1em; background: var(--ogm-accent); transition: width 180ms ease-out; }
.ogm-tile:hover .ogm-label::after, .ogm-tile:focus-visible .ogm-label::after { width: 4.6em; }
.ogm-sub { font-size: 0.62em; font-weight: 600; letter-spacing: 0.04em; color: rgba(255, 255, 255, 0.72); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.ogm-invite { position: absolute; pointer-events: auto; overflow: auto; box-sizing: border-box; padding: 22px 24px; border-radius: 14px; border: 1px solid rgba(255, 157, 122, 0.5); background: rgba(20, 10, 16, 0.92); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6); animation: ogmTileIn 300ms ease-out both; user-select: text; }
.ogm-invite-title { font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; font-size: 16px; color: #ffc9ae; }
.ogm-invite-hint { margin: 6px 0 12px; font-size: 12.5px; color: rgba(255, 255, 255, 0.65); }
.ogm-invite-text { margin: 0; padding: 14px 16px; white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.55; color: rgba(255, 255, 255, 0.92); background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; }
.ogm-invite-row { display: flex; gap: 10px; margin-top: 14px; }
.ogm-btn { cursor: pointer; padding: 9px 20px; border-radius: 9px; border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(255, 255, 255, 0.06); color: #fff; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; font-size: 12px; transition: transform 120ms ease-out, background 120ms ease-out; }
.ogm-btn:hover { background: rgba(255, 255, 255, 0.14); transform: scale(1.05); }
.ogm-btn:active { transform: scale(0.96); }
.ogm-btn-main { border-color: #ff9d7a; background: rgba(255, 157, 122, 0.2); }

.ogm-foot { position: absolute; left: 0; right: 0; text-align: center; font-size: 11.5px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(255, 255, 255, 0.55); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9); }
.ogm-foot kbd { display: inline-block; margin-right: 0.6em; padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(255, 255, 255, 0.35); background: rgba(0, 0, 0, 0.45); font: inherit; color: #fff; }

@media (prefers-reduced-motion: reduce) {
  .ogm-slot, .ogm-title, .ogm-invite, .ogm-backdrop { animation: none; }
}
`
