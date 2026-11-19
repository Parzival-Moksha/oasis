'use client'

// ░▒▓ VILLAGE CONFIRM — the question before something final (dismissing an agent) ▓▒░
// The Oasis's own dialog from the shared UI kit (Hipster's, components/ui-kit: kitConfirm), instead of the browser's
// box the owner called "super ugly". Kept as one call for the village so its callers never change.

import { kitConfirm } from '@/components/ui-kit'

export interface VillageConfirmRequest {
  title: string
  body?: string
  /** The confirming button's words ("Dismiss"). */
  confirm?: string
  cancel?: string
  /** A final, destructive action: red. */
  danger?: boolean
}

/** Ask; resolves true when confirmed, false when cancelled (Esc, a click outside, Cancel). */
export function confirmVillage(request: VillageConfirmRequest): Promise<boolean> {
  return kitConfirm(request)
}

/** Is a kit dialog open (the village keys stand aside, so Enter presses its button)? */
export function isVillageConfirmOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[data-kit-dialog]') !== null
}
