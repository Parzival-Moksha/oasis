'use client'

import { createContext, useContext, type ReactNode } from 'react'

export type ClientOasisMode = 'local' | 'hosted'
export type ClientOasisRole = 'local' | 'hosted-user' | 'hosted-admin'

export interface ClientOasisCapabilities {
  mode: ClientOasisMode
  role: ClientOasisRole
  admin: boolean
  adminConfigured: boolean
  canSeeSettings: boolean
  canUseAdminPanels: boolean
  canUseAgentPanels: boolean
  canUseLocalPanels: boolean
  canUseFullWizard: boolean
}

export const DEFAULT_LOCAL_CAPABILITIES: ClientOasisCapabilities = {
  mode: 'local',
  role: 'local',
  admin: false,
  adminConfigured: false,
  canSeeSettings: true,
  canUseAdminPanels: false,
  canUseAgentPanels: true,
  canUseLocalPanels: true,
  canUseFullWizard: true,
}

const DEFAULT_HOSTED_CAPABILITIES: ClientOasisCapabilities = {
  mode: 'hosted',
  role: 'hosted-user',
  admin: false,
  adminConfigured: false,
  canSeeSettings: true,
  canUseAdminPanels: false,
  canUseAgentPanels: false,
  canUseLocalPanels: false,
  canUseFullWizard: false,
}

const OasisModeContext = createContext<ClientOasisMode>('local')
const OasisCapabilitiesContext = createContext<ClientOasisCapabilities>(DEFAULT_LOCAL_CAPABILITIES)

function normalizeCapabilities(
  mode: ClientOasisMode,
  capabilities?: Partial<ClientOasisCapabilities> | null,
): ClientOasisCapabilities {
  const defaults = mode === 'hosted' ? DEFAULT_HOSTED_CAPABILITIES : DEFAULT_LOCAL_CAPABILITIES
  return {
    ...defaults,
    ...capabilities,
    mode,
  }
}

export function OasisModeProvider({
  mode,
  capabilities,
  children,
}: {
  mode: ClientOasisMode
  capabilities?: Partial<ClientOasisCapabilities> | null
  children: ReactNode
}) {
  const normalized = normalizeCapabilities(mode, capabilities)
  return (
    <OasisModeContext.Provider value={mode}>
      <OasisCapabilitiesContext.Provider value={normalized}>
        {children}
      </OasisCapabilitiesContext.Provider>
    </OasisModeContext.Provider>
  )
}

export function useClientOasisMode(): ClientOasisMode {
  return useContext(OasisModeContext)
}

export function useIsHostedOasis(): boolean {
  return useClientOasisMode() === 'hosted'
}

export function useOasisCapabilities(): ClientOasisCapabilities {
  return useContext(OasisCapabilitiesContext)
}
