// Read-only "observe" mode: tail a session transcript (.jsonl) that the Oasis does not own
// (e.g. a session open in the desktop app or a terminal) and emit the same normalized events.
// Never writes to the session. Status is inferred from records + file activity.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Normalizer, STATUS } from './normalize.js';
import { readLiveRegistry } from './sessions.js';

const HISTORY_BYTES = 512 * 1024; // how much of an existing transcript to replay on attach
const POLL_MS = 1000;
const WORKING_STALE_MS = 10 * 60 * 1000; // "working" with no writes for 10 min -> probably dead
const WAITING_STALE_MS = 60 * 60 * 1000; // waiting for an hour -> idle (gray)

export class Observer {
  /**
   * @param {{id:string, name?:string, sessionPath:string}} spec
   * @param {{emit:(agentId:string, kind:string, payload?:object)=>void, log:(...a:any[])=>void}} hub
   */
  constructor(spec, hub) {
    this.kind = 'observer';
    this.id = spec.id;
    this.sessionPath = path.resolve(spec.sessionPath);
    this.sessionId = path.basename(this.sessionPath, '.jsonl');
    this.name = spec.name || `observe ${this.sessionId.slice(0, 8)}`;
    this.hub = hub;
    this.offset = 0;
    this.partial = Buffer.alloc(0);
    this.status = STATUS.IDLE;
    this.statusReason = 'attaching';
    this.lastWriteAt = 0;
    this.cwd = null;
    this.title = null;
    this.reading = false;
    this.norm = new Normalizer(this.id, (kind, payload) => this.onEvent(kind, payload), { mode: 'observe' });
  }

  snapshot() {
    return {
      id: this.id, kind: this.kind, name: this.name, title: this.title, cwd: this.cwd || this.norm.cwd || null,
      sessionId: this.sessionId, sessionPath: this.sessionPath, model: this.norm.model, resolvedModel: this.norm.model,
      status: this.status, statusReason: this.statusReason, alive: true, readOnly: true,
      context: this.norm.contextTokens ? { usedTokens: this.norm.contextTokens, maxTokens: this.norm.contextWindow, percent: this.norm.contextWindow ? Math.round((100 * this.norm.contextTokens) / this.norm.contextWindow) : null } : null,
      lastWriteAt: this.lastWriteAt, live: this.live || null,
    };
  }

  async start() {
    const st = await fsp.stat(this.sessionPath);
    this.offset = Math.max(0, st.size - HISTORY_BYTES);
    this.skipPartialFirst = this.offset > 0;
    this.hub.emit(this.id, 'init', { sessionId: this.sessionId, observed: true, sessionPath: this.sessionPath });
    await this.readNew();
    this.checkStale();
    this.timer = setInterval(() => this.readNew().catch((e) => this.hub.log(`[observe ${this.id}] ${e.message}`)), POLL_MS);
    this.staleTimer = setInterval(() => this.checkStale(), 5000);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.staleTimer);
  }

  async readNew() {
    if (this.reading) return;
    this.reading = true;
    try {
      const st = await fsp.stat(this.sessionPath).catch(() => null);
      if (!st) return;
      if (st.size < this.offset) { this.offset = 0; this.partial = Buffer.alloc(0); } // rewritten
      if (st.size === this.offset) return;
      this.lastWriteAt = st.mtimeMs;
      const fh = await fsp.open(this.sessionPath, 'r');
      let buf;
      try {
        buf = Buffer.alloc(st.size - this.offset);
        const { bytesRead } = await fh.read(buf, 0, buf.length, this.offset);
        buf = buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
      this.offset += buf.length;
      // Split on '\n' at the byte level: it never occurs inside a UTF-8 multi-byte sequence.
      let data = Buffer.concat([this.partial, buf]);
      let start = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0x0a) continue;
        const line = data.subarray(start, i).toString('utf8');
        start = i + 1;
        if (this.skipPartialFirst) { this.skipPartialFirst = false; continue; }
        if (!line.trim()) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        this.onRecord(rec);
      }
      this.partial = Buffer.from(data.subarray(start));
    } finally {
      this.reading = false;
    }
  }

  onRecord(rec) {
    if (rec.isSidechain) return;
    if (rec.cwd && !this.cwd) this.cwd = rec.cwd;
    // Activity -> working; the normalizer's turn.end moves us to waiting / needs-decision.
    if (rec.type === 'user') {
      const c = rec.message?.content;
      const isPrompt = !rec.isMeta && (typeof c === 'string' || (Array.isArray(c) && c.some((b) => b?.type === 'text')));
      const isToolResult = Array.isArray(c) && c.some((b) => b?.type === 'tool_result');
      if (isPrompt || isToolResult) this.setStatus(STATUS.WORKING, isToolResult ? 'tool result' : 'prompt');
    } else if (rec.type === 'assistant') {
      this.setStatus(STATUS.WORKING, 'assistant');
    }
    this.norm.handleRecord(rec);
  }

  onEvent(kind, payload) {
    if (kind === 'meta' && payload.title) this.title = payload.title;
    if (kind === 'user') this.norm.openTurn();
    this.hub.emit(this.id, kind, payload);
    if (kind === 'turn.end') {
      const map = { 'done-waiting': STATUS.WAITING, 'needs-decision': STATUS.DECISION, error: STATUS.ERROR };
      this.setStatus(map[payload.outcome] || STATUS.WAITING, payload.reason);
    }
  }

  checkStale() {
    // The live registry (~/.claude/sessions/<pid>.json) knows busy/idle for the process that owns
    // the session, which beats guessing from transcript writes.
    const live = readLiveRegistry().get(this.sessionId) || null;
    this.live = live;
    if (live) {
      if (live.status === 'busy' && this.status !== STATUS.WORKING && this.status !== STATUS.DECISION) return this.setStatus(STATUS.WORKING, `busy (pid ${live.pid})`);
      if (live.status === 'idle' && this.status === STATUS.WORKING) return this.setStatus(STATUS.WAITING, `idle (pid ${live.pid})`);
      return undefined;
    }
    const idleFor = Date.now() - this.lastWriteAt;
    if (this.status === STATUS.WORKING && idleFor > WORKING_STALE_MS) this.setStatus(STATUS.IDLE, 'no writes for 10+ min');
    else if ((this.status === STATUS.WAITING || this.status === STATUS.DECISION) && idleFor > WAITING_STALE_MS) this.setStatus(STATUS.IDLE, 'quiet for 1h+');
    else if (this.statusReason === 'attaching') this.setStatus(STATUS.IDLE, 'no activity seen yet');
  }

  setStatus(status, reason) {
    if (status === this.status && reason === this.statusReason) return;
    this.status = status;
    this.statusReason = reason;
    this.hub.emit(this.id, 'status', { status, reason });
  }
}
