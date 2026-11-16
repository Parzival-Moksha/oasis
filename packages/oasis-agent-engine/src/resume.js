// Coming back from a restart: who was cut off mid-turn, and the one line that says what happened.
// Pure, so vitest can test it (src/lib/__tests__/agent-engine-resume.test.ts). The journal (journal.js) holds the
// messages; agent.js delivers them; index.js restoreRoster decides per agent with the helpers here.
//
// Verified with Claude Code 2.1.323 (2026-11-16, a test engine killed with taskkill /F while a Bash call ran):
// - the agent's claude process dies with the engine within 3 s (its stdin closes); nothing lingers
// - the transcript ends on the assistant's tool_use; `--resume` plus one user message picks the work up again
//   (the model reran the cut tool call and finished), with a single init: no turn closes by itself any more
// - a message written to stdin while the turn ran is lost: the transcript only has a `queue-operation enqueue`
//   for it and the resumed session never sees it. The first message's uuid is in the transcript, the queued one's
//   is not, which is how a redelivery knows what the CLI already has.

/** What a mid-turn agent is told, once, when the engine is back. */
export const RESUME_TEXT = 'The engine restarted while you were working. Carry on from where you stopped.';
export const RESUMED_REASON = 'resumed after the engine restart';

/**
 * Was the session's last turn still open? From the end of its transcript (the last lines, newest last).
 * -> true (cut off), false (it ended), null (cannot tell: no conversation lines in this piece).
 * The last main-thread conversation record decides: an assistant record that stopped for a tool or mid-stream, or a
 * tool result nobody answered, is an open turn; an assistant record that ended its turn, or an interrupt, is not.
 */
export function transcriptTurnOpen(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || (!line.includes('"type":"assistant"') && !line.includes('"type":"user"') && !line.includes('"type":"system"'))) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.isSidechain) continue;
    if (m.type === 'system') {
      // What a finished turn leaves behind it (observe.js reads turn ends from the same records).
      if (m.subtype === 'turn_duration' || m.subtype === 'stop_hook_summary') return false;
      continue;
    }
    if (m.type === 'assistant') {
      const stop = m.message?.stop_reason;
      return !(stop === 'end_turn' || stop === 'stop_sequence' || stop === 'refusal');
    }
    if (m.type === 'user') {
      if (m.isMeta) continue;
      const c = m.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
      if (/^\[Request interrupted by user/.test(text)) return false;
      if (text.startsWith('<local-command-') || text.startsWith('<command-')) continue;
      return true; // a prompt or a tool result with nothing after it
    }
  }
  return null;
}

/**
 * Should this agent be told to carry on?
 * @param {{turnOpenAt?: number}} entry its roster entry
 * @param {boolean|null} transcriptOpen transcriptTurnOpen() of its session, null when unknown
 * @param {{planned: boolean}|null} stop how the last run ended
 * The roster's turnOpenAt is written when a turn starts and cleared when it ends. The transcript corrects it both
 * ways after an unplanned stop (the write is 150 ms behind), and one way after a planned one: a turn that still
 * finished while the engine was closing is not resumed.
 */
export function wasMidTurn(entry, transcriptOpen, stop) {
  const flagged = typeof entry?.turnOpenAt === 'number';
  if (flagged) return transcriptOpen !== false;
  if (stop && stop.planned === false) return transcriptOpen === true;
  return false;
}

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function span(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

/**
 * "restarted at 18:02, 1 agent resumed" for /health and the HUD's engine pill.
 * @param {{startedAt:number, stop:{at:number,planned:boolean,reason?:string|null}|null, resumed:string[], redelivered:number}} info
 */
export function restartLine(info) {
  if (!info?.stop) return null; // a first start, nothing came before
  const parts = [`restarted at ${hhmm(info.startedAt)}`];
  const down = info.startedAt - info.stop.at;
  if (!info.stop.planned) parts[0] += ` after an unplanned stop around ${hhmm(info.stop.at)}`;
  else if (down > 5 * 60_000) parts[0] += ` (down ${span(down)})`;
  const n = info.resumed.length;
  parts.push(n ? `${n} agent${n === 1 ? '' : 's'} resumed` : 'nobody was mid-turn');
  if (info.redelivered) parts.push(`${info.redelivered} queued message${info.redelivered === 1 ? '' : 's'} delivered`);
  return parts.join(', ');
}
