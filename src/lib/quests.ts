// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ONBOARDING QUEST SYSTEM — "The Noble Eightfold Build"
// 7 steps from zero to builder. Complete them all for 3x XP bonus.
// Progress tracked in localStorage, bonus XP via server.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { awardXp } from '@/hooks/useXp'

// ═══════════════════════════════════════════════════════════════════════════
// QUEST DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export const QUEST_IDS = [
  'open-wizard',
  'place-object',
  'select-object',
  'add-light',
  'set-sky',
  'set-ground',
  'share-world',
] as const

export type QuestId = typeof QUEST_IDS[number]

export interface QuestDef {
  id: QuestId
  number: number
  title: string
  description: string
  icon: string
  doneIcon: string
}

export const QUESTS: QuestDef[] = [
  {
    id: 'open-wizard',
    number: 1,
    title: 'Open the Wizard Console',
    description: 'Click the ✨ button (top-left) to open your creation engine. Browse the Gallery for ready-made objects, or Conjure 3D models from text.',
    icon: '✨',
    doneIcon: '✅',
  },
  {
    id: 'place-object',
    number: 2,
    title: 'Place an Object',
    description: 'Pick any item from the Gallery or Conjure a model. Click on the ground to place it. Scroll to adjust height.',
    icon: '📍',
    doneIcon: '✅',
  },
  {
    id: 'select-object',
    number: 3,
    title: 'Select & Inspect',
    description: 'Click a placed object to select it. The Inspector opens on the right — transform, animate, customize.',
    icon: '🔧',
    doneIcon: '✅',
  },
  {
    id: 'add-light',
    number: 4,
    title: 'Light Your World',
    description: 'Open the Lights tab in Wizard Console. Add a directional light for sun, point lights for lamps, or IBL for reflections.',
    icon: '💡',
    doneIcon: '✅',
  },
  {
    id: 'set-sky',
    number: 5,
    title: 'Set the Sky',
    description: 'In Wizard Console Settings tab, choose a sky background. It sets the mood for your entire world.',
    icon: '🌅',
    doneIcon: '✅',
  },
  {
    id: 'set-ground',
    number: 6,
    title: 'Paint the Ground',
    description: 'In Wizard Console Settings tab, choose a ground preset or use the brush tool to paint terrain tiles.',
    icon: '🎨',
    doneIcon: '✅',
  },
  {
    id: 'share-world',
    number: 7,
    title: 'Share Your Creation',
    description: 'In the top bar, change world visibility to Public. Copy the link. Anyone can visit your world in 3D.',
    icon: '🌍',
    doneIcon: '✅',
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// QUEST PROGRESS — localStorage-backed, fire-and-forget XP on completion
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'oasis-quest-progress'

export function getQuestProgress(): Partial<Record<QuestId, boolean>> {
  if (typeof window === 'undefined') return {}
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : {}
  } catch { return {} }
}

export function isQuestComplete(id: QuestId): boolean {
  return getQuestProgress()[id] || false
}

export function completedQuestCount(): number {
  const progress = getQuestProgress()
  return QUEST_IDS.filter(id => progress[id]).length
}

export function allQuestsComplete(): boolean {
  return completedQuestCount() === QUEST_IDS.length
}

/**
 * Mark a quest as complete. Returns true if it was newly completed (first time).
 * Awards bonus XP on first completion. Awards mega bonus when all 7 done.
 */
export function completeQuest(id: QuestId): boolean {
  const progress = getQuestProgress()
  if (progress[id]) return false // already done

  progress[id] = true
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))

  // Award quest step bonus XP
  awardXp('QUEST_STEP_COMPLETE')

  // Check if all quests are now complete
  if (QUEST_IDS.every(qid => progress[qid])) {
    awardXp('QUEST_ALL_COMPLETE')
  }

  // Dispatch custom event so the Guide tab re-renders
  window.dispatchEvent(new CustomEvent('quest-complete', { detail: { id } }))

  return true
}
