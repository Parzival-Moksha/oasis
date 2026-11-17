'use client'

// ░▒▓ PANEL LOOK — transparency and blur for every agent chat, a background colour per agent ▓▒░
// The settings are in the agent's settings menu (AgentSettingsMenu.tsx); the side panel (E) and the agent's
// full screen (F) both follow them (lib/village/panel-look.ts).

import { useSyncExternalStore } from 'react'

import { getAgentAccent, getAgentPanelColor, getPanelLook, getPanelLookVersion, panelStyle, subscribePanelLook } from '../../lib/village/panel-look'

/** Background and blur for an agent's chat surface. */
export function usePanelLook(agentKey: string) {
  useSyncExternalStore(subscribePanelLook, getPanelLookVersion, () => 0)
  return { ...panelStyle(getAgentPanelColor(agentKey), getPanelLook()), accent: getAgentAccent(agentKey) }
}
