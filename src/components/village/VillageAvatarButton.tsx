'use client'

// ░▒▓ VILLAGE AVATAR BUTTON — pick the body an agent wears, from its panel ▓▒░
// Opens the Oasis avatar gallery (the same one Anorak Pro, Hermes and Merlin use). The pick is kept
// per session in village memory, so the agent keeps it across reloads; "none" in the gallery hands
// the choice back to the village (automatic body).

import { useState, useSyncExternalStore } from 'react'

import { AGENT_AVATAR_CATALOG } from '../../lib/agent-avatar-catalog'
import { villageAgentKey } from '../../lib/village/village-layout'
import { getVillageAgentSkin, getVillageMemoryVersion, setVillageAgentSkin, subscribeVillageMemory } from '../../lib/village/village-memory'
import { AvatarGallery } from '../forge/AvatarGallery'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

function avatarLabel(path: string | null): { name: string; thumb: string | null } {
  if (!path) return { name: 'automatic', thumb: null }
  const entry = AGENT_AVATAR_CATALOG.find(item => item.path === path)
  if (entry) return { name: entry.name, thumb: `${OASIS_BASE}/avatars/gallery/thumbs/${entry.id.replace(/^av_/, '')}.jpg` }
  return { name: (path.split('/').pop() || path).replace(/\.vrm$/i, ''), thumb: null }
}

export function VillageAvatarButton({ agentId, sessionId }: { agentId: string; sessionId: string | null }) {
  const [open, setOpen] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  useSyncExternalStore(subscribeVillageMemory, getVillageMemoryVersion, () => 0)
  const key = villageAgentKey({ id: agentId, sessionId })
  const { skin, picked } = getVillageAgentSkin(key)
  const { name, thumb } = avatarLabel(skin)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Avatar: ${name}${picked ? ' (your pick)' : ' (automatic)'}. Click to choose another.`}
        aria-label="Choose this agent's avatar"
        className="flex items-center gap-1 rounded-md border border-white/15 bg-white/5 py-0.5 pl-0.5 pr-2 text-[10.5px] font-bold text-white/85 transition hover:bg-white/15"
      >
        <span className="flex h-[22px] w-[22px] items-center justify-center overflow-hidden rounded bg-black/40">
          {thumb && !thumbFailed
            ? <img src={thumb} alt="" className="h-full w-full object-cover" onError={() => setThumbFailed(true)} />
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>}
        </span>
        avatar
      </button>
      {open && (
        <AvatarGallery
          currentAvatarUrl={picked ? skin : null}
          onSelect={(avatarUrl) => {
            setVillageAgentSkin(key, avatarUrl)
            setThumbFailed(false)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
