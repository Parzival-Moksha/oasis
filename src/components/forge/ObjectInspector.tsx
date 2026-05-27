// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OBJECT INSPECTOR ░▒▓█ The Forge's soul microscope █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─{ Double-click an object. See its truth. Shape its destiny. }─═̷─═̷─ॐ─═̷─═̷─
//
// Floating inspector panel for world objects (catalog, crafted, conjured).
// Controls: label editing, movement presets, animation config, visibility,
// transform display, and deletion.
//
// Portal-to-body pattern (same as WizardConsole) — lives outside R3F canvas.
// Every parameter is a knob. Every knob is a choice. Every choice echoes.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { createContext, useState, useRef, useCallback, useEffect, useMemo, useContext, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useOasisStore } from '../../store/oasisStore'
import { SettingsContext } from '../scene-lib/contexts'
import { LIGHT_INTENSITY_MAX, LIGHT_INTENSITY_STEP } from '../../lib/conjure/types'
import type { MovementPreset, ObjectBehavior, AnimationConfig, ModelStats, VRMExpressionConfig, ObjectInteractionAction } from '../../lib/conjure/types'
import { formatNumber, formatBytes } from './ModelPreview'
import { ANIMATION_LIBRARY, ANIM_CATEGORIES, LIB_PREFIX, loadAnimationClip, type AnimCategory } from '../../lib/forge/animation-library'
import { FRAME_STYLES, getAudioElement } from './WorldObjects'
import { useUILayer } from '@/lib/input-manager'
import { PORTAL_GATE_VARIANT_DEFS, WELCOME_HUB_WORLD_ID, resolvePortalGateAction, type PortalAction, type PortalGate, type PortalGateVariant } from '../../lib/portal-gates'
import { clampText3DInput } from '../../lib/forge/text-3d-object'

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS — The inspector's visual DNA
// ═══════════════════════════════════════════════════════════════════════════════

const INSPECTOR_COLOR = '#38bdf8'  // sky-400 — the lens that sees into objects
const DEFAULT_POSITION = { x: 16, y: 80 }
const DEFAULT_WIDTH = 320
const MIN_WIDTH = 280
const MAX_WIDTH = 400
const MOBILE_VIEWPORT_PX = 700

type InspectorCollapseContextValue = {
  expanded: Record<string, boolean>
  toggle: (key: string) => void
}

const InspectorCollapseContext = createContext<InspectorCollapseContextValue | null>(null)

function isMobileInspectorViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= MOBILE_VIEWPORT_PX
}

function inspectorSectionKey(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(inspectorSectionKey).join('')
  return 'section'
}

function getInspectorPanelWidth(mobileViewport: boolean): number {
  if (typeof window === 'undefined' || !mobileViewport) return DEFAULT_WIDTH
  return Math.max(232, Math.min(340, window.innerWidth - 88))
}

function clampInspectorPosition(
  position: { x: number; y: number },
  mobileViewport: boolean,
): { x: number; y: number } {
  if (typeof window === 'undefined') return position
  const width = getInspectorPanelWidth(mobileViewport)
  const bottomReserve = mobileViewport ? 220 : 120
  return {
    x: Math.max(8, Math.min(window.innerWidth - width - 8, position.x)),
    y: Math.max(8, Math.min(window.innerHeight - bottomReserve, position.y)),
  }
}

/** ░▒▓ Movement type options — each a different dance ▓▒░ */
const MOVEMENT_TYPES = ['static', 'spin', 'hover', 'orbit', 'bounce', 'pendulum', 'patrol'] as const
type MovementType = typeof MOVEMENT_TYPES[number]

/** ░▒▓ Type badge colors — identity at a glance ▓▒░ */
const TYPE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  catalog:        { bg: 'rgba(234, 179, 8, 0.2)',   text: '#EAB308', label: 'catalog' },
  crafted:        { bg: 'rgba(59, 130, 246, 0.2)',  text: '#3B82F6', label: 'crafted' },
  conjured:       { bg: 'rgba(249, 115, 22, 0.2)',  text: '#F97316', label: 'conjured' },
  light:          { bg: 'rgba(250, 204, 21, 0.2)',  text: '#FACC15', label: '💡 light' },
  agent:          { bg: 'rgba(56, 189, 248, 0.2)',  text: '#38BDF8', label: '💻 agent' },
  portal:         { bg: 'rgba(34, 211, 238, 0.2)',  text: '#22D3EE', label: '🌀 portal' },
  'spatial-web':  { bg: 'rgba(168, 85, 247, 0.2)',  text: '#A855F7', label: 'functional' },
  paint_stroke:   { bg: 'rgba(217, 70, 239, 0.2)',  text: '#D946EF', label: '🪄 stroke' },
  text_3d:        { bg: 'rgba(245, 158, 11, 0.2)',  text: '#F59E0B', label: '🔤 text' },
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDER — Reusable parameter slider with label + value display
// ═══════════════════════════════════════════════════════════════════════════════

function ParamSlider({ label, value, min, max, step, onChange, format }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (value: number) => string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-sky-500 cursor-pointer"
      />
      <span className="text-[10px] text-gray-400 font-mono w-10 text-right">{format ? format(value) : value.toFixed(step < 1 ? 1 : 0)}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// AXIS PICKER — Dropdown for axis selection
// ═══════════════════════════════════════════════════════════════════════════════

function AxisPicker<T extends string>({ value, options, onChange }: {
  value: T
  options: T[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">axis</span>
      <div className="flex gap-1">
        {options.map(opt => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${
              value === opt
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-gray-500 border border-gray-700/30 hover:text-gray-300'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PILL SELECTOR — For loop modes, movement types
// ═══════════════════════════════════════════════════════════════════════════════

function PillSelector<T extends string>({ value, options, onChange, labels }: {
  value: T
  options: T[]
  onChange: (v: T) => void
  labels?: Record<T, string>
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors ${
            value === opt
              ? 'bg-sky-500/25 text-sky-300 border border-sky-500/40'
              : 'text-gray-300 bg-black/40 border border-gray-600/40 hover:text-white hover:border-gray-500/60'
          }`}
        >
          {labels ? labels[opt] : opt}
        </button>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION HEADER — Consistent section divider
// ═══════════════════════════════════════════════════════════════════════════════

function SectionHeader({ children }: { children: React.ReactNode }) {
  const collapse = useContext(InspectorCollapseContext)
  const key = inspectorSectionKey(children)
  const expanded = collapse ? collapse.expanded[key] === true : true
  return (
    <button
      type="button"
      data-inspector-section
      data-collapsed={collapse && !expanded ? 'true' : 'false'}
      onClick={collapse ? (event) => { event.stopPropagation(); collapse.toggle(key) } : undefined}
      className="flex w-full items-center justify-between text-left text-[10px] text-gray-200 uppercase tracking-wider font-mono mb-1.5 mt-3 first:mt-0 px-2 py-1 rounded"
      style={{ background: 'rgba(30, 20, 40, 0.8)' }}
    >
      <span>{children}</span>
      {collapse && <span className="text-gray-400">{expanded ? '-' : '+'}</span>}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// VRM EXPRESSION SECTION — Facial controls for VRM avatars
// ░▒▓ Emotions + visemes (mouth shapes) — the face is the window to the soul ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

const VRM_EMOTIONS: { key: keyof VRMExpressionConfig; label: string; icon: string }[] = [
  { key: 'happy', label: 'Happy', icon: ':)' },
  { key: 'angry', label: 'Angry', icon: '>:(' },
  { key: 'sad', label: 'Sad', icon: ':(' },
  { key: 'surprised', label: 'Surprised', icon: ':O' },
  { key: 'relaxed', label: 'Relaxed', icon: '-_-' },
]

const VRM_VISEMES: { key: keyof VRMExpressionConfig; label: string }[] = [
  { key: 'aa', label: 'AA (ah)' },
  { key: 'ih', label: 'IH (ee)' },
  { key: 'ou', label: 'OU (oo)' },
  { key: 'ee', label: 'EE (eh)' },
  { key: 'oh', label: 'OH (oh)' },
]

function VRMExpressionSection({ expressions, onChange }: {
  expressions?: VRMExpressionConfig
  onChange: (expressions: VRMExpressionConfig) => void
}) {
  const current = expressions || {}
  const update = (key: keyof VRMExpressionConfig, value: number) => {
    onChange({ ...current, [key]: value > 0.01 ? value : undefined })
  }
  const resetAll = () => onChange({})
  const hasAny = Object.values(current).some(v => v && v > 0)

  return (
    <>
      <SectionHeader>&#128522; VRM Expressions</SectionHeader>
      <div className="rounded-lg border border-white/5 p-2 space-y-2" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
        {/* Emotions */}
        <div className="text-[9px] text-gray-500 font-mono">Emotions</div>
        {VRM_EMOTIONS.map(({ key, label, icon }) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 font-mono w-20 shrink-0">{icon} {label}</span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={current[key] || 0}
              onChange={(e) => update(key, parseFloat(e.target.value))}
              className="flex-1 h-1 accent-sky-500 cursor-pointer"
            />
            <span className="text-[9px] text-gray-500 font-mono w-8 text-right">
              {((current[key] || 0) * 100).toFixed(0)}%
            </span>
          </div>
        ))}

        {/* Visemes */}
        <div className="text-[9px] text-gray-500 font-mono mt-2">Mouth shapes</div>
        {VRM_VISEMES.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 font-mono w-20 shrink-0">{label}</span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={current[key] || 0}
              onChange={(e) => update(key, parseFloat(e.target.value))}
              className="flex-1 h-1 accent-sky-500 cursor-pointer"
            />
            <span className="text-[9px] text-gray-500 font-mono w-8 text-right">
              {((current[key] || 0) * 100).toFixed(0)}%
            </span>
          </div>
        ))}

        {/* Reset */}
        {hasAny && (
          <button
            onClick={resetAll}
            className="w-full text-[10px] py-1 rounded border border-gray-700/30 text-gray-400 hover:text-gray-300 font-mono transition-colors mt-1"
          >
            Reset all expressions
          </button>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION LIBRARY SECTION — Local Mixamo dance moves for rigged characters
// ░▒▓ 21 animations on disk, zero API calls, infinite groove ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function AnimationLibrarySection({ currentClipName, onSelectAnimation, onStopAnimation }: {
  currentClipName?: string
  onSelectAnimation: (animId: string) => void
  onStopAnimation: () => void
}) {
  const [expandedCat, setExpandedCat] = useState<AnimCategory | null>('dance')

  return (
    <>
      <SectionHeader>&#127926; Animation Library</SectionHeader>
      <div className="rounded-lg border border-white/5 p-2 space-y-1" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
        <div className="text-[9px] text-gray-400 font-mono mb-1">
          21 Mixamo moves — click to play on any rigged character
        </div>

        {/* Stop button */}
        {currentClipName?.startsWith(LIB_PREFIX) && (
          <button
            onClick={onStopAnimation}
            className="w-full text-[10px] py-1 rounded border border-red-500/20 text-red-400/70 hover:text-red-300 hover:border-red-500/40 font-mono transition-colors mb-1"
          >
            &#9632; Stop animation
          </button>
        )}

        {/* Category tabs */}
        <div className="flex flex-wrap gap-1 mb-1">
          {ANIM_CATEGORIES.map(cat => {
            const count = ANIMATION_LIBRARY.filter(a => a.category === cat.id).length
            return (
              <button
                key={cat.id}
                onClick={() => setExpandedCat(expandedCat === cat.id ? null : cat.id)}
                className={`text-[9px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                  expandedCat === cat.id
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-gray-500 border border-gray-700/30 hover:text-gray-300'
                }`}
              >
                {cat.icon} {cat.label} ({count})
              </button>
            )
          })}
        </div>

        {/* Animation buttons for expanded category */}
        {expandedCat && (
          <div className="grid grid-cols-2 gap-1">
            {ANIMATION_LIBRARY.filter(a => a.category === expandedCat).map(anim => {
              const isActive = currentClipName === `${LIB_PREFIX}${anim.id}`
              return (
                <button
                  key={anim.id}
                  onClick={() => onSelectAnimation(anim.id)}
                  className={`text-[10px] px-2 py-1 rounded font-mono transition-colors text-left truncate ${
                    isActive
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : 'text-gray-400 border border-gray-700/20 hover:text-green-300 hover:border-green-500/30 hover:bg-green-500/5'
                  }`}
                  title={anim.label}
                >
                  {isActive ? '▶ ' : ''}{anim.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// OBJECT INSPECTOR — Main floating panel component
// ░▒▓█ The panopticon of placed objects █▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

interface ObjectInspectorProps {
  isOpen: boolean
  onClose: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO SEEK SLIDER — polls HTMLAudioElement for progress, seeks on drag
// ═══════════════════════════════════════════════════════════════════════════

function AudioSeekSlider({ objectId }: { objectId: string }) {
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      const el = getAudioElement(objectId)
      if (!el) return
      if (el.duration && isFinite(el.duration)) {
        setDuration(el.duration)
        setProgress(el.currentTime / el.duration)
      }
    }, 250) // 4fps polling
    return () => clearInterval(interval)
  }, [objectId])

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-gray-500 font-mono w-10">{formatTime(progress * duration)}</span>
      <input
        type="range" min="0" max="1" step="0.001"
        value={progress}
        onChange={e => {
          const frac = parseFloat(e.target.value)
          setProgress(frac)
          const el = getAudioElement(objectId)
          if (el && el.duration && isFinite(el.duration)) {
            el.currentTime = frac * el.duration
          }
        }}
        className="flex-1 h-1 accent-sky-500"
      />
      <span className="text-[9px] text-gray-500 font-mono w-10 text-right">{formatTime(duration)}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PAINT STROKE PLAYBACK — Play button + duration slider on the Joystick
// ═══════════════════════════════════════════════════════════════════════════

function PaintStrokePlaybackSection({ strokeId, pointCount, onPlay, onStop, loop, onLoopChange }: {
  strokeId: string
  pointCount: number
  onPlay: (durationSec: number) => void
  onStop: () => void
  loop: boolean
  onLoopChange: (loop: boolean) => void
}) {
  const [duration, setDuration] = useState(4)
  return (
    <>
      <SectionHeader>&#9608;&#9658; Playback</SectionHeader>
      <div className="rounded-lg border border-fuchsia-400/15 p-2 space-y-2" style={{ background: 'rgba(20, 14, 24, 0.6)' }}>
        <div className="text-[9px] font-mono text-fuchsia-300/55">{pointCount} points · csillagszóró-tipped reveal</div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-fuchsia-100/60 font-mono w-16 shrink-0">duration</span>
          <input
            type="range" min={1} max={20} step={0.5}
            value={duration}
            onChange={(e) => setDuration(parseFloat(e.target.value))}
            className="flex-1 h-1 cursor-pointer accent-fuchsia-400"
          />
          <span className="text-[10px] text-fuchsia-100/55 font-mono w-10 text-right">{duration.toFixed(1)}s</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onPlay(duration)}
            className="flex-1 rounded-md border border-fuchsia-300/50 bg-fuchsia-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-fuchsia-100 transition-colors hover:bg-fuchsia-500/35"
            title={`Replay this stroke over ${duration.toFixed(1)}s`}
          >
            &#9654; Play
          </button>
          <button
            onClick={onStop}
            className="rounded-md border border-white/15 px-2 py-1 text-[10px] font-mono text-fuchsia-100/55 hover:text-fuchsia-100"
            title="Stop playback"
          >
            &#9632;
          </button>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[10px] font-mono text-fuchsia-100/70">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => onLoopChange(e.target.checked)}
            className="h-3 w-3 accent-fuchsia-400"
          />
          loop playback
        </label>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT 3D EDIT — Live edit text/size/depth/color on a placed text object.
// `text` is debounced via local draft state so typing "hello" doesn't fire
// 5 WS broadcasts + 5 debounced saves. Sliders/color stay synchronous —
// the user expects immediate feedback while dragging them.
// ═══════════════════════════════════════════════════════════════════════════

function PaintStrokeEditSection({ stroke, onChange }: {
  stroke: import('../../lib/forge/paint-stroke').PaintStroke
  onChange: (updates: Partial<Pick<import('../../lib/forge/paint-stroke').PaintStroke, 'color' | 'thickness' | 'shininess' | 'mode' | 'varyByVelocity' | 'playbackLoop'>>) => void
}) {
  return (
    <>
      <SectionHeader>&#127912; Stroke Style</SectionHeader>
      <div className="rounded-lg border border-fuchsia-400/15 p-2 space-y-2" style={{ background: 'rgba(22, 12, 26, 0.6)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-fuchsia-100/65 font-mono w-16 shrink-0">color</span>
          <input
            type="color"
            value={stroke.color}
            onChange={(e) => onChange({ color: e.target.value })}
            className="h-6 flex-1 cursor-pointer rounded border border-white/10 bg-black/30"
          />
        </div>
        <ParamSlider label="thick" value={stroke.thickness} min={0.005} max={0.2} step={0.005} format={value => `${(value * 100).toFixed(1)}`} onChange={(value) => onChange({ thickness: value })} />
        <ParamSlider label="shine" value={stroke.shininess} min={0} max={1} step={0.05} format={value => `${Math.round(value * 100)}`} onChange={(value) => onChange({ shininess: value })} />
        <div className="grid grid-cols-2 gap-1.5">
          {(['3d', '2d'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onChange({ mode })}
              className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                stroke.mode === mode
                  ? 'border-fuchsia-300/60 bg-fuchsia-500/25 text-fuchsia-50'
                  : 'border-white/10 bg-black/25 text-fuchsia-100/55 hover:text-fuchsia-100'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-md border border-white/10 bg-black/25 px-2 py-1.5 text-[10px] font-mono text-fuchsia-100/70">
          <input
            type="checkbox"
            checked={Boolean(stroke.varyByVelocity)}
            onChange={(e) => onChange({ varyByVelocity: e.target.checked })}
            className="h-3 w-3 accent-fuchsia-400"
          />
          velocity width
        </label>
      </div>
    </>
  )
}

function Text3DEditSection({ object, onChange }: {
  object: import('../../lib/forge/text-3d-object').Text3DObject
  onChange: (updates: Partial<import('../../lib/forge/text-3d-object').Text3DObject>) => void
}) {
  const [draftText, setDraftText] = useState(() => clampText3DInput(object.text))
  // Re-sync the draft when the inspector swaps to a different text object.
  useEffect(() => { setDraftText(clampText3DInput(object.text)) }, [object.id, object.text])
  // Trailing-edge debounce on text only — flushes when the user pauses.
  useEffect(() => {
    if (draftText === object.text) return
    const handle = window.setTimeout(() => onChange({ text: clampText3DInput(draftText) }), 220)
    return () => window.clearTimeout(handle)
    // onChange is a fresh closure per render; omit to avoid retrigger churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftText, object.text])

  return (
    <>
      <SectionHeader>&#128221; Text</SectionHeader>
      <div className="rounded-lg border border-amber-400/15 p-2 space-y-2" style={{ background: 'rgba(24, 18, 8, 0.6)' }}>
        <textarea
          value={draftText}
          onChange={(e) => setDraftText(clampText3DInput(e.target.value))}
          onBlur={() => { if (draftText !== object.text) onChange({ text: clampText3DInput(draftText) }) }}
          rows={2}
          className="w-full resize-none rounded border border-white/10 bg-black/40 px-2 py-1 text-[12px] text-amber-50"
        />
        <ParamSlider label="size"  value={object.size}  min={0.05} max={3} step={0.05} onChange={(v) => onChange({ size: v })} />
        <ParamSlider label="depth" value={object.depth} min={0.01} max={1} step={0.01} onChange={(v) => onChange({ depth: v })} />
        <ParamSlider label="shine" value={object.shininess} min={0} max={1} step={0.05} onChange={(v) => onChange({ shininess: v })} />
        <ParamSlider
          label="tone"
          value={object.toneBias ?? 0}
          min={-1}
          max={1}
          step={0.05}
          format={(value) => value < -0.05 ? `B${Math.round(Math.abs(value) * 100)}` : value > 0.05 ? `W${Math.round(value * 100)}` : 'pick'}
          onChange={(v) => onChange({ toneBias: v })}
        />
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-amber-100/65 font-mono w-16 shrink-0">color</span>
          <input
            type="color"
            value={object.color}
            onChange={(e) => onChange({ color: e.target.value })}
            className="h-6 flex-1 cursor-pointer rounded border border-white/10 bg-black/30"
          />
        </div>
      </div>
    </>
  )
}

export function ObjectInspector({ isOpen, onClose }: ObjectInspectorProps) {
  useUILayer('object-inspector', isOpen)
  // ─═̷─ Position & drag state — persisted to localStorage ─═̷─
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POSITION
    try {
      const saved = localStorage.getItem('oasis-inspector-pos')
      const parsed = saved ? JSON.parse(saved) : DEFAULT_POSITION
      return clampInspectorPosition(parsed, isMobileInspectorViewport())
    } catch { return DEFAULT_POSITION }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const [mobileViewport, setMobileViewport] = useState(() => isMobileInspectorViewport())
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  // ─═̷─ Panel opacity — driven by system uiOpacity setting ─═̷─
  const { settings: inspectorSettings } = useContext(SettingsContext)
  const opacity = inspectorSettings.uiOpacity

  // Persist position on drag end
  useEffect(() => {
    if (!isDragging) {
      localStorage.setItem('oasis-inspector-pos', JSON.stringify(position))
    }
  }, [isDragging, position])

  useEffect(() => {
    if (!isOpen) return
    const updateViewport = () => {
      const nextMobile = isMobileInspectorViewport()
      setMobileViewport(nextMobile)
      setPosition(current => clampInspectorPosition(nextMobile ? { x: 8, y: 64 } : current, nextMobile))
    }
    updateViewport()
    window.addEventListener('resize', updateViewport)
    window.addEventListener('orientationchange', updateViewport)
    return () => {
      window.removeEventListener('resize', updateViewport)
      window.removeEventListener('orientationchange', updateViewport)
    }
  }, [isOpen])

  const collapseContextValue = useMemo<InspectorCollapseContextValue>(() => ({
    expanded: expandedSections,
    toggle: (key) => setExpandedSections(current => ({ ...current, [key]: current[key] !== true })),
  }), [expandedSections])

  // ─═̷─ Store slices ─═̷─
  const inspectedObjectId = useOasisStore(s => s.inspectedObjectId)
  const behaviors = useOasisStore(s => s.behaviors)
  const transforms = useOasisStore(s => s.transforms)
  const placedCatalogAssets = useOasisStore(s => s.placedCatalogAssets)
  const craftedScenes = useOasisStore(s => s.craftedScenes)
  const portalGates = useOasisStore(s => s.portalGates)
  const worldRegistry = useOasisStore(s => s.worldRegistry)
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const conjuredAssets = useOasisStore(s => s.conjuredAssets)
  const worldConjuredAssetIds = useOasisStore(s => s.worldConjuredAssetIds)
  const setObjectBehavior = useOasisStore(s => s.setObjectBehavior)
  const audioPlaybackScopes = useOasisStore(s => s.audioPlaybackScopes)
  const localAudioBehaviors = useOasisStore(s => s.localAudioBehaviors)
  const setAudioPlaybackScope = useOasisStore(s => s.setAudioPlaybackScope)
  const setAudioPlaybackBehavior = useOasisStore(s => s.setAudioPlaybackBehavior)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const removeCatalogAsset = useOasisStore(s => s.removeCatalogAsset)
  const removeCraftedScene = useOasisStore(s => s.removeCraftedScene)
  const removePortalGate = useOasisStore(s => s.removePortalGate)
  const updatePortalGate = useOasisStore(s => s.updatePortalGate)
  const removeConjuredAssetFromWorld = useOasisStore(s => s.removeConjuredAssetFromWorld)
  const selectObject = useOasisStore(s => s.selectObject)
  const setObjectTransform = useOasisStore(s => s.setObjectTransform)
  const objectMeshStats = useOasisStore(s => s.objectMeshStats)
  const transformMode = useOasisStore(s => s.transformMode)
  const setTransformMode = useOasisStore(s => s.setTransformMode)

  useEffect(() => {
    setExpandedSections({})
  }, [inspectedObjectId])

  const worldLights = useOasisStore(s => s.worldLights)
  const updateWorldLight = useOasisStore(s => s.updateWorldLight)
  const removeWorldLight = useOasisStore(s => s.removeWorldLight)
  const updateCatalogPlacement = useOasisStore(s => s.updateCatalogPlacement)
  const spatialWebObjects = useOasisStore(s => s.spatialWebObjects)
  const removeSpatialWebObject = useOasisStore(s => s.removeSpatialWebObject)

  const placedAgentWindows = useOasisStore(s => s.placedAgentWindows)
  const updateAgentWindow = useOasisStore(s => s.updateAgentWindow)
  const removeAgentWindow = useOasisStore(s => s.removeAgentWindow)

  const paintStrokes = useOasisStore(s => s.paintStrokes)
  const updatePaintStroke = useOasisStore(s => s.updatePaintStroke)
  const removePaintStroke = useOasisStore(s => s.removePaintStroke)
  const playPaintStroke = useOasisStore(s => s.playPaintStroke)
  const stopPaintStrokePlayback = useOasisStore(s => s.stopPaintStrokePlayback)
  const text3dObjects = useOasisStore(s => s.text3dObjects)
  const updateText3dObject = useOasisStore(s => s.updateText3dObject)
  const removeText3dObject = useOasisStore(s => s.removeText3dObject)

  // ─═̷─ Resolve the inspected object: who are you? ─═̷─
  const resolved = useMemo(() => {
    if (!inspectedObjectId) return null

    // 1. Catalog asset?
    const catalog = placedCatalogAssets.find(a => a.id === inspectedObjectId)
    if (catalog) return { type: 'catalog' as const, id: catalog.id, name: catalog.name, data: catalog }

    // 2. Crafted scene?
    const crafted = craftedScenes.find(s => s.id === inspectedObjectId)
    if (crafted) return { type: 'crafted' as const, id: crafted.id, name: crafted.name, data: crafted }

    // 3. Portal gate?
    const portal = portalGates.find(gate => gate.id === inspectedObjectId)
    if (portal) {
      return {
        type: 'portal' as const,
        id: portal.id,
        name: portal.targetWorldName ? `Portal to ${portal.targetWorldName}` : 'Portal gate',
        data: {
          ...portal,
          rotation: [0, portal.rotationY ?? 0, 0] as [number, number, number],
          scale: portal.scale ?? 1,
        },
      }
    }

    // 3. Conjured asset in world?
    if (worldConjuredAssetIds.includes(inspectedObjectId)) {
      const conjured = conjuredAssets.find(a => a.id === inspectedObjectId)
      if (conjured) return { type: 'conjured' as const, id: conjured.id, name: conjured.displayName || conjured.prompt.slice(0, 40), data: conjured }
    }

    // 4. World light?
    const light = worldLights.find(l => l.id === inspectedObjectId)
    if (light) return { type: 'light' as const, id: light.id, name: `${light.type} light`, data: light }

    // 5. Agent window?
    const agentWin = placedAgentWindows.find(w => w.id === inspectedObjectId)
    if (agentWin) return { type: 'agent' as const, id: agentWin.id, name: agentWin.label || `${agentWin.agentType} window`, data: agentWin }

    // 6. Spatial web primitive?
    const spatial = spatialWebObjects.find(object => object.id === inspectedObjectId)
    if (spatial) return { type: 'spatial-web' as const, id: spatial.id, name: spatial.label, data: spatial }

    // 7. Paint stroke?
    const stroke = paintStrokes.find(s => s.id === inspectedObjectId)
    if (stroke) return { type: 'paint_stroke' as const, id: stroke.id, name: 'paint stroke', data: stroke }

    // 8. 3D text?
    const t3d = text3dObjects.find(t => t.id === inspectedObjectId)
    if (t3d) return { type: 'text_3d' as const, id: t3d.id, name: t3d.text.slice(0, 28) || '3D text', data: t3d }

    return null
  }, [inspectedObjectId, placedCatalogAssets, craftedScenes, portalGates, conjuredAssets, worldConjuredAssetIds, worldLights, placedAgentWindows, spatialWebObjects, paintStrokes, text3dObjects])

  // ─═̷─ Current behavior (or defaults) ─═̷─
  const behavior: ObjectBehavior = useMemo(() => {
    if (!inspectedObjectId) return { movement: { type: 'static' }, visible: true }
    return behaviors[inspectedObjectId] || { movement: { type: 'static' }, visible: true }
  }, [inspectedObjectId, behaviors])

  // ─═̷─ Current transform ─═̷─
  const transform = useMemo(() => {
    if (!inspectedObjectId) return { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] | number }

    const base = resolved?.data as {
      position?: [number, number, number]
      rotation?: [number, number, number]
      scale?: [number, number, number] | number
    } | undefined
    const override = transforms[inspectedObjectId]

    return {
      position: override?.position || base?.position || ([0, 0, 0] as [number, number, number]),
      rotation: override?.rotation || base?.rotation || ([0, 0, 0] as [number, number, number]),
      scale: override?.scale ?? base?.scale ?? 1,
    }
  }, [inspectedObjectId, resolved, transforms])

  // ─═̷─ Display name (behavior label > resolved name > fallback) ─═̷─

  // ─═̷─ Movement type ─═̷─
  const movementType: MovementType = behavior.movement.type

  // ═══════════════════════════════════════════════════════════════════════════
  // BEHAVIOR MUTATION HELPERS
  // Each one calls setObjectBehavior → live preview in world
  // ═══════════════════════════════════════════════════════════════════════════

  const updateLabel = useCallback((label: string) => {
    if (!inspectedObjectId) return
    setObjectBehavior(inspectedObjectId, { label: label || undefined })
  }, [inspectedObjectId, setObjectBehavior])

  const updateMovement = useCallback((movement: MovementPreset) => {
    if (!inspectedObjectId) return
    setObjectBehavior(inspectedObjectId, { movement })
  }, [inspectedObjectId, setObjectBehavior])

  const updateAnimation = useCallback((animation: AnimationConfig | undefined) => {
    if (!inspectedObjectId) return
    setObjectBehavior(inspectedObjectId, { animation })
  }, [inspectedObjectId, setObjectBehavior])

  const toggleVisibility = useCallback(() => {
    if (!inspectedObjectId) return
    setObjectBehavior(inspectedObjectId, { visible: !behavior.visible })
  }, [inspectedObjectId, behavior.visible, setObjectBehavior])

  /** ░▒▓ Switch movement type — resets params to defaults ▓▒░ */
  const switchMovementType = useCallback((type: MovementType) => {
    const defaults: Record<MovementType, MovementPreset> = {
      static:   { type: 'static' },
      spin:     { type: 'spin', axis: 'y', speed: 1.0 },
      hover:    { type: 'hover', amplitude: 0.3, speed: 1.5, offset: 0 },
      orbit:    { type: 'orbit', radius: 2.0, speed: 1.0, axis: 'xz' },
      bounce:   { type: 'bounce', height: 1.0, speed: 2.0 },
      pendulum: { type: 'pendulum', axis: 'x', angle: 30, speed: 1.0 },
      patrol:   { type: 'patrol', radius: 6.0, speed: 0.5 },
    }
    updateMovement(defaults[type])
  }, [updateMovement])

  /** ░▒▓ Reset transform to origin ▓▒░ */
  const resetTransform = useCallback(() => {
    if (!inspectedObjectId) return
    setObjectTransform(inspectedObjectId, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })
  }, [inspectedObjectId, setObjectTransform])

  /** ░▒▓ Precise transform editing — update a single axis value ▓▒░ */
  const updateTransformAxis = useCallback((property: 'position' | 'rotation' | 'scale', axis: 0 | 1 | 2, value: number) => {
    if (!inspectedObjectId) return
    const base = resolved?.data as {
      position?: [number, number, number]
      rotation?: [number, number, number]
      scale?: [number, number, number] | number
    } | undefined
    const current = transforms[inspectedObjectId]
    const baseScale = base?.scale ?? 1
    const pos = [...(current?.position || base?.position || [0, 0, 0])] as [number, number, number]
    const rot = [...(current?.rotation || base?.rotation || [0, 0, 0])] as [number, number, number]
    const scl = typeof current?.scale === 'number'
      ? [current.scale, current.scale, current.scale] as [number, number, number]
      : Array.isArray(current?.scale)
        ? [...current.scale] as [number, number, number]
        : typeof baseScale === 'number'
          ? [baseScale, baseScale, baseScale] as [number, number, number]
          : [...baseScale] as [number, number, number]
    if (property === 'position') pos[axis] = value
    else if (property === 'rotation') rot[axis] = value
    else scl[axis] = value
    setObjectTransform(inspectedObjectId, { position: pos, rotation: rot, scale: scl })
  }, [inspectedObjectId, resolved, setObjectTransform, transforms])

  /** ░▒▓ Delete object from world ▓▒░ */
  const handleDelete = useCallback(() => {
    if (!resolved || !inspectedObjectId) return
    if (resolved.type === 'catalog') removeCatalogAsset(inspectedObjectId)
    else if (resolved.type === 'crafted') removeCraftedScene(inspectedObjectId)
    else if (resolved.type === 'portal') removePortalGate(inspectedObjectId)
    else if (resolved.type === 'conjured') removeConjuredAssetFromWorld(inspectedObjectId)
    else if (resolved.type === 'light') removeWorldLight(inspectedObjectId)
    else if (resolved.type === 'agent') removeAgentWindow(inspectedObjectId)
    else if (resolved.type === 'spatial-web') removeSpatialWebObject(inspectedObjectId)
    else if (resolved.type === 'paint_stroke') removePaintStroke(inspectedObjectId)
    else if (resolved.type === 'text_3d') removeText3dObject(inspectedObjectId)
    selectObject(null)
    setInspectedObject(null)
    onClose()
  }, [resolved, inspectedObjectId, removeCatalogAsset, removeCraftedScene, removePortalGate, removeConjuredAssetFromWorld, removeWorldLight, removeAgentWindow, removeSpatialWebObject, removePaintStroke, removeText3dObject, selectObject, setInspectedObject, onClose])

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG HANDLERS (same pattern as WizardConsole / AssetExplorerWindow)
  // ═══════════════════════════════════════════════════════════════════════════

  const handleDragStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    if ((e.target as HTMLElement).closest('input')) return
    if ((e.target as HTMLElement).closest('select')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    e.preventDefault()
  }, [position])

  const handleDrag = useCallback((e: PointerEvent) => {
    if (!isDragging) return
    setPosition(clampInspectorPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    }, mobileViewport))
  }, [isDragging, mobileViewport])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  // Global mouse events for drag
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('pointermove', handleDrag)
      document.addEventListener('pointerup', handleDragEnd)
    }
    return () => {
      document.removeEventListener('pointermove', handleDrag)
      document.removeEventListener('pointerup', handleDragEnd)
    }
  }, [isDragging, handleDrag, handleDragEnd])

  // ═══════════════════════════════════════════════════════════════════════════
  // BAIL CONDITIONS
  // ═══════════════════════════════════════════════════════════════════════════

  if (!isOpen || !inspectedObjectId || !resolved) return null

  // ─═̷─ Format helpers ─═̷─
  const fmt = (n: number) => n.toFixed(2)
  const rad2deg = (r: number) => (r * 180 / Math.PI).toFixed(1)

  const pos = transform.position || [0, 0, 0] as [number, number, number]
  const rot = transform.rotation || [0, 0, 0]
  const scl = transform.scale
  const sclArr: [number, number, number] = typeof scl === 'number' ? [scl, scl, scl] : (scl || [1, 1, 1])

  const badge = TYPE_BADGE[resolved.type] || { bg: 'rgba(34, 211, 238, 0.2)', text: '#67E8F9', label: 'portal' }

  // ─═̷─ Mesh stats for this object (if GLB has been loaded) ─═̷─
  const stats: ModelStats | undefined = objectMeshStats[inspectedObjectId]
  const inspectorWidth = getInspectorPanelWidth(mobileViewport)
  const inspectorPanelStyle: React.CSSProperties = mobileViewport
    ? {
        zIndex: useOasisStore.getState().getPanelZIndex('inspector', 9998),
        left: position.x,
        top: position.y,
        width: inspectorWidth,
        minWidth: 0,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100dvh - 232px)',
        backgroundColor: `rgba(0, 0, 0, ${opacity})`,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: `0 0 30px ${INSPECTOR_COLOR}22, 0 0 60px rgba(0, 0, 0, 0.5)`,
      }
    : {
        zIndex: useOasisStore.getState().getPanelZIndex('inspector', 9998),
        left: position.x,
        top: position.y,
        width: DEFAULT_WIDTH,
        minWidth: MIN_WIDTH,
        maxWidth: MAX_WIDTH,
        maxHeight: 'calc(100vh - 100px)',
        backgroundColor: `rgba(0, 0, 0, ${opacity})`,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: `0 0 30px ${INSPECTOR_COLOR}22, 0 0 60px rgba(0, 0, 0, 0.5)`,
      }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — The inspector portal opens
  // ░▒▓█ Every object deserves to be seen █▓▒░
  // ═══════════════════════════════════════════════════════════════════════════

  return createPortal(
    <InspectorCollapseContext.Provider value={collapseContextValue}>
    <div
      data-menu-portal="object-inspector"
      data-ui-panel
      className="fixed rounded-xl overflow-hidden shadow-2xl flex flex-col"
      style={inspectorPanelStyle}
      onMouseDown={(e) => { e.stopPropagation(); useOasisStore.getState().bringPanelToFront('inspector') }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <style>{`
        [data-menu-portal="object-inspector"] [data-inspector-section][data-collapsed="true"] + * {
          display: none !important;
        }
      `}</style>
      {/* ─═̷─═̷─ HEADER ─═̷─═̷─ draggable, shows name + type badge + close */}
      <div
        className={`px-3 py-2 border-b border-white/5 flex items-center gap-2 cursor-grab active:cursor-grabbing select-none flex-shrink-0 ${mobileViewport ? 'py-2.5' : ''}`}
        onPointerDown={handleDragStart}
        style={{
          background: `linear-gradient(135deg, ${INSPECTOR_COLOR}15 0%, rgba(0,0,0,0) 100%)`,
        }}
      >
        {/* Editable name */}
        <input
          type="text"
          value={behavior.label ?? resolved.name}
          onChange={(e) => updateLabel(e.target.value)}
          className="flex-1 bg-transparent text-sm font-bold text-gray-200 border-none outline-none placeholder-gray-600 min-w-0 cursor-text"
          placeholder={resolved.name}
          title="Rename this object"
          onClick={(e) => e.stopPropagation()}
        />

        {/* Type badge */}
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full font-mono shrink-0"
          style={{ background: badge.bg, color: badge.text }}
        >
          {badge.label}
        </span>

        {/* LLM model badge — crafted scenes only */}
        {resolved.type === 'crafted' && (resolved.data as any)?.model && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono shrink-0 bg-blue-500/15 text-blue-400" title="Crafted by this LLM">
            {(resolved.data as any).model.split('/').pop()}
          </span>
        )}

        {/* File size badge */}
        {stats?.fileSize != null && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono shrink-0 bg-sky-500/15 text-sky-400">
            {formatBytes(stats.fileSize)}
          </span>
        )}

        {/* Close */}
        <button
          onClick={() => { setInspectedObject(null); onClose() }}
          className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-300/35 bg-red-950/30 text-2xl leading-none text-red-100 transition-colors hover:border-red-200/70 hover:bg-red-900/55 hover:text-white"
          aria-label="Close object inspector"
        >
          &#215;
        </button>
      </div>

      {/* ─═̷─═̷─ SCROLLABLE BODY ─═̷─═̷─ */}
      <div className={`flex-1 min-h-0 overflow-y-auto space-y-1 ${mobileViewport ? 'px-2 py-2' : 'px-3 py-2'}`}>

        {/* ░▒▓ TRANSFORM — mode switcher + readout ▓▒░ */}
        <SectionHeader>&#9670; Transform</SectionHeader>
        <div className="rounded-lg border border-white/5 p-2 space-y-1.5" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
          {/* T/R/S mode switcher — R/T/Y hotkeys also work globally */}
          <div className="flex items-center gap-1 mb-1">
            {(['translate', 'rotate', 'scale'] as const).map(m => (
              <button
                key={m}
                onClick={() => { selectObject(inspectedObjectId); setTransformMode(m) }}
                className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors flex-1 ${
                  transformMode === m
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-gray-400 border border-gray-700/30 hover:text-gray-200 hover:border-gray-500/50'
                }`}
              >
                {m === 'translate' ? 'R Move' : m === 'rotate' ? 'T Rot' : 'Y Scale'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-x-1 text-[10px] font-mono items-center">
            <span className="text-gray-400"></span>
            <span className="text-red-400/60 text-center">X</span>
            <span className="text-green-400/60 text-center">Y</span>
            <span className="text-blue-400/60 text-center">Z</span>

            <span className="text-gray-400">pos</span>
            {([0, 1, 2] as const).map(axis => (
              <input
                key={`pos-${axis}`}
                type="number"
                step={0.1}
                value={fmt(pos[axis])}
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updateTransformAxis('position', axis, v) }}
                className="bg-transparent border border-gray-700/40 rounded px-1 py-0.5 text-gray-300 text-center w-full focus:border-sky-500/60 focus:outline-none hover:border-gray-500/60 transition-colors"
              />
            ))}

            <span className="text-gray-400">rot</span>
            {([0, 1, 2] as const).map(axis => (
              <input
                key={`rot-${axis}`}
                type="number"
                step={1}
                value={rad2deg(rot[axis])}
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updateTransformAxis('rotation', axis, v * Math.PI / 180) }}
                className="bg-transparent border border-gray-700/40 rounded px-1 py-0.5 text-gray-300 text-center w-full focus:border-sky-500/60 focus:outline-none hover:border-gray-500/60 transition-colors"
              />
            ))}

            <span className="text-gray-400">scl</span>
            {([0, 1, 2] as const).map(axis => (
              <input
                key={`scl-${axis}`}
                type="number"
                step={0.1}
                min={0.01}
                value={fmt(sclArr[axis])}
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) updateTransformAxis('scale', axis, v) }}
                className="bg-transparent border border-gray-700/40 rounded px-1 py-0.5 text-gray-300 text-center w-full focus:border-sky-500/60 focus:outline-none hover:border-gray-500/60 transition-colors"
              />
            ))}
          </div>
          <button
            onClick={resetTransform}
            className="text-[9px] text-gray-400 hover:text-sky-400 font-mono border border-gray-700/30 rounded px-2 py-0.5 mt-1 transition-colors"
          >
            Reset transform
          </button>
        </div>

        {/* ░▒▓ MESH STATS — the polygon anatomy ▓▒░ */}
        {stats && (
          <>
            <SectionHeader>&#9651; Mesh Stats</SectionHeader>
            <div className="rounded-lg border border-white/5 p-2" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-300 font-mono">{'\u25B3'} Triangles</span>
                  <span className="text-[9px] font-mono font-medium text-sky-400">{formatNumber(stats.triangles)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-300 font-mono">{'\u25CF'} Vertices</span>
                  <span className="text-[9px] font-mono font-medium text-sky-400">{formatNumber(stats.vertices)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-300 font-mono">{'\u25A6'} Meshes</span>
                  <span className="text-[9px] font-mono font-medium text-sky-400">{stats.meshCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-300 font-mono">{'\u{1F3A8}'} Materials</span>
                  <span className="text-[9px] font-mono font-medium text-sky-400">{stats.materialCount}</span>
                </div>
                {stats.boneCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-gray-300 font-mono">{'\u{1F9B4}'} Bones</span>
                    <span className="text-[9px] font-mono font-medium text-sky-400">{stats.boneCount}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-300 font-mono">{'\u{1F4D0}'} Bounds</span>
                  <span className="text-[9px] font-mono font-medium text-sky-400">
                    {stats.dimensions.w} {'\u00D7'} {stats.dimensions.h} {'\u00D7'} {stats.dimensions.d}
                  </span>
                </div>
                {stats.fileSize != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-gray-300 font-mono">{'\u{1F4BE}'} File</span>
                    <span className="text-[9px] font-mono font-medium text-sky-400">{formatBytes(stats.fileSize)}</span>
                  </div>
                )}
              </div>

              {/* Animation clip durations — click to play */}
              {stats.clips.length > 0 && (
                <div className="mt-1.5 pt-1 border-t border-white/5">
                  <div className="text-[8px] text-gray-400 uppercase tracking-widest font-mono mb-0.5">
                    Clips ({stats.clips.length}) — click to play
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {stats.clips.map(clip => {
                      const isActive = behavior.animation?.clipName === clip.name
                      return (
                        <button
                          key={clip.name}
                          className={`flex items-center justify-between w-full px-1 py-0.5 rounded transition-colors text-left ${
                            isActive
                              ? 'bg-sky-500/20 border border-sky-500/30'
                              : 'hover:bg-white/5 border border-transparent'
                          }`}
                          onClick={() => {
                            if (isActive) {
                              updateAnimation(undefined)
                            } else {
                              updateAnimation({ clipName: clip.name, loop: 'repeat', speed: 1.0 })
                            }
                          }}
                          title={isActive ? `Stop ${clip.name}` : `Play ${clip.name}`}
                        >
                          <span className={`text-[9px] font-mono truncate mr-1 ${isActive ? 'text-sky-300' : 'text-gray-500'}`}>
                            {isActive ? '\u25B6 ' : ''}{clip.name.length > 12 ? clip.name.slice(0, 12) + '..' : clip.name}
                          </span>
                          <span className="text-[9px] font-mono shrink-0 text-sky-400">{clip.duration.toFixed(1)}s</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ░▒▓ MOVEMENT PRESET ▓▒░ */}
        <SectionHeader>&#9654; Movement</SectionHeader>
        <PillSelector
          value={movementType}
          options={[...MOVEMENT_TYPES]}
          onChange={switchMovementType}
        />

        {/* ─═̷─ Movement-specific parameters ─═̷─ */}
        {movementType !== 'static' && (
          <div className="rounded-lg border border-white/5 p-2 space-y-1.5 mt-1" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>

            {/* SPIN — axis + speed */}
            {behavior.movement.type === 'spin' && (() => {
              const m = behavior.movement
              return (
                <>
                  <AxisPicker
                    value={m.axis}
                    options={['x', 'y', 'z']}
                    onChange={(axis) => updateMovement({ type: 'spin', axis, speed: m.speed })}
                  />
                  <ParamSlider
                    label="speed"
                    value={m.speed}
                    min={0.1} max={10} step={0.1}
                    onChange={(speed) => updateMovement({ type: 'spin', axis: m.axis, speed })}
                  />
                </>
              )
            })()}

            {/* HOVER — amplitude + speed + offset */}
            {behavior.movement.type === 'hover' && (() => {
              const m = behavior.movement
              return (
                <>
                  <ParamSlider
                    label="amplitude"
                    value={m.amplitude}
                    min={0.1} max={2.0} step={0.1}
                    onChange={(amplitude) => updateMovement({ type: 'hover', amplitude, speed: m.speed, offset: m.offset })}
                  />
                  <ParamSlider
                    label="speed"
                    value={m.speed}
                    min={0.5} max={5.0} step={0.1}
                    onChange={(speed) => updateMovement({ type: 'hover', amplitude: m.amplitude, speed, offset: m.offset })}
                  />
                  <ParamSlider
                    label="offset"
                    value={m.offset}
                    min={0} max={1} step={0.05}
                    onChange={(offset) => updateMovement({ type: 'hover', amplitude: m.amplitude, speed: m.speed, offset })}
                  />
                </>
              )
            })()}

            {/* ORBIT — axis + radius + speed */}
            {behavior.movement.type === 'orbit' && (() => {
              const m = behavior.movement
              return (
                <>
                  <AxisPicker
                    value={m.axis}
                    options={['xz', 'xy', 'yz']}
                    onChange={(axis) => updateMovement({ type: 'orbit', radius: m.radius, speed: m.speed, axis })}
                  />
                  <ParamSlider
                    label="radius"
                    value={m.radius}
                    min={0.5} max={10} step={0.1}
                    onChange={(radius) => updateMovement({ type: 'orbit', radius, speed: m.speed, axis: m.axis })}
                  />
                  <ParamSlider
                    label="speed"
                    value={m.speed}
                    min={0.1} max={5} step={0.1}
                    onChange={(speed) => updateMovement({ type: 'orbit', radius: m.radius, speed, axis: m.axis })}
                  />
                </>
              )
            })()}

            {/* BOUNCE — height + speed */}
            {behavior.movement.type === 'bounce' && (() => {
              const m = behavior.movement
              return (
                <>
                  <ParamSlider
                    label="height"
                    value={m.height}
                    min={0.5} max={5} step={0.1}
                    onChange={(height) => updateMovement({ type: 'bounce', height, speed: m.speed })}
                  />
                  <ParamSlider
                    label="speed"
                    value={m.speed}
                    min={0.5} max={5} step={0.1}
                    onChange={(speed) => updateMovement({ type: 'bounce', height: m.height, speed })}
                  />
                </>
              )
            })()}

            {/* PENDULUM — axis + angle + speed */}
            {behavior.movement.type === 'pendulum' && (() => {
              const m = behavior.movement
              return (
                <>
                  <AxisPicker
                    value={m.axis}
                    options={['x', 'y', 'z']}
                    onChange={(axis) => updateMovement({ type: 'pendulum', axis, angle: m.angle, speed: m.speed })}
                  />
                  <ParamSlider
                    label="angle"
                    value={m.angle}
                    min={5} max={90} step={1}
                    onChange={(angle) => updateMovement({ type: 'pendulum', axis: m.axis, angle, speed: m.speed })}
                  />
                  <ParamSlider
                    label="speed"
                    value={m.speed}
                    min={0.5} max={5} step={0.1}
                    onChange={(speed) => updateMovement({ type: 'pendulum', axis: m.axis, angle: m.angle, speed })}
                  />
                </>
              )
            })()}
          </div>
        )}

        {/* ░▒▓ LIGHT CONTROLS (light objects only) — intensity, color, direction ▓▒░ */}
        {resolved.type === 'light' && (() => {
          const light = resolved.data as import('../../lib/conjure/types').WorldLight

          // Derive azimuth/elevation for directional (from position) and spot (from target)
          let azimuth = 0, elevation = 45
          if (light.type === 'directional') {
            const p = light.position || [30, 40, 20]
            const d = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) || 50
            elevation = Math.asin(Math.min(1, Math.max(-1, p[1] / d))) * 180 / Math.PI
            azimuth = ((Math.atan2(p[0], p[2]) * 180 / Math.PI) + 360) % 360
          } else if (light.type === 'spot') {
            const t = light.target || [0, -1, 0]
            const tLen = Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]) || 1
            elevation = Math.asin(Math.min(1, Math.max(-1, t[1] / tLen))) * 180 / Math.PI
            azimuth = ((Math.atan2(t[0], t[2]) * 180 / Math.PI) + 360) % 360
          }

          const maxIntensity = LIGHT_INTENSITY_MAX[light.type]
          const intensityStep = LIGHT_INTENSITY_STEP[light.type]

          return (
            <>
              <SectionHeader>💡 Light Properties</SectionHeader>
              <div className="rounded-lg border border-white/5 p-2 space-y-1.5" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
                {/* Light type (read-only) */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">type</span>
                  <span className="text-[10px] text-yellow-300 font-mono">{light.type}</span>
                </div>

                {/* Color picker */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">color</span>
                  <input
                    type="color"
                    value={light.color}
                    onChange={(e) => updateWorldLight(light.id, { color: e.target.value })}
                    className="w-6 h-6 rounded border border-gray-700/30 cursor-pointer bg-transparent"
                  />
                  <span className="text-[9px] text-gray-400 font-mono">{light.color}</span>
                </div>

                {/* Ground color picker (hemisphere only) */}
                {light.type === 'hemisphere' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">ground</span>
                    <input
                      type="color"
                      value={light.groundColor || '#3a5f0b'}
                      onChange={(e) => updateWorldLight(light.id, { groundColor: e.target.value })}
                      className="w-6 h-6 rounded border border-gray-700/30 cursor-pointer bg-transparent"
                    />
                    <span className="text-[9px] text-gray-400 font-mono">{light.groundColor || '#3a5f0b'}</span>
                  </div>
                )}

                {/* Intensity slider — 5000 max for spot (theatrical), 500 for others */}
                <ParamSlider
                  label="intensity"
                  value={light.intensity}
                  min={0} max={maxIntensity} step={intensityStep}
                  onChange={(v) => updateWorldLight(light.id, { intensity: v })}
                />

                {/* Angle slider (spot only) */}
                {light.type === 'spot' && (
                  <ParamSlider
                    label="angle"
                    value={light.angle || 45}
                    min={5} max={90} step={1}
                    onChange={(v) => updateWorldLight(light.id, { angle: v })}
                  />
                )}

                {/* Azimuth + Elevation — directional (moves sun position) and spot (aims the cone) */}
                {(light.type === 'directional' || light.type === 'spot') && (
                  <>
                    <ParamSlider
                      label="azimuth"
                      value={Math.round(azimuth)}
                      min={0} max={360} step={1}
                      onChange={(v) => {
                        const a = v * Math.PI / 180
                        const el = Math.round(elevation) * Math.PI / 180
                        if (light.type === 'directional') {
                          const r = 50
                          updateWorldLight(light.id, { position: [
                            r * Math.cos(el) * Math.sin(a),
                            r * Math.sin(el),
                            r * Math.cos(el) * Math.cos(a),
                          ]})
                        } else {
                          updateWorldLight(light.id, { target: [
                            Math.cos(el) * Math.sin(a),
                            Math.sin(el),
                            Math.cos(el) * Math.cos(a),
                          ]})
                        }
                      }}
                    />
                    <ParamSlider
                      label="elevation"
                      value={Math.round(elevation)}
                      min={light.type === 'spot' ? -90 : 5} max={90} step={1}
                      onChange={(v) => {
                        const el = v * Math.PI / 180
                        const a = Math.round(azimuth) * Math.PI / 180
                        if (light.type === 'directional') {
                          const r = 50
                          updateWorldLight(light.id, { position: [
                            r * Math.cos(el) * Math.sin(a),
                            r * Math.sin(el),
                            r * Math.cos(el) * Math.cos(a),
                          ]})
                        } else {
                          updateWorldLight(light.id, { target: [
                            Math.cos(el) * Math.sin(a),
                            Math.sin(el),
                            Math.cos(el) * Math.cos(a),
                          ]})
                        }
                      }}
                    />
                  </>
                )}
              </div>
            </>
          )
        })()}

        {/* ░▒▓ ANIMATION SECTION — conjured objects with baked clips only ▓▒░ */}
        {(resolved.type === 'conjured' && stats && stats.clips.length > 0) && (
          <>
            <SectionHeader>&#9835; Animation</SectionHeader>
            <div className="rounded-lg border border-white/5 p-2 space-y-1.5" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
              <div className="text-[9px] text-gray-400 font-mono mb-1">
                {stats.clips.length} baked clip{stats.clips.length > 1 ? 's' : ''} in model
              </div>

              {/* Clip name input — for baked clips in conjured models */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">clip</span>
                <input
                  type="text"
                  value={behavior.animation?.clipName || ''}
                  onChange={(e) => {
                    const val = e.target.value
                    if (!val) { updateAnimation(undefined); return }
                    updateAnimation({
                      clipName: val,
                      loop: behavior.animation?.loop || 'repeat',
                      speed: behavior.animation?.speed || 1.0,
                    })
                  }}
                  placeholder="clip name..."
                  className="flex-1 text-[10px] bg-black/60 border border-gray-700/30 rounded px-2 py-1 text-gray-300 placeholder-gray-700 font-mono focus:border-sky-500/40 focus:outline-none"
                />
              </div>

              {/* Loop mode pills */}
              {behavior.animation?.clipName && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">loop</span>
                    <PillSelector
                      value={behavior.animation.loop}
                      options={['once', 'repeat', 'pingpong'] as const}
                      onChange={(loop) => updateAnimation({ ...behavior.animation!, loop })}
                      labels={{ once: 'once', repeat: 'repeat', pingpong: 'ping-pong' }}
                    />
                  </div>

                  {/* Speed slider */}
                  <ParamSlider
                    label="speed"
                    value={behavior.animation.speed}
                    min={0.25} max={2.0} step={0.05}
                    onChange={(speed) => updateAnimation({ ...behavior.animation!, speed })}
                  />
                </>
              )}
            </div>
          </>
        )}

        {/* ░▒▓ ANIMATION LIBRARY — Local Mixamo moves for any rigged character ▓▒░ */}
        {stats && stats.boneCount > 0 && (
          <AnimationLibrarySection
            currentClipName={behavior.animation?.clipName}
            onSelectAnimation={(animId) => {
              const clipName = `${LIB_PREFIX}${animId}`
              // Toggle off if already playing
              if (behavior.animation?.clipName === clipName) {
                updateAnimation(undefined)
              } else {
                // Trigger load (async, ConjuredObject/VRMCatalogRenderer will pick it up)
                loadAnimationClip(animId)
                updateAnimation({ clipName, loop: 'repeat', speed: 1.0 })
              }
            }}
            onStopAnimation={() => updateAnimation(undefined)}
          />
        )}

        {/* Loop + speed controls for active library animation */}
        {behavior.animation?.clipName?.startsWith(LIB_PREFIX) && (
          <div className="rounded-lg border border-white/5 p-2 space-y-1.5" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">loop</span>
              <PillSelector
                value={behavior.animation.loop}
                options={['once', 'repeat', 'pingpong'] as const}
                onChange={(loop) => updateAnimation({ ...behavior.animation!, loop })}
                labels={{ once: 'once', repeat: 'repeat', pingpong: 'ping-pong' }}
              />
            </div>
            <ParamSlider
              label="speed"
              value={behavior.animation.speed}
              min={0.25} max={2.0} step={0.05}
              onChange={(speed) => updateAnimation({ ...behavior.animation!, speed })}
            />
          </div>
        )}

        {/* ░▒▓ FRAME PICKER — 8 frame styles for image placements ▓▒░ */}
        {resolved?.type === 'catalog' && ((resolved.data as any).imageUrl || (resolved.data as any).videoUrl) && (() => {
          const placement = resolved.data as import('../../lib/conjure/types').CatalogPlacement
          const currentFrame = placement.imageFrameStyle
          const isImage = Boolean(placement.imageUrl)
          const displayMode = isImage
            ? (placement.imageDisplayMode || (currentFrame === 'building' ? '3d' : '2d'))
            : '2d'
          const noFrameActive = displayMode === '2d' && (!currentFrame || currentFrame === 'building')
          return (
            <>
              <SectionHeader>&#128444;&#65039; Picture Shape</SectionHeader>
              <div className="rounded-lg border border-white/5 p-2" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
                {isImage && (
                  <div className="mb-2 grid grid-cols-2 gap-1">
                    {(['2d', '3d'] as const).map(mode => {
                      const active = displayMode === mode
                      return (
                        <button
                          key={mode}
                          onClick={() => updateCatalogPlacement(inspectedObjectId!, mode === '3d'
                            ? {
                                imageDisplayMode: '3d',
                                imageFrameStyle: 'building',
                                imageBuildingFrameColor: placement.imageBuildingFrameColor || '#f97316',
                                imageBuildingFrameThickness: placement.imageBuildingFrameThickness ?? 0.16,
                              }
                            : {
                                imageDisplayMode: '2d',
                                imageFrameStyle: currentFrame === 'building' ? undefined : currentFrame,
                              })}
                          className={`rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.08em] transition-colors ${
                            active
                              ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                              : 'border-gray-700/40 bg-black/30 text-gray-500 hover:border-gray-500/60 hover:text-gray-300'
                          }`}
                        >
                          {mode}
                        </button>
                      )
                    })}
                  </div>
                )}
                {displayMode === '2d' && (
                <div className="grid grid-cols-4 gap-1">
                  {/* No frame option */}
                  <button
                    onClick={() => updateCatalogPlacement(inspectedObjectId!, { imageDisplayMode: '2d', imageFrameStyle: undefined })}
                    className={`flex flex-col items-center gap-0.5 p-1.5 rounded transition-colors text-center ${
                      noFrameActive
                        ? 'bg-sky-500/20 border border-sky-500/40'
                        : 'border border-gray-700/30 hover:border-gray-500/50'
                    }`}
                  >
                    <span className="text-sm">✕</span>
                    <span className={`text-[8px] font-mono ${noFrameActive ? 'text-sky-300' : 'text-gray-500'}`}>None</span>
                  </button>
                  {/* 8 frame styles */}
                  {FRAME_STYLES.map(frame => {
                    const isActive = currentFrame === frame.id
                    return (
                      <button
                        key={frame.id}
                        onClick={() => updateCatalogPlacement(inspectedObjectId!, { imageDisplayMode: '2d', imageFrameStyle: frame.id })}
                        className={`flex flex-col items-center gap-0.5 p-1.5 rounded transition-colors text-center ${
                          isActive
                            ? 'bg-sky-500/20 border border-sky-500/40'
                            : 'border border-gray-700/30 hover:border-gray-500/50'
                        }`}
                        title={frame.desc}
                      >
                        <span className="text-sm">{frame.icon}</span>
                        <span className={`text-[8px] font-mono ${isActive ? 'text-sky-300' : 'text-gray-500'}`}>{frame.label}</span>
                      </button>
                    )
                  })}
                </div>
                )}
              </div>
              {/* Frame thickness slider — only shown when a frame is selected */}
              {displayMode === '2d' && currentFrame && currentFrame !== 'building' && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] text-gray-400 w-16">Thickness</span>
                  <input
                    type="range"
                    min="0.5"
                    max="50"
                    step="0.5"
                    value={placement.imageFrameThickness ?? 1}
                    onChange={e => updateCatalogPlacement(inspectedObjectId!, { imageFrameThickness: parseFloat(e.target.value) })}
                    className="flex-1 h-1 accent-sky-500"
                  />
                  <span className="text-[9px] text-gray-500 font-mono w-6 text-right">{(placement.imageFrameThickness ?? 1).toFixed(1)}</span>
                </div>
              )}
              {isImage && displayMode === '3d' && (
                <div className="mt-2 space-y-2 rounded-lg border border-white/5 p-2" style={{ background: 'rgba(10, 10, 10, 0.45)' }}>
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[10px] text-gray-400">Beams</span>
                    <input
                      type="color"
                      value={placement.imageBuildingFrameColor || '#f97316'}
                      onChange={e => updateCatalogPlacement(inspectedObjectId!, { imageBuildingFrameColor: e.target.value })}
                      className="h-7 w-9 rounded border border-white/10 bg-black/60"
                    />
                    <input
                      type="text"
                      value={placement.imageBuildingFrameColor || '#f97316'}
                      onChange={e => updateCatalogPlacement(inspectedObjectId!, { imageBuildingFrameColor: e.target.value })}
                      className="min-w-0 flex-1 rounded border border-white/10 bg-black/60 px-2 py-1 text-[10px] font-mono text-gray-200 focus:border-sky-500/50 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[10px] text-gray-400">Thickness</span>
                    <input
                      type="range"
                      min="0.03"
                      max="0.8"
                      step="0.01"
                      value={placement.imageBuildingFrameThickness ?? 0.16}
                      onChange={e => updateCatalogPlacement(inspectedObjectId!, { imageBuildingFrameThickness: parseFloat(e.target.value) })}
                      className="h-1 flex-1 accent-sky-500"
                    />
                    <span className="w-9 text-right font-mono text-[9px] text-gray-500">{(placement.imageBuildingFrameThickness ?? 0.16).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </>
          )
        })()}

        {/* ░▒▓ AUDIO CONTROLS — any object can become a loudspeaker ▓▒░ */}
        {resolved && (() => {
          const objectId = inspectedObjectId!
          const sharedBeh = behaviors[objectId] || {}
          const playbackScope = audioPlaybackScopes[objectId] || 'shared'
          const beh = playbackScope === 'local'
            ? { ...sharedBeh, ...(localAudioBehaviors[objectId] || {}) }
            : sharedBeh
          const writePlayback = (updates: Partial<Pick<ObjectBehavior, 'audioState' | 'audioMuted' | 'audioLoop' | 'audioVolume' | 'audioMaxDistance' | 'audioPlaybackId' | 'audioStartedAt' | 'audioUpdatedAt'>>) => {
            const now = new Date().toISOString()
            const enriched = { ...updates, audioUpdatedAt: now }
            if (updates.audioState === 'playing') {
              enriched.audioPlaybackId = `audio-playback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
              enriched.audioStartedAt = now
            }
            setAudioPlaybackBehavior(objectId, enriched)
          }
          const placement = resolved.type === 'catalog' ? resolved.data as import('../../lib/conjure/types').CatalogPlacement : null
          const hasAudio = !!(sharedBeh.audioUrl || placement?.videoUrl || placement?.audioUrl)
          return (
            <>
              <SectionHeader>&#128266; Audio</SectionHeader>
              <div className="rounded-lg border border-white/5 p-2 space-y-2" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
                {!hasAudio ? (
                  <>
                    <div className="text-[10px] text-gray-500">Make this object a loudspeaker</div>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        placeholder="/images/my-song.mp3"
                        className="flex-1 bg-black/60 border border-sky-500/20 rounded px-2 py-1 text-[10px] text-white placeholder-gray-600 font-mono focus:outline-none focus:border-sky-500/40"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const url = (e.target as HTMLInputElement).value.trim()
                            if (url) setObjectBehavior(inspectedObjectId!, { audioUrl: url })
                          }
                        }}
                      />
                      <label className="text-[10px] px-2 py-1 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 transition-colors cursor-pointer">
                        Upload
                        <input type="file" accept="audio/*" className="hidden" onChange={async e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const formData = new FormData()
                          formData.append('file', file)
                          const res = await fetch('/api/media/upload', { method: 'POST', body: formData })
                          if (res.ok) {
                            const { url } = await res.json()
                            setObjectBehavior(inspectedObjectId!, { audioUrl: url })
                          }
                        }} />
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Audio URL display */}
                    {sharedBeh.audioUrl && (
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-gray-500 font-mono truncate flex-1">{sharedBeh.audioUrl}</span>
                        <button
                          onClick={() => setObjectBehavior(inspectedObjectId!, { audioUrl: undefined })}
                          className="text-[9px] text-red-400 hover:text-red-300"
                        >✕</button>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      {(['shared', 'local'] as const).map(scope => (
                        <button
                          key={scope}
                          onClick={() => setAudioPlaybackScope(objectId, scope)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            playbackScope === scope
                              ? 'border-sky-400/55 bg-sky-500/20 text-sky-200'
                              : 'border-gray-600/30 bg-gray-700/10 text-gray-500 hover:text-gray-300'
                          }`}
                          title={scope === 'shared' ? 'Playback changes sync to the room' : 'Playback changes affect only this device'}
                        >
                          {scope === 'shared' ? 'Shared' : 'Personal'}
                        </button>
                      ))}
                    </div>
                    {/* Transport: play/pause/stop */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => writePlayback({ audioState: 'playing', audioMuted: false })}
                        className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                          beh.audioState !== 'paused' && beh.audioState !== 'stopped'
                            ? 'border-green-500/50 bg-green-500/30 text-green-300'
                            : 'border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20'
                        }`}
                        title="Play"
                      >&#9654;</button>
                      <button
                        onClick={() => writePlayback({ audioState: 'paused' })}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          beh.audioState === 'paused'
                            ? 'border-yellow-500/50 bg-yellow-500/30 text-yellow-300'
                            : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20'
                        }`}
                        title="Pause"
                      >&#10074;&#10074;</button>
                      <button
                        onClick={() => writePlayback({ audioState: 'stopped' })}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          beh.audioState === 'stopped'
                            ? 'border-red-500/50 bg-red-500/30 text-red-300'
                            : 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                        }`}
                        title="Stop (rewind to start)"
                      >&#9632;</button>
                      <span className={`ml-2 text-[9px] font-mono ${
                        beh.audioState === 'paused' ? 'text-yellow-400' :
                        beh.audioState === 'stopped' ? 'text-red-400' : 'text-green-400'
                      }`}>
                        {beh.audioState === 'paused' ? '⏸ paused' :
                         beh.audioState === 'stopped' ? '⏹ stopped' : '🔊 playing'}
                      </span>
                    </div>
                    {/* Seek / progress slider */}
                    <AudioSeekSlider objectId={inspectedObjectId!} />
                    {/* Mute toggle (independent of play state) */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => writePlayback({ audioMuted: !beh.audioMuted })}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                          beh.audioMuted
                            ? 'border-red-500/30 bg-red-500/10 text-red-400'
                            : 'border-gray-600/30 bg-gray-600/10 text-gray-400'
                        }`}
                      >
                        {beh.audioMuted ? '🔇 Muted' : '🔊 Unmuted'}
                      </button>
                      <button
                        onClick={() => writePlayback({ audioLoop: !(beh.audioLoop ?? true) })}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                          (beh.audioLoop ?? true)
                            ? 'border-sky-500/30 bg-sky-500/10 text-sky-400'
                            : 'border-gray-600/30 bg-gray-600/10 text-gray-500'
                        }`}
                      >
                        {(beh.audioLoop ?? true) ? '🔁 Loop' : '➡️ Once'}
                      </button>
                    </div>
                    {/* Volume */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-16">Volume</span>
                      <input
                        type="range" min="0" max="1" step="0.05"
                        value={beh.audioVolume ?? 1}
                        onChange={e => writePlayback({ audioVolume: parseFloat(e.target.value) })}
                        className="flex-1 h-1 accent-sky-500"
                      />
                      <span className="text-[9px] text-gray-500 font-mono w-8 text-right">{((beh.audioVolume ?? 1) * 100).toFixed(0)}%</span>
                    </div>
                    {/* Max distance */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-16">Range</span>
                      <input
                        type="range" min="1" max="100" step="1"
                        value={beh.audioMaxDistance ?? 15}
                        onChange={e => writePlayback({ audioMaxDistance: parseFloat(e.target.value) })}
                        className="flex-1 h-1 accent-sky-500"
                      />
                      <span className="text-[9px] text-gray-500 font-mono w-8 text-right">{beh.audioMaxDistance ?? 15}m</span>
                    </div>
                  </>
                )}
              </div>
            </>
          )
        })()}

        {/* ░▒▓ AGENT WINDOW INFO — session, model, cost, frame ▓▒░ */}
        {resolved && inspectedObjectId && (() => {
          const interaction = behavior.interaction
          const actions = interaction?.actions || []
          const overlayAction = actions.find((action): action is Extract<ObjectInteractionAction, { type: 'html_overlay' }> => action.type === 'html_overlay')
          const apiAction = actions.find((action): action is Extract<ObjectInteractionAction, { type: 'api_call' }> => action.type === 'api_call')
          const vfxAction = actions.find((action): action is Extract<ObjectInteractionAction, { type: 'spawn_vfx' }> => action.type === 'spawn_vfx')
          const audioAction = actions.find((action): action is Extract<ObjectInteractionAction, { type: 'audio_toggle' }> => action.type === 'audio_toggle')
          const spellAction = actions.find((action): action is Extract<ObjectInteractionAction, { type: 'spell' }> => action.type === 'spell')
          const writeActions = (nextActions: ObjectInteractionAction[]) => {
            setObjectBehavior(inspectedObjectId, {
              interaction: nextActions.length
                ? {
                    label: interaction?.label || `Open ${resolved.name}`,
                    radius: interaction?.radius ?? 3.2,
                    actions: nextActions,
                  }
                : undefined,
            })
          }
          const upsertAction = (type: ObjectInteractionAction['type'], action: ObjectInteractionAction) => {
            writeActions([...actions.filter(existing => existing.type !== type), action])
          }
          const removeAction = (type: ObjectInteractionAction['type']) => {
            writeActions(actions.filter(action => action.type !== type))
          }
          return (
            <>
              <SectionHeader>Interaction Hooks</SectionHeader>
              <div className="rounded-lg border border-white/5 p-2 space-y-2" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
                <div className="grid grid-cols-[1fr_90px] gap-1.5">
                  <input
                    type="text"
                    value={interaction?.label || ''}
                    onChange={e => setObjectBehavior(inspectedObjectId, {
                      interaction: {
                        label: e.target.value || `Open ${resolved.name}`,
                        radius: interaction?.radius ?? 3.2,
                        actions: actions.length ? actions : [{ type: 'spawn_vfx' }],
                      },
                    })}
                    placeholder={`Open ${resolved.name}`}
                    className="rounded border border-gray-700/30 bg-black/40 px-2 py-1 text-[10px] text-gray-200 outline-none focus:border-sky-400/40"
                  />
                  <label className="grid grid-cols-[1fr_18px] overflow-hidden rounded border border-gray-700/30 bg-black/40 text-[10px] text-gray-200 focus-within:border-sky-400/40" title="Interaction radius in meters">
                    <span className="sr-only">Interaction radius in meters</span>
                    <input
                      type="number"
                      min={0.5}
                      max={50}
                      step={0.1}
                      value={interaction?.radius ?? 3.2}
                      onChange={e => setObjectBehavior(inspectedObjectId, {
                        interaction: {
                          label: interaction?.label || `Open ${resolved.name}`,
                          radius: Math.max(0.5, Number(e.target.value) || 3.2),
                          actions: actions.length ? actions : [{ type: 'spawn_vfx' }],
                        },
                      })}
                      className="min-w-0 border-0 bg-transparent px-2 py-1 text-[10px] text-gray-200 outline-none"
                    />
                    <span className="grid place-items-center border-l border-gray-700/30 text-[8px] font-black uppercase text-cyan-200/70">m</span>
                  </label>
                </div>
                <div className="grid grid-cols-[64px_1fr] items-center gap-1.5">
                  <button
                    onClick={() => overlayAction ? removeAction('html_overlay') : upsertAction('html_overlay', { type: 'html_overlay', title: resolved.name, url: '', opacity: 0.8 })}
                    className={`rounded border px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] ${overlayAction ? 'border-cyan-400/45 bg-cyan-500/18 text-cyan-200' : 'border-gray-700/40 bg-black/30 text-gray-500'}`}
                  >
                    Overlay
                  </button>
                  <input
                    type="text"
                    disabled={!overlayAction}
                    value={overlayAction?.url || ''}
                    onChange={e => upsertAction('html_overlay', { type: 'html_overlay', title: overlayAction?.title || resolved.name, url: e.target.value, opacity: overlayAction?.opacity ?? 0.8 })}
                    placeholder="/builder/page.html"
                    className="rounded border border-gray-700/30 bg-black/40 px-2 py-1 text-[10px] text-gray-200 outline-none disabled:opacity-40 focus:border-sky-400/40"
                  />
                </div>
                <div className="grid grid-cols-[64px_1fr] items-center gap-1.5">
                  <button
                    onClick={() => vfxAction ? removeAction('spawn_vfx') : upsertAction('spawn_vfx', { type: 'spawn_vfx', vfxType: 'sparkburst' })}
                    className={`rounded border px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] ${vfxAction ? 'border-fuchsia-400/45 bg-fuchsia-500/18 text-fuchsia-200' : 'border-gray-700/40 bg-black/30 text-gray-500'}`}
                  >
                    VFX
                  </button>
                  <input
                    type="text"
                    disabled={!vfxAction}
                    value={vfxAction?.vfxType || ''}
                    onChange={e => upsertAction('spawn_vfx', { type: 'spawn_vfx', vfxType: e.target.value || undefined })}
                    placeholder="sparkburst"
                    className="rounded border border-gray-700/30 bg-black/40 px-2 py-1 text-[10px] text-gray-200 outline-none disabled:opacity-40 focus:border-sky-400/40"
                  />
                </div>
                <div className="grid grid-cols-[64px_1fr] items-center gap-1.5">
                  <button
                    onClick={() => apiAction ? removeAction('api_call') : upsertAction('api_call', { type: 'api_call', endpoint: '/api/world-events', method: 'POST' })}
                    className={`rounded border px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] ${apiAction ? 'border-amber-400/45 bg-amber-500/18 text-amber-200' : 'border-gray-700/40 bg-black/30 text-gray-500'}`}
                  >
                    API
                  </button>
                  <input
                    type="text"
                    disabled={!apiAction}
                    value={apiAction?.endpoint || ''}
                    onChange={e => upsertAction('api_call', { type: 'api_call', endpoint: e.target.value, method: apiAction?.method || 'POST' })}
                    placeholder="/api/..."
                    className="rounded border border-gray-700/30 bg-black/40 px-2 py-1 text-[10px] text-gray-200 outline-none disabled:opacity-40 focus:border-sky-400/40"
                  />
                </div>
                <div className="grid grid-cols-[64px_1fr] items-center gap-1.5">
                  <button
                    onClick={() => audioAction ? removeAction('audio_toggle') : upsertAction('audio_toggle', { type: 'audio_toggle', audioUrl: '', loop: true })}
                    className={`rounded border px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] ${audioAction ? 'border-green-400/45 bg-green-500/18 text-green-200' : 'border-gray-700/40 bg-black/30 text-gray-500'}`}
                  >
                    MP3
                  </button>
                  <input
                    type="text"
                    disabled={!audioAction}
                    value={audioAction?.audioUrl || ''}
                    onChange={e => upsertAction('audio_toggle', { type: 'audio_toggle', audioUrl: e.target.value, loop: audioAction?.loop ?? true })}
                    placeholder="/media/audio.mp3"
                    className="rounded border border-gray-700/30 bg-black/40 px-2 py-1 text-[10px] text-gray-200 outline-none disabled:opacity-40 focus:border-sky-400/40"
                  />
                </div>
                <div className="grid grid-cols-[64px_1fr] items-center gap-1.5">
                  <button
                    onClick={() => spellAction ? removeAction('spell') : upsertAction('spell', { type: 'spell', spellId: 'text-to-3d' })}
                    className={`rounded border px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] ${spellAction ? 'border-violet-400/45 bg-violet-500/18 text-violet-200' : 'border-gray-700/40 bg-black/30 text-gray-500'}`}
                  >
                    Spell
                  </button>
                  <input
                    type="text"
                    disabled={!spellAction}
                    value={spellAction?.spellId || ''}
                    onChange={e => upsertAction('spell', { type: 'spell', spellId: e.target.value })}
                    placeholder="text-to-3d"
                    className="rounded border border-gray-700/30 bg-black/40 px-2 py-1 text-[10px] text-gray-200 outline-none disabled:opacity-40 focus:border-sky-400/40"
                  />
                </div>
              </div>
            </>
          )
        })()}

        {resolved?.type === 'portal' && (() => {
          const portal = resolved.data as PortalGate
          const targetWorlds = worldRegistry.filter(world =>
            world.id !== activeWorldId &&
            (world.id === WELCOME_HUB_WORLD_ID || world.visibility !== 'core') &&
            world.visibility !== 'template'
          )
          const action = resolvePortalGateAction(portal)
          const setPortalAction = (nextAction: PortalAction) => {
            updatePortalGate(inspectedObjectId!, {
              action: nextAction,
              targetWorldId: nextAction.type === 'load_world' ? nextAction.worldId : undefined,
              targetWorldName: nextAction.type === 'load_world' ? nextAction.worldName : undefined,
              inert: false,
            })
          }
          return (
            <>
              <SectionHeader>Portal Action</SectionHeader>
              <div className="rounded-lg border border-white/5 p-2 space-y-1.5" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">variant</span>
                  <span className="text-[10px] text-cyan-300 font-mono">{portal.variant}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">action</span>
                  <select
                    value={action.type}
                    onChange={event => {
                      const type = event.target.value as PortalAction['type']
                      if (type === 'load_world') {
                        const world = targetWorlds.find(item => item.id === portal.targetWorldId) || targetWorlds[0]
                        setPortalAction(world
                          ? { type: 'load_world', worldId: world.id, worldName: world.name }
                          : { type: 'locked_message', message: 'Choose a target world first.' })
                      } else if (type === 'create_world') {
                        setPortalAction({ type: 'create_world', visibility: 'private', promptForName: true, name: 'New Private World' })
                      } else if (type === 'external_url') {
                        setPortalAction({ type: 'external_url', url: 'https://conjure.04515.xyz/?portal=true&from=oasis', label: 'External world', returnUrl: 'current', requiresConfirm: true })
                      } else {
                        setPortalAction({ type: 'locked_message', message: 'This portal is not open yet.' })
                      }
                    }}
                    className="min-w-0 flex-1 rounded border border-cyan-500/20 bg-black/40 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none focus:border-cyan-400/40"
                  >
                    <option value="load_world">load_world</option>
                    <option value="create_world">create_world</option>
                    <option value="external_url">external_url</option>
                    <option value="locked_message">locked_message</option>
                  </select>
                </div>
                {action.type === 'load_world' && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">target</span>
                  <select
                    value={action.worldId || portal.targetWorldId || ''}
                    onChange={event => {
                      const worldId = event.target.value
                      const world = targetWorlds.find(item => item.id === worldId)
                      updatePortalGate(inspectedObjectId!, {
                        targetWorldId: world?.id,
                        targetWorldName: world?.name,
                        action: world ? { type: 'load_world', worldId: world.id, worldName: world.name } : undefined,
                        inert: !world,
                      })
                    }}
                    className="min-w-0 flex-1 rounded border border-cyan-500/20 bg-black/40 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none focus:border-cyan-400/40"
                    title={portal.targetWorldId}
                  >
                    <option value="">No target</option>
                    {targetWorlds.map(world => (
                      <option key={world.id} value={world.id}>{world.name}</option>
                    ))}
                  </select>
                </div>
                )}
                {action.type === 'create_world' && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">visibility</span>
                      <select
                        value={action.visibility || 'private'}
                        onChange={event => setPortalAction({ ...action, visibility: event.target.value as NonNullable<Extract<PortalAction, { type: 'create_world' }>['visibility']> })}
                        className="min-w-0 flex-1 rounded border border-cyan-500/20 bg-black/40 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none focus:border-cyan-400/40"
                      >
                        <option value="private">private</option>
                        <option value="public">public</option>
                        <option value="ffa">FFA</option>
                        <option value="unlisted">link-only</option>
                        <option value="unlisted_edit">link-build</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">name</span>
                      <input
                        value={action.name || ''}
                        onChange={event => setPortalAction({ ...action, name: event.target.value })}
                        className="min-w-0 flex-1 rounded border border-cyan-500/20 bg-black/40 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none focus:border-cyan-400/40"
                        placeholder="New Oasis World"
                      />
                    </div>
                  </>
                )}
                {action.type === 'external_url' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">url</span>
                    <input
                      value={action.url}
                      onChange={event => setPortalAction({ ...action, url: event.target.value })}
                      className="min-w-0 flex-1 rounded border border-cyan-500/20 bg-black/40 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none focus:border-cyan-400/40"
                      placeholder="https://conjure.04515.xyz/"
                    />
                  </div>
                )}
                {action.type === 'locked_message' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">message</span>
                    <input
                      value={action.message}
                      onChange={event => setPortalAction({ ...action, message: event.target.value })}
                      className="min-w-0 flex-1 rounded border border-cyan-500/20 bg-black/40 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none focus:border-cyan-400/40"
                      placeholder="This portal is not open yet."
                    />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">direction</span>
                  <select
                    value={portal.direction || 'one-way'}
                    onChange={event => updatePortalGate(inspectedObjectId!, { direction: event.target.value as 'one-way' | 'two-way' })}
                    className="min-w-0 flex-1 rounded border border-cyan-500/20 bg-black/40 px-2 py-1 text-[10px] text-cyan-100 font-mono outline-none focus:border-cyan-400/40"
                  >
                    <option value="one-way">one-way</option>
                    <option value="two-way">two-way</option>
                  </select>
                </div>
                {portal.linkedPortalId && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">linked</span>
                    <span className="text-[9px] text-gray-500 font-mono truncate" title={portal.linkedPortalId}>
                      {portal.linkedPortalId}
                    </span>
                  </div>
                )}
              </div>
              <SectionHeader>Portal Style</SectionHeader>
              <div className="rounded-lg border border-white/5 p-2" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
                <div className="grid grid-cols-2 gap-1.5">
                  {PORTAL_GATE_VARIANT_DEFS.map(style => {
                    const isActive = portal.variant === style.id
                    return (
                      <button
                        key={style.id}
                        onClick={() => updatePortalGate(inspectedObjectId!, { variant: style.id as PortalGateVariant })}
                        className={`group flex items-center gap-2 rounded p-1.5 text-left transition-colors ${
                          isActive
                            ? 'border border-cyan-400/50 bg-cyan-500/15'
                            : 'border border-gray-700/30 hover:border-cyan-400/35 hover:bg-cyan-500/10'
                        }`}
                        title={style.desc}
                      >
                        <span
                          className="h-10 w-7 shrink-0 rounded-full border shadow-[0_0_18px_rgba(34,211,238,0.45)]"
                          style={{
                            borderColor: style.accent,
                            background: `linear-gradient(180deg, ${style.preview.from}, ${style.preview.via}, ${style.preview.to})`,
                          }}
                        />
                        <span className="min-w-0">
                          <span className={`block truncate text-[9px] font-mono ${isActive ? 'text-cyan-200' : 'text-gray-300'}`}>
                            {style.label}
                          </span>
                          <span className="block truncate text-[8px] text-gray-500">
                            {style.id}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )
        })()}

        {resolved?.type === 'agent' && (() => {
          const agentWin = resolved.data as import('../../store/oasisStore').AgentWindow
          return (
            <>
              <SectionHeader>&#128187; Agent Window</SectionHeader>
              <div className="rounded-lg border border-white/5 p-2 space-y-1.5" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
                {/* Agent type */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">type</span>
                  <span className="text-[10px] text-sky-300 font-mono">{agentWin.agentType}</span>
                </div>

                {/* Session ID with copy button */}
                {agentWin.sessionId && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">session</span>
                    <span className="text-[9px] text-gray-400 font-mono truncate flex-1" title={agentWin.sessionId}>
                      {agentWin.sessionId}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(agentWin.sessionId!)
                      }}
                      className="text-[9px] px-1.5 py-0.5 rounded border border-gray-700/30 text-gray-500 hover:text-sky-300 hover:border-sky-500/30 font-mono transition-colors shrink-0"
                      title="Copy session ID"
                    >
                      copy
                    </button>
                  </div>
                )}

                {/* Dimensions */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">size</span>
                  <div className="grid flex-1 grid-cols-2 gap-1.5">
                    <input
                      type="number"
                      min={320}
                      max={2560}
                      step={10}
                      value={agentWin.width ?? 800}
                      onChange={e => {
                        const next = Number(e.target.value)
                        if (!Number.isFinite(next)) return
                        updateAgentWindow(inspectedObjectId!, { width: Math.max(320, Math.min(2560, Math.round(next))) })
                      }}
                      className="rounded border border-gray-700/30 bg-black/30 px-2 py-1 text-[9px] text-gray-300 font-mono outline-none focus:border-sky-400/30"
                    />
                    <input
                      type="number"
                      min={240}
                      max={1600}
                      step={10}
                      value={agentWin.height ?? 600}
                      onChange={e => {
                        const next = Number(e.target.value)
                        if (!Number.isFinite(next)) return
                        updateAgentWindow(inspectedObjectId!, { height: Math.max(240, Math.min(1600, Math.round(next))) })
                      }}
                      className="rounded border border-gray-700/30 bg-black/30 px-2 py-1 text-[9px] text-gray-300 font-mono outline-none focus:border-sky-400/30"
                    />
                  </div>
                </div>

                {/* Scale */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">scale</span>
                  <input
                    type="range"
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={agentWin.scale ?? 1}
                    onChange={e => updateAgentWindow(inspectedObjectId!, { scale: parseFloat(e.target.value) })}
                    className="flex-1 h-1 appearance-none rounded bg-gray-700 accent-sky-500"
                    style={{ cursor: 'pointer' }}
                  />
                  <span className="text-[9px] text-gray-400 font-mono w-10 text-right">{(agentWin.scale ?? 1).toFixed(2)}</span>
                </div>

                {agentWin.agentType === 'browser' && (
                  <div className="rounded-lg border border-orange-500/10 bg-orange-500/5 p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 font-mono w-16 shrink-0">address</span>
                      <input
                        key={`browser-url-${agentWin.id}-${agentWin.surfaceUrl ?? ''}`}
                        defaultValue={agentWin.surfaceUrl ?? ''}
                        onBlur={e => updateAgentWindow(inspectedObjectId!, { surfaceUrl: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            e.currentTarget.blur()
                          }
                        }}
                        placeholder="https://example.com"
                        className="flex-1 rounded border border-gray-700/30 bg-black/30 px-2 py-1 text-[9px] text-gray-300 font-mono outline-none focus:border-orange-400/30"
                      />
                    </div>
                  </div>
                )}

                {/* Opacity/Blur sliders removed (oasisspec3): they made windows go black,
                    blur doesn't compose through the 3D <Html> portal. Use the per-agent
                    in-window opacity/blur settings inside Anorak Pro / Hermes panels. */}
              </div>

              {/* Frame style selector */}
              <SectionHeader>&#128444;&#65039; Frame Style</SectionHeader>
              <div className="rounded-lg border border-white/5 p-2" style={{ background: 'rgba(20, 20, 20, 0.6)' }}>
                <div className="grid grid-cols-4 gap-1">
                  {/* No frame option */}
                  <button
                    onClick={() => updateAgentWindow(inspectedObjectId!, { frameStyle: undefined })}
                    className={`flex flex-col items-center gap-0.5 p-1.5 rounded transition-colors text-center ${
                      !agentWin.frameStyle
                        ? 'bg-sky-500/20 border border-sky-500/40'
                        : 'border border-gray-700/30 hover:border-gray-500/50'
                    }`}
                  >
                    <span className="text-sm">&#10005;</span>
                    <span className={`text-[8px] font-mono ${!agentWin.frameStyle ? 'text-sky-300' : 'text-gray-500'}`}>None</span>
                  </button>
                  {/* 8 frame styles */}
                  {FRAME_STYLES.map(frame => {
                    const isActive = agentWin.frameStyle === frame.id
                    return (
                      <button
                        key={frame.id}
                        onClick={() => updateAgentWindow(inspectedObjectId!, { frameStyle: frame.id })}
                        className={`flex flex-col items-center gap-0.5 p-1.5 rounded transition-colors text-center ${
                          isActive
                            ? 'bg-sky-500/20 border border-sky-500/40'
                            : 'border border-gray-700/30 hover:border-gray-500/50'
                        }`}
                        title={frame.desc}
                      >
                        <span className="text-sm">{frame.icon}</span>
                        <span className={`text-[8px] font-mono ${isActive ? 'text-sky-300' : 'text-gray-500'}`}>{frame.label}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Frame thickness slider */}
                {agentWin.frameStyle && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[9px] text-gray-500 font-mono min-w-[50px]">Thickness</span>
                    <input
                      type="range"
                      min={0.2}
                      max={150}
                      step={0.2}
                      value={agentWin.frameThickness ?? 1}
                      onChange={e => updateAgentWindow(inspectedObjectId!, { frameThickness: parseFloat(e.target.value) })}
                      className="flex-1 h-1 appearance-none rounded bg-gray-700 accent-sky-500"
                      style={{ cursor: 'pointer' }}
                    />
                    <span className="text-[9px] text-gray-500 font-mono w-12 text-right">{(agentWin.frameThickness ?? 1).toFixed(1)}</span>
                  </div>
                )}
              </div>
            </>
          )
        })()}

        {/* ░▒▓ VRM EXPRESSIONS — Facial controls for VRM avatars ▓▒░ */}
        {resolved?.type === 'catalog' && (resolved.data as any).glbPath?.endsWith('.vrm') && (
          <VRMExpressionSection
            expressions={behavior.expressions}
            onChange={(expressions) => {
              if (inspectedObjectId) setObjectBehavior(inspectedObjectId, { expressions })
            }}
          />
        )}

        {/* ░▒▓ PAINT STROKE — Playback controls ▓▒░ */}
        {resolved?.type === 'paint_stroke' && inspectedObjectId && (() => {
          const stroke = resolved.data as import('../../lib/forge/paint-stroke').PaintStroke
          return (
            <>
              <PaintStrokeEditSection
                stroke={stroke}
                onChange={(updates) => updatePaintStroke(inspectedObjectId, updates)}
              />
              <PaintStrokePlaybackSection
                strokeId={inspectedObjectId}
                pointCount={Math.floor(stroke.points.length / 3)}
                onPlay={(durationSec) => playPaintStroke(inspectedObjectId, durationSec, Boolean(stroke.playbackLoop))}
                onStop={() => stopPaintStrokePlayback(inspectedObjectId)}
                loop={Boolean(stroke.playbackLoop)}
                onLoopChange={(loop) => updatePaintStroke(inspectedObjectId, { playbackLoop: loop })}
              />
            </>
          )
        })()}

        {/* ░▒▓ TEXT 3D — Live edit ▓▒░ */}
        {resolved?.type === 'text_3d' && inspectedObjectId && (() => {
          const t3d = resolved.data as import('../../lib/forge/text-3d-object').Text3DObject
          return (
            <Text3DEditSection
              object={t3d}
              onChange={(updates) => updateText3dObject(inspectedObjectId, updates)}
            />
          )
        })()}

        {/* ░▒▓ ACTIONS ▓▒░ */}
        <SectionHeader>&#9881; Actions</SectionHeader>
        <div className="flex items-center gap-2">
          {/* Visibility toggle */}
          <button
            onClick={toggleVisibility}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded font-mono border transition-colors ${
              behavior.visible
                ? 'text-gray-300 border-gray-700/30 hover:border-gray-600/50'
                : 'text-gray-400 border-gray-700/20 bg-gray-800/30'
            }`}
            title={behavior.visible ? 'Hide object' : 'Show object'}
          >
            <span className="text-sm">{behavior.visible ? '\u{1F441}' : '\u{1F648}'}</span>
            {behavior.visible ? 'visible' : 'hidden'}
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Delete button */}
          <button
            onClick={handleDelete}
            className="text-[10px] px-3 py-1 rounded font-mono border border-red-500/20 text-red-400/70 hover:text-red-300 hover:border-red-500/40 hover:bg-red-500/10 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* ─═̷─═̷─ subtle bottom glow ─═̷─═̷─ */}
      <div className="h-px w-full" style={{ background: `linear-gradient(90deg, transparent, ${INSPECTOR_COLOR}33, transparent)` }} />
    </div>
    </InspectorCollapseContext.Provider>,
    document.body
  )
}

// ▓▓▓▓【I̸N̸S̸P̸E̸C̸T̸O̸R̸】▓▓▓▓ॐ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓ॐ▓▓▓▓【S̸O̸U̸L̸】▓▓▓▓
