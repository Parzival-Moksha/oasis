// ░▒▓ FOLLOW VIEW — what "Follow me" really does for an agent right now, for its switches ▓▒░
// The switch alone said "on" while something stronger kept the agent where it was: an order (a right-click while
// it was selected parks it on that spot), the Council's circle, or the Academy's stone. The owner saw Follow on and
// an agent that no longer came along (2026-11-18). The switches show this view, and pressing Follow on a parked
// agent ends the order, so it follows again.

import { useSyncExternalStore } from 'react'
import { clearSentGoal, getAgentSelectionVersion, getSentGoalSeq, subscribeAgentSelection } from '../../lib/village/agent-selection'
import { getCouncilVersion, isCouncilMember, subscribeCouncil } from './village-council'
import { getVillageFollowVersion, isVillageFollowOn, setVillageFollow, subscribeVillageFollow } from './village-companion'

/**
 * on: it follows. off: it stays at its desk. parked: Follow is on, but an order keeps it on the spot it was
 * sent to. council: Follow is on, but it stands in the Council's circle until the Council ends.
 */
export type FollowView = 'on' | 'off' | 'parked' | 'council'

export function getVillageFollowView(agentId: string, key: string, name: string | null | undefined): FollowView {
  if (!isVillageFollowOn(key, name)) return 'off'
  if (isCouncilMember(agentId)) return 'council'
  if (getSentGoalSeq(agentId) !== 0) return 'parked'
  return 'on'
}

/** The switch was pressed: a parked agent follows again (its order ends); otherwise Follow flips. */
export function pressVillageFollow(agentId: string, key: string, name: string | null | undefined): void {
  const view = getVillageFollowView(agentId, key, name)
  if (view === 'parked') {
    clearSentGoal(agentId)
    return
  }
  setVillageFollow(key, name, view === 'off')
}

/** Set Follow to `on` (the settings menu's checkbox): on also ends an order that parks it. */
export function setVillageFollowFor(agentId: string, key: string, name: string | null | undefined, on: boolean): void {
  if (on) clearSentGoal(agentId)
  setVillageFollow(key, name, on)
}

export function useVillageFollowView(agentId: string, key: string, name: string | null | undefined): FollowView {
  useSyncExternalStore(subscribeVillageFollow, getVillageFollowVersion, () => 0)
  useSyncExternalStore(subscribeAgentSelection, getAgentSelectionVersion, () => 0)
  useSyncExternalStore(subscribeCouncil, getCouncilVersion, () => 0)
  return getVillageFollowView(agentId, key, name)
}
