'use client'

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useOasisStore } from '../../store/oasisStore'
import type { AgentWindow } from '../../store/oasisStore'
import {
  getAgentWindowRendererMeta,
  isHybridAgentWindowRenderMode,
  resolveAgentWindowRenderMode,
} from '../../lib/agent-window-renderers'
import { getOffscreenUIManager } from '../../lib/forge/offscreen-ui-manager'
import { AgentWindowSurface } from './AgentWindowSurface'
import { useInputManager } from '../../lib/input-manager'
import {
  FourBarFrame,
  NeonFrame,
  HologramFrame,
  VoidFrame,
  SpaghettiFrame,
  TriangleFrame,
  InfernoFrame,
  MatrixFrame,
  PlasmaFrame,
  BrutalistFrame,
} from './FrameComponents'

const DISTANCE_FACTOR = 8
const PX_TO_WORLD = DISTANCE_FACTOR / 400
const LIVE_HTML_SELECT_BAR_PX = 24
const LIVE_HTML_RESIZE_HANDLE_PX = 14
const MIN_WINDOW_WIDTH = 320
const MIN_WINDOW_HEIGHT = 240
const MAX_WINDOW_WIDTH = 2560
const MAX_WINDOW_HEIGHT = 1600

function stopSceneBridgeEvent(
  event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement> | ReactWheelEvent<HTMLElement>,
) {
  event.stopPropagation()
  const nativeEvent = event.nativeEvent as Event & { stopImmediatePropagation?: () => void }
  nativeEvent.stopImmediatePropagation?.()
}

function FocusPrompt({ visible, label }: { visible: boolean; label: string }) {
  if (!visible) return null
  return (
    <Html position={[0, 2.2, 0]} center style={{ pointerEvents: 'none' }}>
      <div
        className="select-none font-mono font-bold text-sm tracking-wider"
        style={{
          color: '#38bdf8',
          textShadow: '0 0 20px rgba(56,189,248,0.6), 0 0 40px rgba(56,189,248,0.3)',
          animation: 'focusPromptPulse 1.5s ease-in-out infinite',
        }}
      >
        HIT ENTER · {label}
      </div>
      <style>{`
        @keyframes focusPromptPulse {
          0%, 100% { opacity: 0.7; transform: scale(1) translateY(0); }
          50% { opacity: 1; transform: scale(1.1) translateY(-3px); }
        }
      `}</style>
    </Html>
  )
}

function computeCSSTransform(
  camera: THREE.Camera,
  worldMatrix: THREE.Matrix4,
  viewportWidth: number,
  viewportHeight: number,
  pixelWidth: number,
  pixelHeight: number,
): string {
  const mvp = new THREE.Matrix4()
  mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  mvp.multiply(worldMatrix)

  const center = new THREE.Vector4(0, 0, 0, 1).applyMatrix4(mvp)
  if (center.w <= 0) return 'scale(0)'

  const sx = (center.x / center.w) * viewportWidth / 2
  const sy = -(center.y / center.w) * viewportHeight / 2
  const projScale = (camera.projectionMatrix.elements[0] * viewportWidth / 2) * PX_TO_WORLD / center.w
  const tx = viewportWidth / 2 + sx - (pixelWidth * projScale) / 2
  const ty = viewportHeight / 2 + sy - (pixelHeight * projScale) / 2

  return `translate(${tx}px, ${ty}px) scale(${projScale})`
}

export const AgentWindow3D = memo(function AgentWindow3D({ window: win }: { window: AgentWindow }) {
  const groupRef = useRef<THREE.Group>(null!)
  const liveHtmlRootRef = useRef<HTMLDivElement | null>(null)
  const resizeSessionRef = useRef<{
    startX: number
    startY: number
    startWidth: number
    startHeight: number
    screenToContentX: number
    screenToContentY: number
    currentWidth: number
    currentHeight: number
    cleanup: (() => void) | null
  } | null>(null)
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const focusedAgentWindowId = useOasisStore(s => s.focusedAgentWindowId)
  const updateAgentWindow = useOasisStore(s => s.updateAgentWindow)
  const focusAgentWindow = useOasisStore(s => s.focusAgentWindow)
  const isSelected = selectedObjectId === win.id
  const isFocused = focusedAgentWindowId === win.id
  const prevFocusedRef = useRef(false)

  const renderMode = resolveAgentWindowRenderMode(win.renderMode)
  const rendererMeta = getAgentWindowRendererMeta(renderMode)
  const isHybrid = isHybridAgentWindowRenderMode(renderMode)

  const committedWidth = win.width || 800
  const committedHeight = win.height || 600
  const [resizeDraft, setResizeDraft] = useState<{ width: number; height: number } | null>(null)
  const winWidth = resizeDraft?.width ?? committedWidth
  const winHeight = resizeDraft?.height ?? committedHeight
  const winScale = win.scale || 1
  const worldWidth = winWidth * PX_TO_WORLD
  const worldHeight = winHeight * PX_TO_WORLD
  const windowOpacity = win.windowOpacity ?? 1
  const surfaceWindow = resizeDraft ? { ...win, width: winWidth, height: winHeight } : win

  const agentColor = win.agentType === 'anorak' ? '#38bdf8'
    : win.agentType === 'anorak-pro' ? '#14b8a6'
    : win.agentType === 'browser' ? '#f97316'
    : win.agentType === 'hermes' ? '#fb7185'
    : win.agentType === 'merlin' ? '#f59e0b'
    : win.agentType === 'parzival' ? '#c084fc'
    : '#22c55e'

  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null)
  useEffect(() => {
    if (!isHybrid) {
      setTexture(null)
      return
    }
    const mgr = getOffscreenUIManager()
    if (!mgr) return
    const interval = setInterval(() => {
      const nextTexture = mgr.getTexture(win.id)
      if (nextTexture) {
        setTexture(nextTexture)
        clearInterval(interval)
      }
    }, 100)
    const nextTexture = mgr.getTexture(win.id)
    if (nextTexture) {
      setTexture(nextTexture)
      clearInterval(interval)
    }
    return () => clearInterval(interval)
  }, [isHybrid, win.id])

  useEffect(() => {
    if (!isHybrid) return
    const mgr = getOffscreenUIManager()
    if (!mgr) return

    if (isFocused && !prevFocusedRef.current) {
      mgr.setFocused(win.id, true)
    } else if (!isFocused && prevFocusedRef.current) {
      mgr.setFocused(win.id, false)
    }
    prevFocusedRef.current = isFocused
  }, [isFocused, isHybrid, win.id])

  useEffect(() => {
    if (!resizeSessionRef.current) {
      setResizeDraft(null)
    }
  }, [win.id, committedWidth, committedHeight])

  useEffect(() => {
    return () => {
      resizeSessionRef.current?.cleanup?.()
      resizeSessionRef.current = null
    }
  }, [])

  const { camera, gl } = useThree()
  useFrame(() => {
    if (!isHybrid || !isFocused || !groupRef.current) return
    const mgr = getOffscreenUIManager()
    if (!mgr) return

    const rect = gl.domElement.getBoundingClientRect()
    mgr.setCSSTransform(
      win.id,
      computeCSSTransform(camera, groupRef.current.matrixWorld, rect.width, rect.height, winWidth, winHeight),
    )
  })

  const handleChromeSelect = useCallback((inspectNow: boolean) => (event: ReactMouseEvent<HTMLDivElement> | ReactPointerEvent<HTMLDivElement>) => {
    stopSceneBridgeEvent(event)
    const store = useOasisStore.getState()
    if (store.selectedObjectId !== win.id) {
      store.selectObject(win.id)
    }
    if (inspectNow) {
      store.setInspectedObject(win.id)
    }
  }, [win.id])

  const handoffToWindowUi = useCallback(() => {
    const input = useInputManager.getState()
    if (input.pointerLocked) {
      input.releasePointerLock()
    }
    if (input.inputState === 'orbit' || input.inputState === 'noclip' || input.inputState === 'third-person') {
      input.enterUIFocus()
    }
  }, [])

  const handleContentPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    stopSceneBridgeEvent(event)
    if (event.shiftKey) {
      const store = useOasisStore.getState()
      if (store.selectedObjectId !== win.id) {
        store.selectObject(win.id)
      }
      return
    }
    handoffToWindowUi()
  }, [handoffToWindowUi, win.id])

  const handleContentWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    stopSceneBridgeEvent(event)
    handoffToWindowUi()
  }, [handoffToWindowUi])

  // ░▒▓ VANISH-ON-SCROLL FIX (oasisspec3) ▓▒░
  // Previous implementation toggled `transform: translateZ(0 ↔ 0.001px)` on
  // the inner live-html root to force browser repaint on scroll. That is a
  // NESTED 3D transform context inside drei's CSS3D `matrix3d()` parent.
  // Under scroll-end boundary conditions Chrome's compositor drops the
  // innermost layer — producing the exact "orange bg visible, inner content
  // gone, scroll-up-revives, scroll-down-twice-nukes-for-good" symptom the
  // user reported. We replace the nudge with a one-shot WebGL invalidate
  // (bumps the three.js render counter without creating a CSS stacking
  // context). drei's <Html transform> re-applies its matrix3d on the next
  // frame, which cleanly triggers a repaint without toggling DOM transforms.
  const invalidate = useThree(s => s.invalidate)
  const nudgeLiveHtmlRepaint = useCallback(() => {
    invalidate()
  }, [invalidate])

  const handleContentScroll = useCallback((_event: ReactUIEvent<HTMLDivElement>) => {
    nudgeLiveHtmlRepaint()
  }, [nudgeLiveHtmlRepaint])


  const handleChromeFocus = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    stopSceneBridgeEvent(event)
    const store = useOasisStore.getState()
    if (store.selectedObjectId !== win.id) {
      store.selectObject(win.id)
    }
    focusAgentWindow(win.id)
  }, [focusAgentWindow, win.id])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    stopSceneBridgeEvent(event)
    const store = useOasisStore.getState()
    if (store.selectedObjectId !== win.id) {
      store.selectObject(win.id)
    }
    store.setInspectedObject(win.id)
    handoffToWindowUi()

    const root = liveHtmlRootRef.current
    if (!root) return

    const rect = root.getBoundingClientRect()
    const screenToContentX = rect.width > 0 ? winWidth / rect.width : 1
    const screenToContentY = rect.height > 0 ? winHeight / rect.height : 1

    const session = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: winWidth,
      startHeight: winHeight,
      screenToContentX,
      screenToContentY,
      currentWidth: winWidth,
      currentHeight: winHeight,
      cleanup: null as (() => void) | null,
    }

    const applyDraft = (nextWidth: number, nextHeight: number) => {
      session.currentWidth = nextWidth
      session.currentHeight = nextHeight
      setResizeDraft(current =>
        current?.width === nextWidth && current?.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      )
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(
        MIN_WINDOW_WIDTH,
        Math.min(MAX_WINDOW_WIDTH, Math.round(session.startWidth + (moveEvent.clientX - session.startX) * session.screenToContentX)),
      )
      const nextHeight = Math.max(
        MIN_WINDOW_HEIGHT,
        Math.min(MAX_WINDOW_HEIGHT, Math.round(session.startHeight + (moveEvent.clientY - session.startY) * session.screenToContentY)),
      )
      applyDraft(nextWidth, nextHeight)
    }

    const finish = (commit: boolean) => {
      session.cleanup?.()
      resizeSessionRef.current = null
      setResizeDraft(null)
      if (commit && (session.currentWidth !== committedWidth || session.currentHeight !== committedHeight)) {
        updateAgentWindow(win.id, {
          width: session.currentWidth,
          height: session.currentHeight,
        })
      }
    }

    const onPointerUp = () => finish(true)
    const onPointerCancel = () => finish(false)
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') finish(false)
    }

    session.cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown)
    }

    resizeSessionRef.current = session
    setResizeDraft({ width: winWidth, height: winHeight })

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown)
  }, [committedHeight, committedWidth, handoffToWindowUi, updateAgentWindow, win.id, winHeight, winWidth])

  return (
    <group ref={groupRef}>
      <group scale={[winScale, winScale, winScale]}>
        {renderMode === 'live-html' ? (
          <Html
            transform
            /* Occlusion parked — see carbondir/occlusionspec.md for the full
             * deep dive + two implementation paths. HTML is drawn on top of
             * the canvas always; no depth interaction. Ship-critical fix is
             * out of scope for today's Hermes-skill push. */
            distanceFactor={DISTANCE_FACTOR}
            style={{ pointerEvents: 'auto' }}
          >
            <div
              ref={liveHtmlRootRef}
              data-ui-panel=""
              style={{
                width: `${winWidth}px`,
                height: `${winHeight}px`,
                overflow: 'hidden',
                position: 'relative',
                overscrollBehavior: 'contain',
                touchAction: 'auto',
                // GPU promotion hint — NO new transform context. The previous
                // `transform: translateZ(${repaintNudge}px)` was the root cause
                // of the scroll-to-end vanish-bug (see nudgeLiveHtmlRepaint).
                willChange: 'transform',
              }}
            >
              <div
                data-agent-window-surface=""
                style={{ width: '100%', height: '100%' }}
                onPointerDownCapture={handleContentPointerDown}
                onWheelCapture={event => {
                  handleContentWheel(event)
                  nudgeLiveHtmlRepaint()
                }}
                onScrollCapture={handleContentScroll}
                onClick={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
              >
                <AgentWindowSurface win={surfaceWindow} />
              </div>
              <div
                data-agent-window-select-zone=""
                title="Click to select. Double-click to focus head-on."
                onPointerDown={handleChromeSelect(false)}
                onDoubleClick={handleChromeFocus}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `${LIVE_HTML_SELECT_BAR_PX}px`,
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                  background: `linear-gradient(180deg, ${isSelected || isFocused ? `${agentColor}30` : `${agentColor}16`} 0%, transparent 100%)`,
                  borderBottom: `1px solid ${isSelected || isFocused ? `${agentColor}55` : `${agentColor}24`}`,
                  opacity: isFocused ? 1 : isSelected ? 0.92 : 0.68,
                }}
              />
              {isSelected && (
                <div
                  data-agent-window-resize-handle=""
                  title="Drag to resize this 3D window"
                  onPointerDown={handleResizeStart}
                  style={{
                    position: 'absolute',
                    right: 0,
                    bottom: 0,
                    width: `${LIVE_HTML_RESIZE_HANDLE_PX}px`,
                    height: `${LIVE_HTML_RESIZE_HANDLE_PX}px`,
                    cursor: 'nwse-resize',
                    pointerEvents: 'auto',
                    background: `linear-gradient(135deg, transparent 42%, ${agentColor}88 100%)`,
                    boxShadow: `0 0 0 1px ${agentColor}40 inset`,
                  }}
                />
              )}
            </div>
          </Html>
        ) : !isFocused && (
          <mesh>
            <planeGeometry args={[worldWidth, worldHeight]} />
            {texture ? (
              <meshBasicMaterial
                map={texture}
                transparent
                opacity={windowOpacity}
                side={THREE.DoubleSide}
                toneMapped={false}
              />
            ) : (
              <meshBasicMaterial color="#0a0a0f" transparent opacity={windowOpacity} side={THREE.DoubleSide} />
            )}
          </mesh>
        )}

        <mesh>
          <planeGeometry args={[worldWidth, worldHeight]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {win.frameStyle && (() => {
          const fw = worldWidth
          const fh = worldHeight
          const fs = 1
          const ft = win.frameThickness ?? 1
          return (
            <group position={[0, 0, -0.01]}>
              {win.frameStyle === 'gilded' && (<><group position={[0, 0, -0.004 * fs]}><FourBarFrame w={fw} h={fh} border={0.04 * fs * ft} depth={0.025 * fs * ft} color="#B8860B" roughness={0.25} metalness={0.85} /></group><group position={[0, 0, 0.004 * fs]}><FourBarFrame w={fw} h={fh} border={0.008 * fs * ft} depth={0.005 * fs * ft} color="#FFD700" roughness={0.1} metalness={1.0} emissive="#DAA520" emissiveIntensity={0.3} /></group></>)}
              {win.frameStyle === 'neon' && <NeonFrame w={fw} h={fh} scale={fs * ft} />}
              {win.frameStyle === 'thin' && <FourBarFrame w={fw} h={fh} border={0.006 * fs * ft} depth={0.003 * fs * ft} color="#1a1a1a" roughness={0.9} metalness={0.0} />}
              {win.frameStyle === 'baroque' && (<><group position={[0, 0, -0.005 * fs]}><FourBarFrame w={fw} h={fh} border={0.08 * fs * ft} depth={0.04 * fs * ft} color="#3E1C00" roughness={0.3} metalness={0.7} /></group><group position={[0, 0, 0.003 * fs]}><FourBarFrame w={fw} h={fh} border={0.02 * fs * ft} depth={0.015 * fs * ft} color="#FFD700" roughness={0.15} metalness={0.95} emissive="#DAA520" emissiveIntensity={0.2} /></group></>)}
              {win.frameStyle === 'hologram' && <HologramFrame w={fw} h={fh} scale={fs * ft} />}
              {win.frameStyle === 'rustic' && <FourBarFrame w={fw} h={fh} border={0.05 * fs * ft} depth={0.025 * fs * ft} color="#3E2723" roughness={0.95} metalness={0.0} />}
              {win.frameStyle === 'ice' && <FourBarFrame w={fw} h={fh} border={0.04 * fs * ft} depth={0.02 * fs * ft} color="#B3E5FC" roughness={0.05} metalness={0.1} transparent opacity={0.5} emissive="#81D4FA" emissiveIntensity={0.6} />}
              {win.frameStyle === 'void' && (<><group position={[0, 0, -0.005 * fs]}><FourBarFrame w={fw} h={fh} border={0.05 * fs * ft} depth={0.035 * fs * ft} color="#050505" roughness={0.95} metalness={0.05} /></group><group position={[0, 0, 0.002 * fs]}><FourBarFrame w={fw} h={fh} border={0.006 * fs * ft} depth={0.003 * fs * ft} color="#14b8a6" roughness={0.0} metalness={1.0} emissive="#14b8a6" emissiveIntensity={3} /></group></>)}
              {win.frameStyle === 'spaghetti' && <SpaghettiFrame w={fw} h={fh} scale={fs * ft} />}
              {win.frameStyle === 'triangle' && <TriangleFrame w={fw} h={fh} scale={fs * ft} />}
              {win.frameStyle === 'fire' && <InfernoFrame w={fw} h={fh} scale={fs * ft} />}
              {win.frameStyle === 'matrix' && <MatrixFrame w={fw} h={fh} scale={fs * ft} />}
              {win.frameStyle === 'plasma' && <PlasmaFrame w={fw} h={fh} scale={fs * ft} />}
              {win.frameStyle === 'brutalist' && <BrutalistFrame w={fw} h={fh} scale={fs * ft} />}
            </group>
          )
        })()}

        {isFocused && (
          <mesh position={[0, 0, -0.05]}>
            <planeGeometry args={[worldWidth + 0.4, worldHeight + 0.4]} />
            <meshBasicMaterial color={agentColor} transparent opacity={0.08} />
          </mesh>
        )}
      </group>

      {isSelected && !isFocused && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -win.position[1] + 0.05, 0]}>
          <ringGeometry args={[1.2 * winScale, 1.5 * winScale, 32]} />
          <meshBasicMaterial color={agentColor} transparent opacity={0.4} />
        </mesh>
      )}

      <FocusPrompt visible={isSelected && !isFocused} label={rendererMeta.shortLabel} />
    </group>
  )
})
