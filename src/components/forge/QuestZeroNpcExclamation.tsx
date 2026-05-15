'use client'

import { useEffect, useMemo, useState } from 'react'
import { Html } from '@react-three/drei'
import { QUEST_ZERO_WORLD_ID } from '@/lib/portal-gates'
import { getLiveObjectTransform } from '@/lib/live-object-transforms'
import { useOasisStore } from '@/store/oasisStore'

const FIRE_GUARDIAN_AVATAR_ID = 'agent-avatar-npc-fire-guardian'
const FIRE_GUARDIAN_NPC_ID = 'quest-zero-fire-guardian'
const FIRE_GUARDIAN_FALLBACK_POSITION: [number, number, number] = [0, 0, 12.35]

type NpcExclaimDetail = {
  npcId?: string
  avatarId?: string
  message?: string
  durationMs?: number
}

type ActiveExclamation = {
  id: number
  avatarId: string
  message: string
  until: number
}

export function QuestZeroNpcExclamation({ activeWorldId }: { activeWorldId: string }) {
  const avatars = useOasisStore(state => state.placedAgentAvatars)
  const transforms = useOasisStore(state => state.transforms)
  const [active, setActive] = useState<ActiveExclamation | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onExclaim = (event: Event) => {
      const detail = (event as CustomEvent<NpcExclaimDetail>).detail || {}
      const npcId = detail.npcId || FIRE_GUARDIAN_NPC_ID
      if (npcId !== FIRE_GUARDIAN_NPC_ID && detail.avatarId !== FIRE_GUARDIAN_AVATAR_ID) return
      const next = {
        id: Date.now(),
        avatarId: detail.avatarId || FIRE_GUARDIAN_AVATAR_ID,
        message: (detail.message || 'WELL DONE!').toUpperCase(),
        until: Date.now() + Math.max(900, Math.min(5000, detail.durationMs || 2400)),
      }
      setActive(next)
      window.setTimeout(() => {
        setActive(current => current?.id === next.id ? null : current)
      }, next.until - Date.now())
    }
    window.addEventListener('oasis:npc-exclaim', onExclaim)
    return () => window.removeEventListener('oasis:npc-exclaim', onExclaim)
  }, [])

  const position = useMemo<[number, number, number] | null>(() => {
    if (!active) return null
    const avatar = avatars.find(entry => entry.id === active.avatarId)
      || avatars.find(entry => entry.id === FIRE_GUARDIAN_AVATAR_ID)
      || null
    const liveTransform = avatar ? getLiveObjectTransform(avatar.id) : null
    const transform = avatar ? transforms[avatar.id] : undefined
    return liveTransform?.position || transform?.position || avatar?.position || FIRE_GUARDIAN_FALLBACK_POSITION
  }, [active, avatars, transforms])

  if (activeWorldId !== QUEST_ZERO_WORLD_ID || !active || !position) return null

  return (
    <group position={[position[0], position[1] + 2.65, position[2]]}>
      <Html transform sprite center distanceFactor={8} style={{ pointerEvents: 'none' }}>
        <div className="relative select-none">
          <style>{`
            @keyframes oasisNpcExclaimPop {
              0% { opacity: 0; transform: translateY(12px) scale(0.72) rotate(-4deg); }
              16% { opacity: 1; transform: translateY(-4px) scale(1.12) rotate(2deg); }
              58% { opacity: 1; transform: translateY(-2px) scale(1) rotate(0deg); }
              100% { opacity: 0; transform: translateY(-24px) scale(0.94) rotate(1deg); }
            }
          `}</style>
          <div
            className="rounded-[18px] border-2 border-orange-100/80 bg-[#fff3cf] px-5 py-3 text-center text-lg font-black uppercase tracking-[0.12em] text-[#3b1203] shadow-[0_0_42px_rgba(251,146,60,0.62)]"
            style={{ animation: 'oasisNpcExclaimPop 2400ms ease-out forwards' }}
          >
            {active.message}
            <div className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-orange-100/80 bg-[#fff3cf]" />
          </div>
        </div>
      </Html>
    </group>
  )
}
