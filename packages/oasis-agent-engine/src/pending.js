// Bookkeeping for user messages written to a stream-json CLI but not yet echoed back by
// --replay-user-messages. Pure functions over Map<uuid, {text, sentAt, turnWasRunning, turnIndex}>
// so they can be unit-tested (src/lib/__tests__/agent-engine-engine-logic.test.ts in af_oasis).
//
// Why it matters: the avatar stays `working` while any message is pending. An entry that never
// gets matched would keep the agent "working" forever.

/**
 * Which pending uuids does this echo consume? The exact uuid wins. Otherwise every pending
 * message whose text the echo contains: the CLI can merge several queued messages into one.
 * @param {Map<string, {text: string}>} pending
 * @param {{uuid?: string|null, text?: string}} echo
 * @returns {string[]}
 */
export function matchReplay(pending, { uuid, text } = {}) {
  if (uuid && pending.has(uuid)) return [uuid]
  const body = typeof text === 'string' ? text : ''
  if (!body) return []
  const hits = []
  for (const [key, entry] of pending) if (entry.text && body.includes(entry.text)) hits.push(key)
  return hits
}

/**
 * After an interrupt only the messages the CLI still has queued will run (`still_queued`).
 * Without that list (older CLIs) nothing is dropped.
 * @param {Map<string, unknown>} pending
 * @param {unknown} stillQueued
 * @returns {string[]} uuids to drop
 */
export function droppedAfterInterrupt(pending, stillQueued) {
  if (!Array.isArray(stillQueued)) return []
  const keep = new Set(stillQueued.map(String))
  return [...pending.keys()].filter((key) => !keep.has(key))
}

/**
 * At a `result` for turn `turnIndex`: a message sent during an earlier turn (or while idle before
 * this one) has had a whole turn to be echoed. If it still is not, it was merged or lost.
 * Messages sent during this turn are kept: they may run as the next turn.
 * @param {Map<string, {turnIndex?: number}>} pending
 * @param {number} turnIndex
 * @returns {string[]} uuids to expire
 */
export function expiredAtResult(pending, turnIndex) {
  return [...pending].filter(([, entry]) => (entry.turnIndex ?? 0) < turnIndex).map(([key]) => key)
}

/**
 * An interrupt flags the turn it was sent in. A turn that starts later is not interrupted by it.
 * @param {number|null|undefined} flagTurn
 * @param {number} currentTurn
 */
export function interruptApplies(flagTurn, currentTurn) {
  return flagTurn !== null && flagTurn !== undefined && flagTurn === currentTurn
}
