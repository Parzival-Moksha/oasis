'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// HELP PANEL — Controls reference, build guide (quest tracker), glossary
// "Right View: seeing clearly before acting."
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { SettingsContext } from '../scene-lib'
import { QUESTS, QUEST_IDS, getQuestProgress, completedQuestCount, allQuestsComplete } from '@/lib/quests'
import { useUILayer } from '@/lib/input-manager'
import type { QuestId } from '@/lib/quests'

type Tab = 'controls' | 'guide' | 'glossary'

const DEFAULT_POS = { x: 16, y: 220 }

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLS TAB — keyboard & mouse reference
// ═══════════════════════════════════════════════════════════════════════════

interface ShortcutRow {
  keys: string[]
  action: string
  category: 'mouse' | 'camera' | 'building' | 'general'
}

const SHORTCUTS: ShortcutRow[] = [
  // Mouse
  { keys: ['Left Click'], action: 'Select object', category: 'mouse' },
  { keys: ['Left Drag'], action: 'Orbit camera', category: 'mouse' },
  { keys: ['Right Click'], action: 'Unlock pointer (FPS)', category: 'mouse' },
  { keys: ['Scroll'], action: 'Zoom in / out', category: 'mouse' },

  // Camera
  { keys: ['WASD'], action: 'Move (Noclip mode)', category: 'camera' },
  { keys: ['Q', 'E'], action: 'Up / Down (Noclip)', category: 'camera' },
  { keys: ['Shift'], action: 'Sprint — 4× speed', category: 'camera' },
  { keys: ['Space'], action: 'Slow — 0.25× speed', category: 'camera' },
  { keys: ['Ctrl', 'Alt', 'C'], action: 'Cycle camera mode (Orbit → Noclip → TPS)', category: 'camera' },

  // Building
  { keys: ['R'], action: 'Translate mode (move)', category: 'building' },
  { keys: ['T'], action: 'Rotate mode', category: 'building' },
  { keys: ['Y'], action: 'Scale mode', category: 'building' },
  { keys: ['Delete'], action: 'Delete selected object', category: 'building' },
  { keys: ['Ctrl', 'C'], action: 'Copy selected object', category: 'building' },
  { keys: ['Ctrl', 'V'], action: 'Paste (enter placement)', category: 'building' },
  { keys: ['Ctrl', 'Z'], action: 'Undo', category: 'building' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo', category: 'building' },

  // General
  { keys: ['Esc'], action: 'Cancel / Deselect / Close', category: 'general' },
  { keys: ['Ctrl', 'Shift', 'P'], action: 'Panorama screenshot', category: 'general' },
]

const CATEGORY_LABELS: Record<ShortcutRow['category'], string> = {
  mouse: 'Mouse',
  camera: 'Camera & Movement',
  building: 'Building',
  general: 'General',
}

const CATEGORY_ORDER: ShortcutRow['category'][] = ['mouse', 'camera', 'building', 'general']

function Kbd({ children }: { children: string }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold leading-none"
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
    <div className="space-y-4">
      {CATEGORY_ORDER.map(cat => (
        <div key={cat}>
          <div className="text-[10px] text-purple-300 uppercase tracking-wider mb-2 font-bold">
            {CATEGORY_LABELS[cat]}
          </div>
          <div className="space-y-1.5">
            {SHORTCUTS.filter(s => s.category === cat).map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1 flex-shrink-0">
                  {s.keys.map((k, j) => (
                    <span key={j} className="flex items-center gap-0.5">
                      {j > 0 && <span className="text-gray-500 text-[9px] mx-0.5">+</span>}
                      <Kbd>{k}</Kbd>
                    </span>
                  ))}
                </div>
                <span className="text-xs text-gray-300 text-right">{s.action}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// GUIDE TAB — interactive quest tracker
// ═══════════════════════════════════════════════════════════════════════════

function GuideTab() {
  const [progress, setProgress] = useState(getQuestProgress)

  // Listen for quest completions to re-render
  useEffect(() => {
    const handler = () => setProgress(getQuestProgress())
    window.addEventListener('quest-complete', handler)
    return () => window.removeEventListener('quest-complete', handler)
  }, [])

  const done = QUEST_IDS.filter(id => progress[id]).length
  const total = QUEST_IDS.length
  const allDone = done === total

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] text-purple-300 uppercase tracking-wider font-bold">
            {allDone ? 'All Quests Complete!' : 'Builder Quests'}
          </div>
          <div className="text-[10px] text-gray-400 font-mono">
            {done}/{total}
            {!allDone && <span className="text-purple-400 ml-1.5">+25 XP each</span>}
          </div>
        </div>
        <div
          className="w-full h-2 rounded-full overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${(done / total) * 100}%`,
              background: allDone
                ? 'linear-gradient(90deg, #22C55E, #4ADE80)'
                : 'linear-gradient(90deg, #7C3AED, #A855F7)',
              boxShadow: allDone
                ? '0 0 12px rgba(34,197,94,0.5)'
                : '0 0 12px rgba(168,85,247,0.4)',
            }}
          />
        </div>
      </div>

      {/* Quest steps */}
      {QUESTS.map(quest => {
        const isDone = progress[quest.id as QuestId] || false
        return (
          <div
            key={quest.id}
            className="flex gap-3 p-2.5 rounded-lg transition-all"
            style={{
              background: isDone ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${isDone ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.06)'}`,
            }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm transition-all"
              style={{
                background: isDone
                  ? 'rgba(34,197,94,0.2)'
                  : 'rgba(168,85,247,0.15)',
                border: `1px solid ${isDone ? 'rgba(34,197,94,0.4)' : 'rgba(168,85,247,0.3)'}`,
              }}
            >
              {isDone ? quest.doneIcon : quest.icon}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium flex items-center gap-2"
                style={{ color: isDone ? '#86EFAC' : '#e2e8f0' }}
              >
                <span
                  className="text-[10px] font-mono"
                  style={{ color: isDone ? '#4ADE80' : '#A855F7' }}
                >
                  {quest.number}.
                </span>
                {quest.title}
                {isDone && (
                  <span className="text-[9px] text-green-500 font-mono ml-auto">DONE</span>
                )}
              </div>
              <div
                className="text-xs mt-0.5 leading-relaxed"
                style={{ color: isDone ? 'rgba(134,239,172,0.5)' : '#9ca3af' }}
              >
                {quest.description}
              </div>
            </div>
          </div>
        )
      })}

      {/* Completion banner */}
      {allDone && (
        <div
          className="text-center py-3 rounded-lg"
          style={{
            background: 'linear-gradient(135deg, rgba(34,197,94,0.1), rgba(168,85,247,0.1))',
            border: '1px solid rgba(34,197,94,0.3)',
          }}
        >
          <div className="text-lg mb-1">🏆</div>
          <div className="text-sm text-green-300 font-medium">You're a Builder Now</div>
          <div className="text-[10px] text-gray-500 mt-0.5">+200 XP completion bonus awarded</div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// GLOSSARY TAB — concepts explained
// ═══════════════════════════════════════════════════════════════════════════

interface GlossaryEntry {
  term: string
  definition: string
  category: 'core' | 'social' | 'objects' | 'movement'
}

const GLOSSARY: GlossaryEntry[] = [
  // Core
  { term: 'Conjure', definition: 'Generate a 3D model from a text prompt using AI (Meshy or Tripo). Takes 15-90 seconds depending on quality tier.', category: 'core' },
  { term: 'Craft', definition: 'Generate a procedural scene from a text description using LLM. Creates multiple objects at once — buildings, landscapes, compositions.', category: 'core' },
  { term: 'Catalog', definition: 'Library of 500+ free, pre-made 3D models. Kenney, Quaternius, and original assets.', category: 'core' },
  { term: 'Inspector', definition: 'The right-side panel that appears when you select an object. Configure transform, movement, animations, labels, and more.', category: 'core' },
  { term: 'Wizard Console', definition: 'The main creation panel (✨). Tabs: Conjure, Craft, Lights, Settings, Gallery.', category: 'core' },

  // Social
  { term: 'Aura', definition: 'Reputation score earned when others visit your worlds. The more visitors, the more aura. Shows on your profile.', category: 'social' },
  { term: 'XP', definition: 'Experience points earned by building, conjuring, and engaging. Level up to unlock bragging rights.', category: 'social' },
  { term: 'Token Burn', definition: 'AI tokens consumed during conjuring, crafting, and agent conversations. Track daily/weekly usage.', category: 'social' },
  { term: 'Visibility', definition: 'Controls who can see your world. Private (only you), Unlisted (link only), Public (everyone on Explore), Open Build (anyone can edit).', category: 'social' },

  // Objects
  { term: 'Conjured Object', definition: 'AI-generated 3D model (GLB format). Created via Conjure tab. Unique to you.', category: 'objects' },
  { term: 'Catalog Object', definition: 'Pre-made model from the built-in library. Free to place, same for everyone.', category: 'objects' },
  { term: 'Crafted Scene', definition: 'Multi-object composition generated by LLM. Placed as a group of catalog objects.', category: 'objects' },
  { term: 'VRM Avatar', definition: 'Humanoid 3D character with expressions, spring bones (hair/cloth physics), and animation support.', category: 'objects' },
  { term: 'IBL', definition: 'Image-Based Lighting. Uses an HDR environment map to light your scene with realistic reflections. Found in Lights tab.', category: 'objects' },

  // Movement presets
  { term: 'Spin', definition: 'Object rotates in place around its Y-axis. Speed configurable.', category: 'movement' },
  { term: 'Hover', definition: 'Object bobs up and down gently. Height and speed configurable.', category: 'movement' },
  { term: 'Orbit', definition: 'Object circles around a center point. Radius and speed configurable.', category: 'movement' },
  { term: 'Bounce', definition: 'Object bounces up and down with a squash effect at the bottom.', category: 'movement' },
  { term: 'Pendulum', definition: 'Object swings back and forth like a pendulum.', category: 'movement' },
  { term: 'Patrol', definition: 'Object walks between waypoints. Configurable path.', category: 'movement' },
]

const GLOSSARY_CATEGORIES: { key: GlossaryEntry['category']; label: string }[] = [
  { key: 'core', label: 'Core Concepts' },
  { key: 'social', label: 'Social & Economy' },
  { key: 'objects', label: 'Object Types' },
  { key: 'movement', label: 'Movement Presets' },
]

function GlossaryTab() {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      {GLOSSARY_CATEGORIES.map(({ key, label }) => (
        <div key={key}>
          <div className="text-[10px] text-purple-300 uppercase tracking-wider mb-2 font-bold">
            {label}
          </div>
          <div className="space-y-1">
            {GLOSSARY.filter(g => g.category === key).map(entry => (
              <button
                key={entry.term}
                onClick={() => setExpanded(expanded === entry.term ? null : entry.term)}
                className="w-full text-left p-2 rounded-lg transition-all hover:bg-white/5"
                style={{
                  background: expanded === entry.term ? 'rgba(168,85,247,0.1)' : 'transparent',
                  border: `1px solid ${expanded === entry.term ? 'rgba(168,85,247,0.25)' : 'transparent'}`,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-100 font-medium">{entry.term}</span>
                  <span
                    className="text-[10px] text-gray-500 transition-transform"
                    style={{ transform: expanded === entry.term ? 'rotate(90deg)' : 'none' }}
                  >
                    ▶
                  </span>
                </div>
                {expanded === entry.term && (
                  <div className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                    {entry.definition}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// HELP PANEL — draggable, tabbed, portal-mounted
// ═══════════════════════════════════════════════════════════════════════════

export function HelpPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useUILayer('help', isOpen)
  const { settings } = useContext(SettingsContext)

  // Default tab: show guide if quests incomplete, otherwise controls
  const [tab, setTab] = useState<Tab>(() => {
    return allQuestsComplete() ? 'controls' : 'guide'
  })

  // Dragging (same pattern as FeedbackPanel)
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try {
      const saved = localStorage.getItem('oasis-help-pos')
      return saved ? JSON.parse(saved) : DEFAULT_POS
    } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }, [position])

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const newPos = { x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }
    setPosition(newPos)
    localStorage.setItem('oasis-help-pos', JSON.stringify(newPos))
  }, [isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', handleDragEnd)
    }
    return () => {
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', handleDragEnd)
    }
  }, [isDragging, handleDrag, handleDragEnd])

  if (!isOpen) return null

  const done = completedQuestCount()
  const total = QUEST_IDS.length

  const TABS: { key: Tab; label: string; icon: string; badge?: string }[] = [
    { key: 'controls', label: 'Controls', icon: '⌨️' },
    { key: 'guide', label: 'Quests', icon: '⚔️', badge: done < total ? `${done}/${total}` : undefined },
    { key: 'glossary', label: 'Glossary', icon: '📚' },
  ]

  return createPortal(
    <div
      className="fixed z-[9995] select-none"
      style={{
        left: position.x,
        top: position.y,
        width: 380,
        opacity: settings.uiOpacity,
      }}
    >
      <div
        className="rounded-xl overflow-hidden shadow-2xl"
        style={{
          background: '#0a0a14',
          border: '1px solid rgba(168, 85, 247, 0.25)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.8), 0 0 20px rgba(168, 85, 247, 0.1)',
        }}
      >
        {/* ── Header (drag handle) ── */}
        <div
          className="flex items-center justify-between px-4 py-3 cursor-move"
          onMouseDown={handleDragStart}
          style={{
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(168,85,247,0.05)',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">❓</span>
            <span className="text-sm font-semibold text-white">Help</span>
            <span className="text-[10px] text-gray-500 font-mono">— right view</span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-xs"
          >
            ✕
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div
          className="flex px-2 pt-2 gap-1"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-all"
              style={{
                background: tab === t.key ? 'rgba(168,85,247,0.15)' : 'transparent',
                color: tab === t.key ? '#d8b4fe' : '#9ca3af',
                borderBottom: tab === t.key ? '2px solid #a855f7' : '2px solid transparent',
              }}
            >
              <span className="text-sm">{t.icon}</span>
              {t.label}
              {t.badge && (
                <span
                  className="text-[9px] font-mono px-1 py-0.5 rounded"
                  style={{
                    background: 'rgba(168,85,247,0.2)',
                    color: '#c084fc',
                  }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div
          className="p-4 overflow-y-auto"
          style={{ maxHeight: 'calc(85vh - 100px)' }}
        >
          {tab === 'controls' && <ControlsTab />}
          {tab === 'guide' && <GuideTab />}
          {tab === 'glossary' && <GlossaryTab />}
        </div>
      </div>
    </div>,
    document.body,
  )
}
