'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_XP_AWARDS } from '@/lib/xp'
import {
  QUEST_ZERO_ID,
  QUEST_ZERO_STEPS,
  QUEST_ZERO_STEP_DEFS,
  QUEST_ZERO_WORLD_ID,
  type QuestZeroStepId,
} from '@/lib/spellbook'

type QuestProgress = {
  questId: string
  status: string
  currentStepId?: string | null
  completedSteps?: string[]
}

type SpellUnlock = {
  spellId: string
  level?: number
}

type PlayerProgressionState = {
  quests?: QuestProgress[]
  spells?: SpellUnlock[]
}

type ToastState = {
  id: number
  title: string
  message: string
  tone?: 'fire' | 'xp' | 'quest'
}

const STEP_XP: Partial<Record<QuestZeroStepId, number>> = {
  'meet-merlin': DEFAULT_XP_AWARDS.QUEST_STEP_COMPLETE,
  'enter-quest-zero': DEFAULT_XP_AWARDS.QUEST_STEP_COMPLETE,
  'answer-fire-guardian': DEFAULT_XP_AWARDS.QUEST_ZERO_FIRE_GUARDIAN_PASSED,
  'unlock-firebolt': DEFAULT_XP_AWARDS.QUEST_ZERO_FIREBOLT_UNLOCKED,
  'hit-firebolt-target-1': DEFAULT_XP_AWARDS.QUEST_ZERO_TARGET_HIT,
  'hit-firebolt-target-2': DEFAULT_XP_AWARDS.QUEST_ZERO_TARGET_HIT,
  'hit-firebolt-target-3': DEFAULT_XP_AWARDS.QUEST_ZERO_TARGET_HIT,
  complete: DEFAULT_XP_AWARDS.QUEST_ZERO_COMPLETE,
}

function emitXp(result: unknown) {
  if (!result || typeof window === 'undefined') return
  const record = result as {
    xp?: unknown
    completionXp?: unknown
    hitStep?: { xp?: unknown; completionXp?: unknown }
    guardianStep?: { xp?: unknown }
    unlockStep?: { xp?: unknown }
    unlockedSpell?: { xp?: unknown }
  }
  const xpEvents = [
    record.xp,
    record.completionXp,
    record.hitStep?.xp,
    record.hitStep?.completionXp,
    record.guardianStep?.xp,
    record.unlockStep?.xp,
    record.unlockedSpell?.xp,
  ]
  for (const event of xpEvents) {
    if (event) window.dispatchEvent(new CustomEvent('oasis:xp-awarded', { detail: event }))
  }
}

export function QuestProgressTracker({ activeWorldId }: { activeWorldId: string }) {
  const [progression, setProgression] = useState<PlayerProgressionState | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [burst, setBurst] = useState<ToastState | null>(null)
  const [questLogOpen, setQuestLogOpen] = useState(false)
  const enteredQuestZeroRef = useRef(false)

  const showToast = useCallback((title: string, message: string, tone: ToastState['tone'] = 'quest', flash = false) => {
    const next = { id: Date.now(), title, message, tone }
    setToast(next)
    if (flash) {
      setBurst(next)
      window.setTimeout(() => {
        setBurst(current => current?.id === next.id ? null : current)
      }, 1750)
    }
    window.setTimeout(() => {
      setToast(current => current?.id === next.id ? null : current)
    }, 2200)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/player/progression', { cache: 'no-store' })
      if (!response.ok) return
      setProgression(await response.json())
    } catch {
      // Best-effort tracker; the HUD will recover on the next server event.
    }
  }, [])

  useEffect(() => {
    if (activeWorldId !== QUEST_ZERO_WORLD_ID) return
    void refresh()
  }, [activeWorldId, refresh])

  useEffect(() => {
    if (activeWorldId !== QUEST_ZERO_WORLD_ID) setQuestLogOpen(false)
  }, [activeWorldId])

  useEffect(() => {
    if (activeWorldId !== QUEST_ZERO_WORLD_ID || enteredQuestZeroRef.current) return
    enteredQuestZeroRef.current = true

    const postProgress = async (body: Record<string, unknown>) => {
      const response = await fetch('/api/player/progression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => null)
      if (data?.progression) setProgression(data.progression)
      emitXp(data?.result)
      return data
    }

    void (async () => {
      await postProgress({ action: 'start_quest', questId: QUEST_ZERO_ID })
      await postProgress({ action: 'complete_step', questId: QUEST_ZERO_ID, stepId: 'enter-quest-zero' })
      showToast('Quest Zero', 'Find the Fire Guardian', 'quest')
    })().catch(() => {})
  }, [activeWorldId, showToast])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onProgression = (event: Event) => {
      const detail = (event as CustomEvent<PlayerProgressionState>).detail
      if (detail) setProgression(detail)
    }
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<Partial<ToastState>>).detail
      showToast(detail?.title || 'Quest updated', detail?.message || 'Progress saved', detail?.tone || 'quest', true)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code !== 'KeyJ') return
      const el = event.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      event.preventDefault()
      setQuestLogOpen(open => !open)
    }
    window.addEventListener('oasis:player-progression', onProgression)
    window.addEventListener('oasis:quest-progress-toast', onToast)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('oasis:player-progression', onProgression)
      window.removeEventListener('oasis:quest-progress-toast', onToast)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [showToast])

  const quest = progression?.quests?.find(entry => entry.questId === QUEST_ZERO_ID) || null
  const completed = useMemo(() => {
    const set = new Set<QuestZeroStepId>()
    for (const step of quest?.completedSteps || []) {
      if ((QUEST_ZERO_STEPS as readonly string[]).includes(step)) set.add(step as QuestZeroStepId)
    }
    if (progression?.spells?.some(spell => spell.spellId === 'firebolt')) set.add('unlock-firebolt')
    if (quest?.status === 'complete') set.add('complete')
    return set
  }, [progression?.spells, quest?.completedSteps, quest?.status])

  if (activeWorldId !== QUEST_ZERO_WORLD_ID) return null

  const targetHits = QUEST_ZERO_STEPS
    .filter(step => step.startsWith('hit-firebolt-target'))
    .filter(step => completed.has(step as QuestZeroStepId)).length
  const fireboltSpell = progression?.spells?.find(spell => spell.spellId === 'firebolt') || null
  const fireboltStatus = fireboltSpell
    ? `Learned Lv ${fireboltSpell.level || 1}`
    : completed.has('answer-fire-guardian')
      ? 'Trial active'
      : 'Locked'

  return (
    <>
      <div className="pointer-events-none fixed right-4 top-20 z-[184] flex w-[min(330px,calc(100vw-2rem))] select-none flex-col items-end gap-2 text-white">
        <button
          type="button"
          className="pointer-events-auto rounded-md border border-orange-200/35 bg-black/72 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-orange-100 shadow-[0_0_28px_rgba(249,115,22,0.16)] backdrop-blur-md"
          onClick={() => setQuestLogOpen(open => !open)}
        >
          Quest {targetHits}/3
        </button>
        {questLogOpen && (
          <div className="w-full rounded-lg border border-orange-200/20 bg-black/76 p-3 shadow-[0_0_36px_rgba(249,115,22,0.18)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-100">Quest Zero</div>
              <div className="font-mono text-[10px] font-black text-white/70">{targetHits}/3 targets</div>
            </div>
            <div className="space-y-1.5">
              {QUEST_ZERO_STEPS.filter(step => step !== 'meet-merlin').map(step => {
                const done = completed.has(step)
                const current = quest?.currentStepId === step
                return (
                  <div key={step} className={`flex items-center gap-2 rounded border px-2 py-1.5 ${done ? 'border-emerald-300/25 bg-emerald-400/10' : current ? 'border-orange-200/35 bg-orange-400/10' : 'border-white/10 bg-white/5'}`}>
                    <div className={`h-2 w-2 rounded-full ${done ? 'bg-emerald-300' : current ? 'bg-orange-300' : 'bg-white/25'}`} />
                    <div className="min-w-0 flex-1 truncate text-[11px] font-black uppercase tracking-[0.09em] text-white/85">
                      {QUEST_ZERO_STEP_DEFS[step].name}
                    </div>
                    <div className="font-mono text-[10px] text-white/45">+{STEP_XP[step]}</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 rounded border border-white/10 bg-white/5 p-2">
              <div className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-white/45">Fire trial</div>
              <div className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 ${fireboltSpell ? 'bg-orange-400/16 text-orange-100' : completed.has('answer-fire-guardian') ? 'bg-cyan-400/12 text-cyan-100' : 'bg-black/28 text-white/45'}`}>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-orange-300 shadow-[0_0_12px_rgba(251,146,60,0.85)]" />
                  <span className="text-[11px] font-black uppercase tracking-[0.1em]">Firebolt</span>
                </div>
                <span className="font-mono text-[10px]">{fireboltStatus}</span>
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`
        @keyframes oasisQuestToastPop {
          0% { opacity: 0; transform: translate(-50%, -12px) scale(0.84); }
          18% { opacity: 1; transform: translate(-50%, 0) scale(1.05); }
          76% { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -8px) scale(0.96); }
        }
        @keyframes oasisQuestBurst {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.58) rotate(-2deg); filter: brightness(1); }
          12% { opacity: 1; transform: translate(-50%, -50%) scale(1.14) rotate(1deg); filter: brightness(1.8); }
          34% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0deg); filter: brightness(1.25); }
          100% { opacity: 0; transform: translate(-50%, -58%) scale(1.18) rotate(0deg); filter: brightness(1); }
        }
      `}</style>
      {burst && (
        <div
          className="pointer-events-none fixed left-1/2 top-[42%] z-[236] w-[min(520px,calc(100vw-2rem))] select-none rounded-lg border border-amber-100/70 bg-orange-500/86 px-5 py-4 text-center text-black shadow-[0_0_78px_rgba(251,191,36,0.62)]"
          style={{ animation: 'oasisQuestBurst 1750ms ease-out forwards' }}
        >
          <div className="text-[10px] font-black uppercase tracking-[0.26em] text-black/70">Objective Complete</div>
          <div className="mt-1 text-2xl font-black uppercase tracking-[0.08em] text-black">{burst.title}</div>
          <div className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-black/70">{burst.message}</div>
        </div>
      )}
      {toast && (
        <div
          className="pointer-events-none fixed left-1/2 top-8 z-[230] w-[min(360px,calc(100vw-2rem))] select-none rounded-lg border border-orange-200/35 bg-black/82 p-3 text-center text-white shadow-[0_0_42px_rgba(249,115,22,0.28)] backdrop-blur-md"
          style={{ animation: 'oasisQuestToastPop 2200ms ease-out forwards' }}
        >
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-100">{toast.title}</div>
          <div className="mt-1 text-[12px] font-bold text-white/80">{toast.message}</div>
        </div>
      )}
    </>
  )
}
