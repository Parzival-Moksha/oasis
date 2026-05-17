'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerComputedStats } from '@/lib/player-progression'
import { PLAYER_BASE_STATS } from '@/lib/player-progression'
import { useInputManager } from '@/lib/input-manager'
import { useAudioManager } from '@/lib/audio-manager'
import { setPlayerManaRecharging } from '@/lib/player-avatar-runtime'
import { useOasisStore } from '@/store/oasisStore'
import { SPELL_DEFS } from '@/lib/spellbook'

type VitalsSource = {
  hp?: unknown
  maxHp?: unknown
  mana?: unknown
  maxMana?: unknown
  level?: unknown
  xp?: unknown
  totalXp?: unknown
  levelProgress?: unknown
  xpToNext?: unknown
  stats?: Partial<PlayerComputedStats>
  playerStats?: Partial<PlayerComputedStats>
}

type PlayerVitals = {
  hp: number
  maxHp: number
  mana: number
  maxMana: number
  level: number
  xp: number
  levelProgress: number
  xpToNext: number
  fireboltCost: number
  fireboltDamage: number
  manaRegenMultiplier: number
}

type XpAwardEvent = {
  xp?: number
  xpGained?: number
  totalXp?: number
  level?: number
  leveledUp?: boolean
}

const DEFAULT_VITALS: PlayerVitals = {
  hp: PLAYER_BASE_STATS.hp,
  maxHp: PLAYER_BASE_STATS.hp,
  mana: PLAYER_BASE_STATS.mana,
  maxMana: PLAYER_BASE_STATS.mana,
  level: 1,
  xp: 0,
  levelProgress: 0,
  xpToNext: 100,
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
    xp: finiteNumber(source?.xp ?? source?.totalXp, fallback.xp),
    levelProgress: Math.max(0, Math.min(1, finiteNumber(source?.levelProgress, fallback.levelProgress))),
    xpToNext: Math.max(1, finiteNumber(source?.xpToNext, fallback.xpToNext)),
    fireboltCost: finiteNumber(stats.fireboltManaCost, fallback.fireboltCost),
    fireboltDamage: finiteNumber(stats.fireboltDamage, fallback.fireboltDamage),
    manaRegenMultiplier: finiteNumber(stats.manaRegenMultiplier, fallback.manaRegenMultiplier),
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'].includes(type)
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function Bar({
  label,
  value,
  max,
  tone,
  flashPercent,
}: {
  label: string
  value: number
  max: number
  tone: 'hp' | 'mana' | 'xp'
  flashPercent?: number
}) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  const fill = tone === 'hp'
    ? 'linear-gradient(90deg, #7f1d1d, #dc2626 45%, #fb7185)'
    : tone === 'mana'
      ? 'linear-gradient(90deg, #075985, #0284c7 45%, #67e8f9)'
      : 'linear-gradient(90deg, #713f12, #d97706 48%, #fef08a)'
  const glow = tone === 'hp'
    ? 'rgba(248,113,113,0.35)'
    : tone === 'mana'
      ? 'rgba(103,232,249,0.35)'
      : 'rgba(250,204,21,0.35)'
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-[0.16em] text-white/65">
        <span>{label}</span>
        <span className="font-mono text-white/85">{Math.round(value)}/{Math.round(max)}</span>
      </div>
      <div className="relative h-4 overflow-hidden rounded border border-white/15 bg-black/70 shadow-inner">
        <div
          className="h-full rounded-[3px] transition-[width] duration-150"
          style={{
            width: `${percent}%`,
            background: fill,
            boxShadow: `0 0 18px ${glow}`,
          }}
        />
        {flashPercent ? (
          <div
            className="absolute inset-y-0 left-0 rounded-[3px] bg-white/70"
            style={{
              width: `${Math.max(5, Math.min(100, flashPercent))}%`,
              animation: 'oasisXpFlash 900ms ease-out forwards',
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

export function PlayerVitalsHud({ visible }: { visible: boolean }) {
  const [vitals, setVitals] = useState<PlayerVitals>(DEFAULT_VITALS)
  const [castError, setCastError] = useState<string | null>(null)
  const [recharging, setRecharging] = useState(false)
  const [xpFlash, setXpFlash] = useState<{ id: number; amount: number } | null>(null)
  const selectedSpellId = useOasisStore(s => s.selectedSpellId)
  const vitalsRef = useRef<PlayerVitals>(DEFAULT_VITALS)
  const lastRechargeAtRef = useRef<number>(0)
  const rechargeActiveRef = useRef(false)
  const rechargeTimerRef = useRef<number | null>(null)

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

  const stopRecharge = useCallback(() => {
    rechargeActiveRef.current = false
    setRecharging(false)
    setPlayerManaRecharging(false)
    if (rechargeTimerRef.current !== null) {
      window.clearInterval(rechargeTimerRef.current)
      rechargeTimerRef.current = null
    }
  }, [])

  const rechargeTick = useCallback(async () => {
    if (!rechargeActiveRef.current) return
    const current = vitalsRef.current
    if (current.mana >= current.maxMana) return
    const now = performance.now()
    const elapsedMs = now - lastRechargeAtRef.current
    // Keep in sync with server-side computeManaRechargeTicks: base interval
    // 100ms = 10 mana/sec at multiplier 1. Focus skill scales above that.
    const tickIntervalMs = 100 / Math.max(0.1, current.manaRegenMultiplier)
    if (elapsedMs < tickIntervalMs) return

    try {
      const response = await fetch('/api/profile/mana/recharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elapsedMs }),
      })
      if (!response.ok) return
      const data = await response.json()
      if (typeof data?.recharged === 'number' && data.recharged > 0) {
        lastRechargeAtRef.current = now
      }
      if (data?.progression) {
        setVitals(prev => normalizeVitals(data.progression, prev))
        window.dispatchEvent(new CustomEvent('oasis:player-vitals', { detail: data.progression }))
      }
    } catch {
      // Recharge is best-effort; direct profile refresh will recover.
    }
  }, [])

  const startRecharge = useCallback(() => {
    if (!visible || typeof window === 'undefined' || rechargeActiveRef.current) return
    if (useInputManager.getState().hasActiveUILayer()) return
    rechargeActiveRef.current = true
    lastRechargeAtRef.current = performance.now()
    setRecharging(true)
    setPlayerManaRecharging(true)
    useAudioManager.getState().play('manaRecharge')
    rechargeTimerRef.current = window.setInterval(() => void rechargeTick(), 120)
  }, [rechargeTick, visible])

  useEffect(() => {
    if (!visible || typeof window === 'undefined') return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code !== 'KeyM') return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      startRecharge()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'KeyM') return
      stopRecharge()
    }
    const onStart = () => startRecharge()
    const onStop = () => stopRecharge()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('oasis:mana-recharge-start', onStart)
    window.addEventListener('oasis:mana-recharge-stop', onStop)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('oasis:mana-recharge-start', onStart)
      window.removeEventListener('oasis:mana-recharge-stop', onStop)
      stopRecharge()
    }
  }, [startRecharge, stopRecharge, visible])

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
    const onXpAwarded = (event: Event) => {
      const detail = (event as CustomEvent<XpAwardEvent>).detail
      const amount = detail?.xpGained ?? detail?.xp ?? 0
      if (amount > 0) {
        const flash = { id: Date.now(), amount }
        setXpFlash(flash)
        window.setTimeout(() => {
          setXpFlash(current => current?.id === flash.id ? null : current)
        }, 900)
      }
      void refresh()
    }

    window.addEventListener('oasis:player-vitals', onVitals)
    window.addEventListener('oasis:profile-updated', onProfileUpdated)
    window.addEventListener('oasis:firebolt-failed', onCastFailed)
    window.addEventListener('oasis:xp-awarded', onXpAwarded)
    return () => {
      window.removeEventListener('oasis:player-vitals', onVitals)
      window.removeEventListener('oasis:profile-updated', onProfileUpdated)
      window.removeEventListener('oasis:firebolt-failed', onCastFailed)
      window.removeEventListener('oasis:xp-awarded', onXpAwarded)
    }
  }, [refresh])

  const spellText = useMemo(() => {
    if (castError) return castError
    if (recharging) return `Recharging mana x${vitals.manaRegenMultiplier.toFixed(2)}`
    if (selectedSpellId) {
      const def = SPELL_DEFS[selectedSpellId]
      return `${def.name} · 1 mana`
    }
    return 'No spell armed'
  }, [castError, recharging, selectedSpellId, vitals.manaRegenMultiplier])

  if (!visible) return null
  const xpFlashPercent = xpFlash ? (xpFlash.amount / vitals.xpToNext) * 100 : undefined

  return (
    // ─═̷─ Position: bottom-center on desktop, TOP-center on mobile. Mobile
    // bottom strip is sacred for the WASD ring + primary-action button —
    // the HUD lives at the top so it never occludes thumb-zones. Width is
    // clamped so it never spans into the side controls on narrow viewports.
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[186] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 select-none max-[700px]:bottom-auto max-[700px]:top-2 max-[700px]:w-[min(360px,calc(100vw-1rem))]">
      <style>{`
        @keyframes oasisXpFlash {
          0% { opacity: 0.82; transform: translateX(0) scaleX(1); }
          100% { opacity: 0; transform: translateX(18px) scaleX(1.18); }
        }
      `}</style>
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
        <div className="mt-2">
          <Bar
            label={`XP to Lv ${Math.round(vitals.level + 1)}`}
            value={vitals.levelProgress * vitals.xpToNext}
            max={vitals.xpToNext}
            tone="xp"
            flashPercent={xpFlashPercent}
          />
        </div>
      </div>
    </div>
  )
}
