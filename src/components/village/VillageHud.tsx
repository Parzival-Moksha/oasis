'use client'

// ░▒▓ VILLAGE HUD — the Agents menu (VillageAgentsMenu), the Academy reader, the "T talk" / "E summon" prompts ▓▒░
// The Village bar that sat at the top is gone (the owner, 2026-11-17: "ugly and useless"): the chime and voice
// switches are in Settings → Agents, Skills is a main-menu tile (and K), Summon is the plaza's circle (E) and the
// spellbook, and an offline engine is the red ConnectionWarning (forge/ConnectionWarning.tsx).

import { useSyncExternalStore, type ReactNode } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { isInVillagePlaza, subscribeVillagePlaza } from './village-actions'
import { VillageAgentsMenu } from './VillageAgentsMenu'
import { AccountsWatch } from './AccountsWatch'
import { VillageAcademyReader } from './VillageAcademyReader'
import { GAME_HUD_TEXT, GameKeycap } from '../forge/GameKeycap'
import { getTagSettings, subscribeTagSettings } from '../../lib/village/tag-style'

/** Bottom-centre game prompt: a chamfered banner, a title, and key prompts in a row. */
export function PromptBanner({ accent, title, children }: { accent: string; title: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed bottom-7 left-1/2 z-[170] -translate-x-1/2 max-[700px]:bottom-28" style={{ filter: `drop-shadow(0 8px 18px rgba(0,0,0,0.55)) drop-shadow(0 0 14px ${accent}33)` }}>
      <div
        className="relative px-7 pb-2.5 pt-1.5"
        style={{
          clipPath: 'polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%)',
          background: `linear-gradient(180deg, rgba(2,6,23,0.9), rgba(15,23,42,0.78) 60%, ${accent}22)`,
        }}
      >
        <span className="absolute inset-x-6 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
        <span className="absolute inset-x-10 bottom-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}88, transparent)` }} />
        <div className="mb-1.5 max-w-[320px] truncate text-center text-[10px]" style={{ ...GAME_HUD_TEXT, color: accent, letterSpacing: '0.26em' }}>{title}</div>
        <div className="flex items-center justify-center gap-5">{children}</div>
      </div>
    </div>
  )
}

export function KeyPrompt({ k, label, accent, primary = false, className = '' }: { k: string; label: string; accent: string; primary?: boolean; className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <GameKeycap size="md" accent={accent} pulse={primary}>{k}</GameKeycap>
      <span className={primary ? 'text-[13px]' : 'text-[11.5px]'} style={{ ...GAME_HUD_TEXT, opacity: primary ? 1 : 0.88 }}>{label}</span>
    </span>
  )
}

export function VillageHud() {
  const focusedId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const nearbyId = useOasisStore(s => s.agentEngine.nearbyAgentId)
  const nearbyName = useOasisStore(s => (s.agentEngine.nearbyAgentId ? s.agentEngine.agents[s.agentEngine.nearbyAgentId]?.name : null))
  const inPlaza = useSyncExternalStore(subscribeVillagePlaza, isInVillagePlaza, () => false)
  // The T / E / F keys show over the agent in the world (VillageTags.tsx); this banner only when asked for
  // (Settings > Agents > Name tags).
  const keysAtBottom = useSyncExternalStore(subscribeTagSettings, () => getTagSettings().keysAtBottom, () => false)

  return (
    <>
      {/* The roster lives in the Agents menu on the left: full names, status, model and thinking. */}
      <VillageAgentsMenu />
      {/* A notice when a Claude account runs out or comes back (engine accounts.js). */}
      <AccountsWatch />
      {/* The Academy: the prompt at a node of the skill tree, and the node's sheet. */}
      <VillageAcademyReader />

      {nearbyId && !focusedId && keysAtBottom && (
        <PromptBanner accent="#34d399" title={nearbyName || 'agent'}>
          <KeyPrompt k="T" label="Talk" accent="#34d399" primary />
          <KeyPrompt k="E" label="Write" accent="#38bdf8" className="max-[700px]:hidden" />
          <KeyPrompt k="F" label="Fullscreen" accent="#c084fc" className="max-[700px]:hidden" />
        </PromptBanner>
      )}

      {inPlaza && !nearbyId && !focusedId && (
        <PromptBanner accent="#fbbf24" title="Summoning circle">
          <KeyPrompt k="E" label="Summon an agent" accent="#fbbf24" primary />
        </PromptBanner>
      )}
    </>
  )
}
