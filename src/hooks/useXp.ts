// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// useXp — Client hook for awarding XP
// Fire-and-forget: call awardXp('CONJURE_ASSET') and it handles the rest
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useCallback } from 'react'
import type { XpAction } from '@/lib/xp'

interface XpResult {
  xp: number
  totalXp: number
  level: number
  leveledUp: boolean
  oldLevel?: number
}

const API_BASE = typeof window !== 'undefined'
  ? `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/xp`
  : '/api/xp'

// ═══════════════════════════════════════════════════════════════════════════
// Floating +XP indicator — pure DOM, no React needed
// ═══════════════════════════════════════════════════════════════════════════

let floatOffset = 0 // staggers multiple simultaneous awards

function showXpFloat(amount: number, leveledUp: boolean, newLevel?: number) {
  if (typeof document === 'undefined') return

  // Regular XP float
  const el = document.createElement('div')
  const yStart = 80 + floatOffset * 30
  floatOffset++
  setTimeout(() => { floatOffset = Math.max(0, floatOffset - 1) }, 400)

  el.textContent = `+${amount} XP`
  Object.assign(el.style, {
    position: 'fixed',
    top: `${yStart}px`,
    left: '50%',
    transform: 'translateX(-50%)',
    color: '#A855F7',
    fontSize: '14px',
    fontFamily: "'Courier New', monospace",
    fontWeight: 'bold',
    textShadow: '0 0 12px rgba(168,85,247,0.6)',
    pointerEvents: 'none',
    zIndex: '99999',
    transition: 'all 2.5s ease-out',
    opacity: '1',
  })
  document.body.appendChild(el)
  requestAnimationFrame(() => {
    el.style.top = `${yStart - 60}px`
    el.style.opacity = '0'
  })
  setTimeout(() => el.remove(), 3000)

  // Level-up: full-screen celebration
  if (leveledUp && newLevel) {
    showLevelUpVFX(newLevel)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LEVEL-UP VFX — de puta madre celebration
// Screen flash + particle burst + title announcement + badge reveal
// ═══════════════════════════════════════════════════════════════════════════

const LEVEL_TITLES: { min: number; max: number; title: string; badge: string }[] = [
  { min: 1,  max: 4,  title: 'Apprentice',   badge: '\u2591' },
  { min: 5,  max: 9,  title: 'Journeyman',   badge: '\u2592' },
  { min: 10, max: 14, title: 'Architect',     badge: '\u2593' },
  { min: 15, max: 19, title: 'Worldsmith',    badge: '\u2588' },
  { min: 20, max: 24, title: 'Dreamweaver',   badge: '\u25C8' },
  { min: 25, max: 29, title: 'Archmage',      badge: '\u2726' },
  { min: 30, max: 39, title: 'Oasis Elder',   badge: '\u2756' },
  { min: 40, max: 49, title: 'Realm Lord',    badge: '\u262F' },
  { min: 50, max: 99, title: 'Enlightened',   badge: '\u0950' },
]

function getTitleForLevel(level: number) {
  return LEVEL_TITLES.find(t => level >= t.min && level <= t.max) || LEVEL_TITLES[LEVEL_TITLES.length - 1]
}

function showLevelUpVFX(newLevel: number) {
  if (typeof document === 'undefined') return

  const title = getTitleForLevel(newLevel)

  // ░▒▓ 1. SCREEN FLASH — white burst that fades to gold ▓▒░
  const flash = document.createElement('div')
  Object.assign(flash.style, {
    position: 'fixed', inset: '0', zIndex: '99998',
    background: 'radial-gradient(circle at center, rgba(255,255,255,0.9), rgba(245,158,11,0.4), transparent 70%)',
    pointerEvents: 'none', opacity: '1',
    transition: 'opacity 1.5s ease-out',
  })
  document.body.appendChild(flash)
  requestAnimationFrame(() => { flash.style.opacity = '0' })
  setTimeout(() => flash.remove(), 2000)

  // ░▒▓ 2. PARTICLE BURST — 40 particles radiate from center ▓▒░
  const particleCount = 40
  const colors = ['#F59E0B', '#FBBF24', '#FCD34D', '#A855F7', '#C084FC', '#FFFFFF']
  for (let i = 0; i < particleCount; i++) {
    const p = document.createElement('div')
    const angle = (i / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5
    const distance = 150 + Math.random() * 300
    const size = 3 + Math.random() * 6
    const duration = 1.5 + Math.random() * 1.5
    const color = colors[Math.floor(Math.random() * colors.length)]

    Object.assign(p.style, {
      position: 'fixed',
      top: '50%', left: '50%',
      width: `${size}px`, height: `${size}px`,
      borderRadius: Math.random() > 0.3 ? '50%' : '2px',
      background: color,
      boxShadow: `0 0 ${size * 2}px ${color}`,
      pointerEvents: 'none', zIndex: '100000',
      transform: 'translate(-50%, -50%)',
      transition: `all ${duration}s cubic-bezier(0.25, 0.46, 0.45, 0.94)`,
      opacity: '1',
    })
    document.body.appendChild(p)

    requestAnimationFrame(() => {
      p.style.transform = `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(0.2)`
      p.style.opacity = '0'
    })
    setTimeout(() => p.remove(), duration * 1000 + 200)
  }

  // ░▒▓ 3. LEVEL ANNOUNCEMENT — centered, dramatic reveal ▓▒░
  const announcement = document.createElement('div')
  Object.assign(announcement.style, {
    position: 'fixed',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%) scale(0.3)',
    zIndex: '100001',
    pointerEvents: 'none',
    textAlign: 'center',
    opacity: '0',
    transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
  })

  announcement.innerHTML = `
    <div style="font-size: 48px; margin-bottom: 4px; filter: drop-shadow(0 0 20px rgba(245,158,11,0.8));">${title.badge}</div>
    <div style="font-family: 'Courier New', monospace; font-size: 11px; color: #F59E0B; letter-spacing: 6px; text-transform: uppercase; text-shadow: 0 0 15px rgba(245,158,11,0.6); margin-bottom: 6px;">LEVEL UP</div>
    <div style="font-family: 'Courier New', monospace; font-size: 32px; font-weight: bold; color: #FDE68A; text-shadow: 0 0 30px rgba(245,158,11,0.6), 0 0 60px rgba(168,85,247,0.3); letter-spacing: 2px;">${newLevel}</div>
    <div style="font-family: 'Courier New', monospace; font-size: 14px; color: #C084FC; margin-top: 8px; letter-spacing: 3px; text-shadow: 0 0 12px rgba(192,132,252,0.5);">${title.title}</div>
    <div style="margin-top: 12px; font-size: 9px; color: rgba(245,158,11,0.5); font-family: 'Courier New', monospace; letter-spacing: 4px;">RIGHT EFFORT</div>
  `

  document.body.appendChild(announcement)

  // Animate in
  requestAnimationFrame(() => {
    announcement.style.transform = 'translate(-50%, -50%) scale(1)'
    announcement.style.opacity = '1'
  })

  // Hold, then fade out
  setTimeout(() => {
    announcement.style.transition = 'all 1.5s ease-out'
    announcement.style.transform = 'translate(-50%, -60%) scale(1.1)'
    announcement.style.opacity = '0'
  }, 3000)
  setTimeout(() => announcement.remove(), 5000)

  // ░▒▓ 4. GOLDEN VIGNETTE — subtle lingering glow ▓▒░
  const vignette = document.createElement('div')
  Object.assign(vignette.style, {
    position: 'fixed', inset: '0', zIndex: '99997',
    boxShadow: 'inset 0 0 150px rgba(245,158,11,0.15), inset 0 0 60px rgba(168,85,247,0.1)',
    pointerEvents: 'none', opacity: '1',
    transition: 'opacity 3s ease-out',
  })
  document.body.appendChild(vignette)
  setTimeout(() => { vignette.style.opacity = '0' }, 1500)
  setTimeout(() => vignette.remove(), 5000)
}

/** Award XP for an action. Fire-and-forget — errors are swallowed. */
export async function awardXp(action: XpAction, worldId?: string): Promise<XpResult | null> {
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, worldId }),
    })
    if (!res.ok) return null
    const result = await res.json() as XpResult
    if (result.xp > 0) {
      showXpFloat(result.xp, result.leveledUp, result.level)
    }
    return result
  } catch {
    return null
  }
}

/** React hook wrapper for awardXp */
export function useXp() {
  const award = useCallback(async (action: XpAction, worldId?: string) => {
    return awardXp(action, worldId)
  }, [])

  return { awardXp: award }
}
