'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerComputedStats } from '@/lib/player-progression'
import { PLAYER_BASE_STATS } from '@/lib/player-progression'

type VitalsSource = {
  hp?: unknown
  maxHp?: unknown
  mana?: unknown
  maxMana?: unknown
  level?: unknown
  stats?: Partial<PlayerComputedStats>
  playerStats?: Partial<PlayerComputedStats>
}

type PlayerVitals = {
  hp: number
  maxHp: number
  mana: number
  maxMana: number
  level: number
  fireboltCost: number
  fireboltDamage: number
  manaRegenMultiplier: number
}

const DEFAULT_VITALS: PlayerVitals = {
  hp: PLAYER_BASE_STATS.hp,
  maxHp: PLAYER_BASE_STATS.hp,
  mana: PLAYER_BASE_STATS.mana,
  maxMana: PLAYER_BASE_STATS.mana,
  level: 1,
  fireboltCost: PLAYER_BASE_STATS.fireboltManaCost,
  fireboltDamage: 14,
  manaRegenMultiplier: 1,
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeVitals(source: VitalsSource | null | undefined, fallback = DEFAULT_VITALS): PlayerVitals {
  const stats = source?.stats || source?.playerStats || {}
  const maxHp = finiteNumber(source?.maxHp, fallback.maxHp)
  const maxMana = finiteNumber(source?.maxMana, fallback.maxMana)
  return {
    hp: Math.max(0, Math.min(maxHp, finiteNumber(source?.hp, fallback.hp))),
    maxHp,
    mana: Math.max(0, Math.min(maxMana, finiteNumber(source?.mana, fallback.mana))),
    maxMana,
    level: finiteNumber(source?.level, fallback.level),
    fireboltCost: finiteNumber(stats.fireboltManaCost, fallback.fireboltCost),
    fireboltDamage: finiteNumber(stats.fireboltDamage, fallback.fireboltDamage),
    manaRegenMultiplier: finiteNumber(stats.manaRegenMultiplier, fallback.manaRegenMultiplier),
  }
}

function Bar({
  label,
  value,
  max,
  tone,
}: {
  label: string
  value: number
  max: number
  tone: 'hp' | 'mana'
}) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  const fill = tone === 'hp'
    ? 'linear-gradient(90deg, #7f1d1d, #dc2626 45%, #fb7185)'
    : 'linear-gradient(90deg, #075985, #0284c7 45%, #67e8f9)'
  const glow = tone === 'hp' ? 'rgba(248,113,113,0.35)' : 'rgba(103,232,249,0.35)'
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-[0.16em] text-white/65">
        <span>{label}</span>
        <span className="font-mono text-white/85">{Math.round(value)}/{Math.round(max)}</span>
      </div>
      <div className="h-4 overflow-hidden rounded border border-white/15 bg-black/70 shadow-inner">
        <div
          className="h-full rounded-[3px] transition-[width] duration-150"
          style={{
            width: `${percent}%`,
            background: fill,
            boxShadow: `0 0 18px ${glow}`,
          }}
        />
      </div>
    </div>
  )
}

export function PlayerVitalsHud({ visible }: { visible: boolean }) {
  const [vitals, setVitals] = useState<PlayerVitals>(DEFAULT_VITALS)
  const [castError, setCastError] = useState<string | null>(null)
  const vitalsRef = useRef<PlayerVitals>(DEFAULT_VITALS)
  const lastRechargeAtRef = useRef<number>(0)

  useEffect(() => {
    vitalsRef.current = vitals
  }, [vitals])

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/profile', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      setVitals(prev => normalizeVitals(data, prev))
    } catch {
      // Keep the last known HUD state.
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [refresh, visible])

  useEffect(() => {
    if (!visible || typeof window === 'undefined') return
    lastRechargeAtRef.current = performance.now()

    const timer = window.setInterval(async () => {
      const current = vitalsRef.current
      const now = performance.now()
      const elapsedMs = now - lastRechargeAtRef.current
      lastRechargeAtRef.current = now
      if (current.mana >= current.maxMana) return

      try {
        const response = await fetch('/api/profile/mana/recharge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ elapsedMs }),
        })
        if (!response.ok) return
        const data = await response.json()
        if (data?.progression) {
          setVitals(prev => normalizeVitals(data.progression, prev))
          window.dispatchEvent(new CustomEvent('oasis:player-vitals', { detail: data.progression }))
        }
      } catch {
        // Recharge is best-effort; direct profile refresh will recover.
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [visible])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const onVitals = (event: Event) => {
      const detail = (event as CustomEvent<VitalsSource>).detail
      if (!detail) return
      setVitals(prev => normalizeVitals(detail, prev))
      setCastError(null)
    }
    const onProfileUpdated = () => void refresh()
    const onCastFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ error?: string; progression?: VitalsSource }>).detail
      if (detail?.progression) {
        setVitals(prev => normalizeVitals(detail.progression, prev))
      }
      setCastError(detail?.error || 'Spell failed')
      window.setTimeout(() => setCastError(null), 1200)
    }

    window.addEventListener('oasis:player-vitals', onVitals)
    window.addEventListener('oasis:profile-updated', onProfileUpdated)
    window.addEventListener('oasis:firebolt-failed', onCastFailed)
    return () => {
      window.removeEventListener('oasis:player-vitals', onVitals)
      window.removeEventListener('oasis:profile-updated', onProfileUpdated)
      window.removeEventListener('oasis:firebolt-failed', onCastFailed)
    }
  }, [refresh])

  const spellText = useMemo(() => {
    if (castError) return castError
    return `Firebolt ${vitals.fireboltCost} mana / ${vitals.fireboltDamage} dmg`
  }, [castError, vitals.fireboltCost, vitals.fireboltDamage])

  if (!visible) return null

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[186] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 select-none max-[700px]:bottom-4">
      <div className="rounded-lg border border-amber-200/22 bg-black/68 px-3 py-2 shadow-[0_0_34px_rgba(251,146,60,0.16)] backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-100/80">RP1</div>
          <div className={`truncate text-right text-[10px] font-black uppercase tracking-[0.14em] ${castError ? 'text-rose-200' : 'text-white/70'}`}>
            {spellText}
          </div>
          <div className="font-mono text-[10px] font-black text-white/75">Lv {Math.round(vitals.level)}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Bar label="HP" value={vitals.hp} max={vitals.maxHp} tone="hp" />
          <Bar label="Mana" value={vitals.mana} max={vitals.maxMana} tone="mana" />
        </div>
      </div>
    </div>
  )
}
