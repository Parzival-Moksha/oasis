'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useUILayer } from '@/lib/input-manager'
import { CreditsTab } from './CreditsTab'

type Tab = 'controls' | 'glossary' | 'credits'

const DEFAULT_POS = { x: 244, y: 328 }

function normalizeHelpPosition(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== 'object') return DEFAULT_POS
  const pos = value as { x?: unknown; y?: unknown }
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return DEFAULT_POS
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return DEFAULT_POS
  if (pos.x < 232) return DEFAULT_POS
  return { x: pos.x, y: pos.y }
}

interface ShortcutRow {
  keys: string[]
  action: string
  category: 'mouse' | 'camera' | 'building' | 'general'
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ['Left Click'], action: 'Select object', category: 'mouse' },
  { keys: ['Left Drag'], action: 'Orbit camera', category: 'mouse' },
  { keys: ['Right Click'], action: 'Secondary action', category: 'mouse' },
  { keys: ['Scroll'], action: 'Zoom in / out', category: 'mouse' },
  { keys: ['WASD'], action: 'Move', category: 'camera' },
  { keys: ['Q', 'E'], action: 'Up / Down', category: 'camera' },
  { keys: ['Shift'], action: 'Sprint', category: 'camera' },
  { keys: ['Space'], action: 'Slow movement', category: 'camera' },
  { keys: ['C'], action: 'Cycle camera view', category: 'camera' },
  { keys: ['X'], action: 'Dance', category: 'camera' },
  { keys: ['F'], action: 'Interact nearby', category: 'camera' },
  { keys: ['N'], action: 'Next agent window', category: 'camera' },
  { keys: ['PgUp', 'PgDn'], action: 'Previous / next picture', category: 'camera' },
  { keys: ['R'], action: 'Translate mode', category: 'building' },
  { keys: ['T'], action: 'Rotate mode', category: 'building' },
  { keys: ['Y'], action: 'Scale mode', category: 'building' },
  { keys: ['Delete'], action: 'Delete selected object', category: 'building' },
  { keys: ['Ctrl', 'C'], action: 'Copy selected object', category: 'building' },
  { keys: ['Ctrl', 'V'], action: 'Paste / enter placement', category: 'building' },
  { keys: ['Ctrl', 'Z'], action: 'Undo', category: 'building' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo', category: 'building' },
  { keys: ['Esc'], action: 'Unlock pointer / cancel / close', category: 'general' },
  { keys: ['Ctrl', 'Shift', 'P'], action: 'Panorama screenshot', category: 'general' },
]

const CATEGORY_LABELS: Record<ShortcutRow['category'], string> = {
  mouse: 'Mouse',
  camera: 'Camera',
  building: 'Building',
  general: 'General',
}

const CATEGORY_ORDER: ShortcutRow['category'][] = ['mouse', 'camera', 'building', 'general']

function Kbd({ children }: { children: string }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono font-bold leading-none max-[700px]:text-[9px]"
      style={{
        background: 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.25)',
        color: '#f1f5f9',
        boxShadow: '0 1px 0 rgba(255,255,255,0.15)',
      }}
    >
      {children}
    </span>
  )
}

function ControlsTab() {
  return (
    <div className="space-y-3 max-[700px]:space-y-2">
      {CATEGORY_ORDER.map(cat => (
        <div key={cat}>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-purple-300 max-[700px]:mb-1">
            {CATEGORY_LABELS[cat]}
          </div>
          <div className="space-y-1">
            {SHORTCUTS.filter(s => s.category === cat).map((shortcut, index) => (
              <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                <div className="flex items-center gap-1">
                  {shortcut.keys.map((key, keyIndex) => (
                    <span key={keyIndex} className="flex items-center gap-0.5">
                      {keyIndex > 0 && <span className="mx-0.5 text-[9px] text-gray-500">+</span>}
                      <Kbd>{key}</Kbd>
                    </span>
                  ))}
                </div>
                <span className="min-w-0 text-left text-[11px] text-gray-300 max-[700px]:text-[10px]">
                  {shortcut.action}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface GlossaryEntry {
  term: string
  definition: string
  category: 'core' | 'social' | 'objects'
}

const GLOSSARY: GlossaryEntry[] = [
  { term: 'Conjure', definition: 'Generate a 3D model from a text prompt using an external asset pipeline.', category: 'core' },
  { term: 'Craft', definition: 'Generate a procedural scene from a text description using catalog objects and world primitives.', category: 'core' },
  { term: 'Catalog', definition: 'The built-in library of placeable 3D models and media objects.', category: 'core' },
  { term: 'Inspector', definition: 'The right-side object panel for transforms, materials, labels, media, animation, and deletion.', category: 'core' },
  { term: 'Wizard Console', definition: 'The main creation surface for advanced generation, assets, agents, and media.', category: 'core' },
  { term: 'Aura', definition: 'Reputation attached to a player or creator profile.', category: 'social' },
  { term: 'XP', definition: 'Experience gained through play, building, creation, and social actions.', category: 'social' },
  { term: 'Token Burn', definition: 'AI token usage from generation and agent interactions.', category: 'social' },
  { term: 'Visibility', definition: 'Private, unlisted, public, and sandbox rules controlling who can enter or edit a world.', category: 'social' },
  { term: 'Conjured Object', definition: 'An AI-generated GLB asset created from a prompt.', category: 'objects' },
  { term: 'Catalog Object', definition: 'A pre-made model from the Oasis library.', category: 'objects' },
  { term: 'Crafted Scene', definition: 'A grouped arrangement generated from a prompt and placed into the world.', category: 'objects' },
  { term: 'VRM Avatar', definition: 'A humanoid avatar format with animation, expressions, and spring-bone physics.', category: 'objects' },
  { term: 'IBL', definition: 'Image-based lighting used to light a scene with environment reflections.', category: 'objects' },
]

const GLOSSARY_CATEGORIES: { key: GlossaryEntry['category']; label: string }[] = [
  { key: 'core', label: 'Core Concepts' },
  { key: 'social', label: 'Social & Economy' },
  { key: 'objects', label: 'Object Types' },
]

function GlossaryTab() {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      {GLOSSARY_CATEGORIES.map(({ key, label }) => (
        <div key={key}>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-purple-300">{label}</div>
          <div className="space-y-1">
            {GLOSSARY.filter(entry => entry.category === key).map(entry => (
              <button
                key={entry.term}
                onClick={() => setExpanded(expanded === entry.term ? null : entry.term)}
                className="w-full rounded-lg p-2 text-left transition-all hover:bg-white/5"
                style={{
                  background: expanded === entry.term ? 'rgba(168,85,247,0.1)' : 'transparent',
                  border: `1px solid ${expanded === entry.term ? 'rgba(168,85,247,0.25)' : 'transparent'}`,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-100">{entry.term}</span>
                  <span
                    className="text-[10px] text-gray-500 transition-transform"
                    style={{ transform: expanded === entry.term ? 'rotate(90deg)' : 'none' }}
                  >
                    &gt;
                  </span>
                </div>
                {expanded === entry.term && (
                  <div className="mt-1.5 text-xs leading-relaxed text-gray-400">{entry.definition}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function HelpPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useUILayer('help', isOpen)
  const [isMobile, setIsMobile] = useState(false)
  const [tab, setTab] = useState<Tab>('controls')
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try {
      const saved = localStorage.getItem('oasis-help-pos')
      return saved ? normalizeHelpPosition(JSON.parse(saved)) : DEFAULT_POS
    } catch {
      return DEFAULT_POS
    }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const handleDragStart = useCallback((event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('button')) return
    setIsDragging(true)
    dragStart.current = { x: event.clientX - position.x, y: event.clientY - position.y }
  }, [position])

  const handleDrag = useCallback((event: MouseEvent) => {
    if (!isDragging) return
    const next = { x: event.clientX - dragStart.current.x, y: event.clientY - dragStart.current.y }
    setPosition(next)
    try { localStorage.setItem('oasis-help-pos', JSON.stringify(next)) } catch {}
  }, [isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  useEffect(() => {
    if (!isDragging) return
    document.addEventListener('mousemove', handleDrag)
    document.addEventListener('mouseup', handleDragEnd)
    return () => {
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', handleDragEnd)
    }
  }, [isDragging, handleDrag, handleDragEnd])

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 700)
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  if (!isOpen) return null

  const tabs: { key: Tab; label: string }[] = [
    { key: 'controls', label: 'Controls' },
    { key: 'glossary', label: 'Glossary' },
    { key: 'credits', label: 'Credits' },
  ]

  return createPortal(
    <div
      className="fixed z-[9995] select-none"
      style={{
        left: isMobile ? 12 : position.x,
        top: isMobile ? 58 : position.y,
        width: isMobile ? 'calc(100vw - 24px)' : 320,
        maxWidth: 'calc(100vw - 24px)',
        opacity: 0.92,
      }}
    >
      <div
        className="overflow-hidden rounded-xl shadow-2xl"
        style={{
          background: 'rgba(0,0,0,0.92)',
          border: '1px solid rgba(168, 85, 247, 0.25)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.8), 0 0 20px rgba(168, 85, 247, 0.1)',
        }}
      >
        <div
          className="flex cursor-move items-center justify-between px-3 py-2"
          onMouseDown={handleDragStart}
          style={{
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(168,85,247,0.05)',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Help</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-xs text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            x
          </button>
        </div>

        <div className="flex" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {tabs.map(item => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className="flex-1 px-2 py-2 text-[10px] font-medium transition-all"
              style={{
                background: tab === item.key ? 'rgba(168,85,247,0.15)' : 'transparent',
                color: tab === item.key ? '#d8b4fe' : '#9ca3af',
                borderBottom: tab === item.key ? '2px solid #a855f7' : '2px solid transparent',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div
          className="overflow-y-auto p-3"
          style={{ maxHeight: isMobile ? 'calc(100vh - 156px)' : 'min(560px, calc(85vh - 124px))' }}
        >
          {tab === 'controls' && <ControlsTab />}
          {tab === 'glossary' && <GlossaryTab />}
          {tab === 'credits' && <CreditsTab />}
        </div>
      </div>
    </div>,
    document.body,
  )
}
