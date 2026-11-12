// What an agent's last turn came to, kept in the roster across engine restarts.
//
// Without it a restart rebuilt every agent with no outcome and every agent read "idle · ready": the
// owner lost which ones had finished, were stuck on a decision, or were cut off mid-turn. Pure, so
// vitest can test it (src/lib/__tests__/agent-engine-outcome.test.ts).
import { STATUS } from './normalize.js';

export const STOPPED_MID_TURN = 'stopped mid-turn: the engine restarted';

/** The roster's record of a turn's end: outcome, reason, when. */
export function outcomeForRoster(outcome, now = Date.now()) {
  if (!outcome || typeof outcome.outcome !== 'string') return null;
  return { outcome: outcome.outcome, reason: outcome.reason ?? null, at: typeof outcome.at === 'number' ? outcome.at : now };
}

/**
 * From a roster entry: a turn still open when the engine stopped was cut off (an error that wants a
 * look); otherwise the last turn's outcome as it was.
 */
export function restoreOutcome(entry) {
  if (!entry) return null;
  if (typeof entry.turnOpenAt === 'number') return { outcome: 'error', reason: STOPPED_MID_TURN, at: entry.turnOpenAt };
  const o = entry.lastOutcome;
  if (o && typeof o.outcome === 'string') return { outcome: o.outcome, reason: o.reason ?? null, at: typeof o.at === 'number' ? o.at : null };
  return null;
}

/** The status an idle agent shows for its last outcome (same rules as Agent.recomputeStatus). */
export function statusForOutcome(outcome) {
  if (!outcome) return { status: STATUS.IDLE, reason: 'ready' };
  if (outcome.outcome === 'error') return { status: STATUS.ERROR, reason: outcome.reason || 'error' };
  if (outcome.outcome === 'needs-decision') return { status: STATUS.DECISION, reason: outcome.reason || 'needs a decision' };
  return { status: STATUS.WAITING, reason: outcome.reason || 'end_turn' };
}
