// ░▒▓ PROFILE XP — on this machine the owner's Profile level is his Mindcraft XP ▓▒░
// The owner, 2026-11-19 ("fold in"): one XP. His old Profile XP (building, quests, logins) becomes a
// starting balance, taken once; from then on his XP is what Mindcraft counts (1 XP a minute of
// counted work, the commitment included). The old Profile row keeps its history and stops growing.
// Hosted Oasis (many players, no work counter): unchanged, the database's XP as before.

import 'server-only'

import { isHostedOasis } from './oasis-profile'
import { foldedOwnerXp } from './work-vow-server'

export interface ProfileXp {
  /** The XP to show and to level from. */
  xp: number
  /** Where it comes from (local only). */
  sources?: { oldBalance: number; mindcraft: number; foldedAt: number }
}

/** Does this machine's Profile follow Mindcraft? Local Oasis only, and only while the work book can be read. */
export function profileFollowsMindcraft(): boolean {
  return !isHostedOasis(process.env) && process.env.OASIS_PROFILE_XP !== 'database'
}

export async function profileXp(databaseXp: number): Promise<ProfileXp> {
  if (!profileFollowsMindcraft()) return { xp: databaseXp }
  try {
    const folded = await foldedOwnerXp(databaseXp)
    return { xp: folded.total, sources: { oldBalance: folded.oldXp, mindcraft: folded.mindcraftXp, foldedAt: folded.foldedAt } }
  } catch {
    // The work book can't be read: show the database's XP rather than nothing.
    return { xp: databaseXp }
  }
}
