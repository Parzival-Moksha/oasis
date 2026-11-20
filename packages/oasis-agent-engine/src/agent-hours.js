// ░▒▓ AGENT HOURS — the engine books the agents' working time in the Mindcraft work book ▓▒░
// The owner (2026-11-20) asked whether he can close the Oasis window when he is away. Until now the open page
// relayed each turn's end to /api/village/work, so with no Oasis tab open (or one the browser had slowed down),
// the agents' hours stopped or thinned out. The engine sees every turn and every helper start and end, so it
// books them itself; the page only shows them. His own hours stay counted by the page: they are about him
// being there.
//
// What an agent-hour is (same rule as the page used, src/lib/village/work-vow.ts in the Oasis):
//   a turn's length (the CLI's duration_ms) minus the time it only waited on its own helpers (helpers at once
//   are one wait), plus each helper's running time in full, booked under its parent.
// Reports go in small batches; one that fails is kept and sent with the next (bounded). The work book books
// each (agent, kind, time) once, so a report that also arrives from an older page is not counted twice.

/** Own time in a turn: its length minus the union of its helpers' spans inside it. */
export function ownTurnMs(durationMs, endTs, helpers) {
  const from = endTs - durationMs;
  const spans = helpers
    .map((h) => [Math.max(from, h.start), Math.min(endTs, h.end ?? endTs)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let waited = 0;
  let cursor = from;
  for (const [a, b] of spans) {
    if (b <= cursor) continue;
    waited += b - Math.max(a, cursor);
    cursor = b;
  }
  return Math.max(0, durationMs - waited);
}

const MAX_QUEUE = 2000;

export class AgentHours {
  /**
   * @param {{ webUrl?: string, headers?: () => Record<string,string>, fetch?: typeof fetch, flushMs?: number,
   *           heartbeatMs?: number, log?: (...a: any[]) => void, enabled?: boolean }} o
   */
  constructor(o = {}) {
    this.webUrl = (o.webUrl || process.env.OASIS_WEB_URL || 'http://127.0.0.1:4516').replace(/\/+$/, '');
    this.headers = o.headers || (() => ({}));
    this.fetch = o.fetch || ((...a) => fetch(...a));
    this.flushMs = o.flushMs ?? 3000;
    this.heartbeatMs = o.heartbeatMs ?? 5 * 60_000;
    this.log = o.log || (() => {});
    this.enabled = o.enabled !== false;
    /** agentId -> Map(helper id -> { start, end }) */
    this.spans = new Map();
    this.queue = [];
    this.timer = null;
    this.beat = null;
    this.sending = false;
  }

  start() {
    if (!this.enabled || this.beat) return;
    // An empty report now and then tells the Oasis the engine is booking, so open pages stop relaying.
    this.beat = setInterval(() => this.flush(true), this.heartbeatMs);
    this.beat.unref?.();
    this.flush(true);
  }

  stop() {
    if (this.beat) clearInterval(this.beat);
    if (this.timer) clearTimeout(this.timer);
    this.beat = null;
    this.timer = null;
  }

  /** Every event the engine emits; `agent` is the agent it belongs to (for its session and name). */
  onEvent(event, agent) {
    if (!this.enabled || !event || !agent) return;
    const { kind, agentId, ts } = event;
    if (kind !== 'turn.end' && kind !== 'subagent.start' && kind !== 'subagent.end') return;
    if (typeof ts !== 'number') return;
    const who = { key: agent.sessionId || agent.id || agentId, name: agent.name || agentId };
    let spans = this.spans.get(agentId);
    if (!spans) this.spans.set(agentId, (spans = new Map()));
    const ids = [event.toolUseId, event.taskId].filter((id) => typeof id === 'string' && id);
    if (kind === 'subagent.start') {
      // A resumed helper (SendMessage) starts a new span under the same id.
      if (ids[0]) spans.set(ids[0], { start: ts, end: null, other: ids[1] || null });
      return;
    }
    if (kind === 'subagent.end') {
      let span = null;
      for (const id of ids) span ||= spans.get(id) || [...spans.values()].find((s) => s.other === id) || null;
      if (!span || span.end !== null) return;
      span.end = ts;
      this.push({ ...who, ts, kind: 'helper', ms: ts - span.start });
      return;
    }
    if (!(event.durationMs > 0)) return;
    this.push({ ...who, ts, kind: 'turn', ms: ownTurnMs(event.durationMs, ts, [...spans.values()]) });
    // Helpers that finished before this turn ended are done with.
    for (const [id, span] of spans) if (span.end !== null && span.end <= ts) spans.delete(id);
  }

  push(report) {
    this.queue.push(report);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(false); }, this.flushMs);
      this.timer.unref?.();
    }
  }

  /** Send what is queued (or an empty heartbeat). A failure keeps the reports for the next try. */
  async flush(heartbeat) {
    if (this.sending) return;
    if (!this.queue.length && !heartbeat) return;
    this.sending = true;
    const batch = this.queue.slice(0, 200);
    try {
      const response = await this.fetch(`${this.webUrl}/api/village/work`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers() },
        body: JSON.stringify({ agentWork: batch, source: 'engine' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.queue.splice(0, batch.length);
      // More than one batch waiting: the next goes right away.
      if (this.queue.length && !this.timer) {
        this.timer = setTimeout(() => { this.timer = null; this.flush(false); }, 0);
        this.timer.unref?.();
      }
    } catch (error) {
      if (batch.length) this.log(`agent hours: not booked yet (${error.message}); ${this.queue.length} waiting`);
      if (this.queue.length && !this.timer) {
        this.timer = setTimeout(() => { this.timer = null; this.flush(false); }, 30_000);
        this.timer.unref?.();
      }
    } finally {
      this.sending = false;
    }
  }
}
