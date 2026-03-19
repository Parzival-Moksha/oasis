// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Scene Contexts
// React contexts for the 3D visualization
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { createContext } from 'react'
import type { OasisSettings } from './types'
import { defaultSettings } from './constants'

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS CONTEXT - Global toggles for effects
// ═══════════════════════════════════════════════════════════════════════════════

export const SettingsContext = createContext<{
  settings: OasisSettings
  updateSetting: <K extends keyof OasisSettings>(key: K, value: OasisSettings[K]) => void
}>({
  settings: defaultSettings,
  updateSetting: () => {},
})

// ═══════════════════════════════════════════════════════════════════════════════
// DRAG CONTEXT - Disables OrbitControls during cable/object dragging
// ═══════════════════════════════════════════════════════════════════════════════

export const DragContext = createContext<{
  isDragging: boolean
  setIsDragging: (dragging: boolean) => void
}>({
  isDragging: false,
  setIsDragging: () => {},
})

// ▓▓▓▓【0̸4̸5̸1̸5̸】▓▓▓▓ॐ▓▓▓▓【C̸O̸N̸T̸E̸X̸T̸S̸】▓▓▓▓
