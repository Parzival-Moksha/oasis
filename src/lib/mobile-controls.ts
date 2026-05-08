'use client'

import { create } from 'zustand'

export interface MobileInputSnapshot {
  moveX: number
  moveZ: number
  sprint: boolean
  lookActive: boolean
}

interface MobileControlsState extends MobileInputSnapshot {
  setMove: (moveX: number, moveZ: number) => void
  setSprint: (sprint: boolean) => void
  setLookActive: (lookActive: boolean) => void
  reset: () => void
}

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

export function isProbablyMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false

  const params = new URLSearchParams(window.location.search)
  if (params.get('mobile') === '1') return true
  if (params.get('mobile') === '0') return false
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  if (hashParams.get('mobile') === '1') return true
  if (hashParams.get('mobile') === '0') return false
  const savedOverride = window.localStorage.getItem('oasis-mobile-override')
  if (savedOverride === '1') return true
  if (savedOverride === '0') return false

  const navigatorWithHints = navigator as Navigator & {
    userAgentData?: { mobile?: boolean }
  }
  if (typeof navigatorWithHints.userAgentData?.mobile === 'boolean') {
    return navigatorWithHints.userAgentData.mobile
  }

  const coarsePointer =
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(any-pointer: coarse)').matches
  const touchPoints = navigator.maxTouchPoints || 0
  const touchCapable = touchPoints > 1
  const narrowViewport = Math.min(window.innerWidth, window.innerHeight) <= 900
  const userAgentMobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i.test(navigator.userAgent)

  return coarsePointer && (touchCapable || userAgentMobile || narrowViewport)
}

export const useMobileControls = create<MobileControlsState>((set) => ({
  moveX: 0,
  moveZ: 0,
  sprint: false,
  lookActive: false,
  setMove: (moveX, moveZ) => set({ moveX: clampAxis(moveX), moveZ: clampAxis(moveZ) }),
  setSprint: (sprint) => set({ sprint }),
  setLookActive: (lookActive) => set({ lookActive }),
  reset: () => set({ moveX: 0, moveZ: 0, sprint: false, lookActive: false }),
}))

export function getMobileInputSnapshot(): MobileInputSnapshot {
  const state = useMobileControls.getState()
  return {
    moveX: state.moveX,
    moveZ: state.moveZ,
    sprint: state.sprint,
    lookActive: state.lookActive,
  }
}
