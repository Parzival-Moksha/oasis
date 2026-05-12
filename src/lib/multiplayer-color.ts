// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MULTIPLAYER COLOR — deterministic palette by player id
// ─═̷─═̷─ॐ─═̷─═̷─ Same id → same color, everywhere ─═̷─═̷─ॐ─═̷─═̷─
//
// Used by:
//   - multiplayer-presence.ts (server-side color assignment)
//   - MultiplayerPresenceLayer (client-side fallback)
//   - ForgeRealm / PaintCursor (so the wand-tip sparkler tints by visitor)
// Keeping this in one module prevents drift across the three call sites.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export const PRESENCE_PALETTE = [
  '#38bdf8', '#fb7185', '#facc15', '#22c55e',
  '#a78bfa', '#f97316', '#2dd4bf', '#e879f9',
] as const

export function colorForPlayerId(playerId: string): string {
  let hash = 0
  for (let i = 0; i < playerId.length; i += 1) {
    hash = ((hash << 5) - hash + playerId.charCodeAt(i)) | 0
  }
  return PRESENCE_PALETTE[Math.abs(hash) % PRESENCE_PALETTE.length] || PRESENCE_PALETTE[0]
}
