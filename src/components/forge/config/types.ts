// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG MENU — shared types for the tabbed game-style settings panel.
// ═══════════════════════════════════════════════════════════════════════════════

export type ConfigTabId =
  | 'graphics'
  | 'fonts'
  | 'sound'
  | 'controls'
  | 'bolts'
  | 'world-vfx'
  | 'agents'
  | 'experiments'
  | 'misc'

export interface ConfigTabDefinition {
  id: ConfigTabId
  emoji: string
  label: string
  tooltip: string
  /** Tailwind-friendly accent color (used for active-tab glow + border). */
  accent: string
}

export const CONFIG_TABS: ConfigTabDefinition[] = [
  { id: 'graphics',  emoji: '🎨', label: 'Graphics',  tooltip: 'Visuals — bloom, FOV, grid, sky',                accent: '#A78BFA' },
  { id: 'fonts',     emoji: '🅰',  label: 'Fonts',     tooltip: 'UI typography — spellbook + menus',              accent: '#FDE68A' },
  { id: 'sound',     emoji: '🔊', label: 'Sound',     tooltip: 'Audio — volumes, spatial, spell sounds',         accent: '#7DD3FC' },
  { id: 'controls',  emoji: '🎮', label: 'Controls',  tooltip: 'Camera, sensitivity, mode',                      accent: '#34D399' },
  { id: 'bolts',     emoji: '⚔',  label: 'Bolts',     tooltip: 'Combat-bolt visual designs',                     accent: '#FB923C' },
  { id: 'world-vfx', emoji: '✨', label: 'World VFX', tooltip: 'Conjuration + placement + portal effects',       accent: '#F472B6' },
  { id: 'agents',    emoji: '🤖', label: 'Agents',    tooltip: 'Agent behavior',                                 accent: '#22D3EE' },
  { id: 'experiments', emoji: '🧪', label: 'Experiments', tooltip: 'Try-before-shipping toggles (splash screen, …)', accent: '#F0ABFC' },
  { id: 'misc',      emoji: '⚙',  label: 'Misc',      tooltip: 'Anything else / advanced',                       accent: '#D4D4D8' },
]

export interface SharedTabProps {
  /** Render an admin/console hook above tab content (used in Graphics or Misc). */
  consoleControl?: React.ReactNode
  /** Settings menu opacity slider state (lives in Scene.tsx; passed through). */
  menuOpacity: number
  onMenuOpacityChange: (opacity: number) => void
}
