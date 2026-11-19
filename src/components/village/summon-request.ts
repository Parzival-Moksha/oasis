// ░▒▓ SUMMON REQUEST — which kind of agent the summon menu opens on ▓▒░
// A spell (Summon Claude Code, Summon Hermes, …) opens the one summon menu on its own kind. The kind waits here
// until the menu opens and takes it, so no store field is needed for a one-shot hint.

import { openVillagePicker } from './village-actions'

/** The agent kinds the summon menu shows. Codex and phone call have no engine runtime yet (shown greyed). */
export type SummonKind = 'claude' | 'hermes' | 'codex' | 'phone'

let pending: SummonKind | null = null

export function openSummonMenu(kind?: SummonKind): void {
  if (kind) pending = kind
  openVillagePicker(true)
}

export function takeSummonKind(): SummonKind | null {
  const kind = pending
  pending = null
  return kind
}
