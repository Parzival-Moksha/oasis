// A session's past, read from its transcript in pieces: the Oasis thread loads older history as the owner scrolls up.
// Every event read from a transcript carries `at`, the byte offset where its record's line starts, so the page knows
// where its oldest entry came from and can ask for what lies before it (olderHistory in index.js).
// Claude Code writes one content block per assistant line, so a line start is a clean seam between two pieces.
import fs from 'node:fs';
import { Normalizer } from './normalize.js';

const STEP = 128 * 1024;
const NL = 0x0a;

/** Kinds a history piece never carries: they describe the process now, not the past. */
const SKIP_KINDS = new Set(['status', 'init', 'rate_limit']);

function readAt(fd, start, length) {
  const buf = Buffer.alloc(length);
  return buf.subarray(0, fs.readSync(fd, buf, 0, length, start));
}

/**
 * Complete lines that start in [from, before), newest last. `from` is moved forward to the first line start at or after
 * it (a line cut by the window belongs to the previous piece). A last line without its newline (still being written)
 * is left out. Returns `{lines: [{at, text}], from}` where `from` is where the first returned line starts.
 */
export function linesInRange(fd, from, before) {
  if (before <= from) return { lines: [], from: before };
  // One byte earlier tells whether `from` is a line start.
  const start = from > 0 ? from - 1 : 0;
  const buf = readAt(fd, start, before - start);
  let i = 0;
  if (from > 0) {
    const nl = buf.indexOf(NL);
    if (nl === -1) return { lines: [], from: before }; // one line longer than the window
    i = nl + 1;
  }
  const first = start + i;
  const lines = [];
  while (i < buf.length) {
    const nl = buf.indexOf(NL, i);
    if (nl === -1) break; // unterminated tail
    if (nl > i) lines.push({ at: start + i, text: buf.subarray(i, nl).toString('utf8') });
    i = nl + 1;
  }
  return { lines, from: lines.length ? lines[0].at : first };
}

/** Normalize transcript lines into history events (each with `at`, `history: true` and the record's own time). */
export function normalizeLines(agentId, lines) {
  const events = [];
  let at = null;
  let ts = null;
  const norm = new Normalizer(agentId, (kind, payload) => {
    if (SKIP_KINDS.has(kind)) return;
    events.push({ ...payload, v: 1, agentId, ts: ts ?? Date.now(), kind, history: true, at });
  }, { mode: 'observe' });
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line.text); } catch { continue; }
    at = line.at;
    ts = Date.parse(rec?.timestamp) || null;
    if (rec?.type === 'user' && !rec.isMeta) norm.openTurn();
    norm.handleRecord(rec);
  }
  return events;
}

/** Start of the line holding byte `pos`. */
function lineStartOf(fd, pos) {
  let end = pos;
  while (end > 0) {
    const start = Math.max(0, end - 64 * 1024);
    const nl = readAt(fd, start, end - start).lastIndexOf(NL);
    if (nl !== -1) return start + nl + 1;
    end = start;
  }
  return 0;
}

function lineAt(fd, at) {
  const parts = [];
  let pos = at;
  for (;;) {
    const buf = readAt(fd, pos, 256 * 1024);
    if (!buf.length) break;
    const nl = buf.indexOf(NL);
    if (nl !== -1) { parts.push(buf.subarray(0, nl)); break; }
    parts.push(buf);
    pos += buf.length;
  }
  return Buffer.concat(parts).toString('utf8');
}

/**
 * Where the assistant line holding tool_use `toolUseId` starts, searching back from the end; null when absent.
 * Owned agents' live entries have no transcript position, so the page anchors on its oldest tool call instead.
 * (api-request-blob lines repeat the same block later in the file, hence the record type check.)
 */
export function findToolUseLine(fd, toolUseId) {
  if (typeof toolUseId !== 'string' || !/^[\w-]{6,80}$/.test(toolUseId)) return null;
  const needle = Buffer.from(`"id":"${toolUseId}"`);
  let end = fs.fstatSync(fd).size;
  let tail = Buffer.alloc(0); // the first bytes of the newer chunk, for a needle cut by the chunk edge
  while (end > 0) {
    const start = Math.max(0, end - STEP);
    const chunk = readAt(fd, start, end - start);
    const hay = Buffer.concat([chunk, tail]);
    let i = hay.lastIndexOf(needle);
    while (i !== -1) {
      const at = lineStartOf(fd, start + i);
      try {
        if (JSON.parse(lineAt(fd, at))?.type === 'assistant') return at;
      } catch { /* a torn line */ }
      i = i > 0 ? hay.lastIndexOf(needle, i - 1) : -1;
    }
    tail = chunk.subarray(0, needle.length - 1);
    end = start;
  }
  return null;
}

/**
 * The piece of a transcript before `before` (a line start; null = the end of the file, or the line of `anchor`, a tool
 * use id). Grows backwards until it holds `minEvents` events, `maxBytes` bytes, or the start of the session.
 * Returns `{events, from, done}`: the next piece ends at `from`, and `done` means this one reached the first line.
 */
export function readOlderHistory(file, agentId, { before = null, anchor = null, minEvents = 150, maxBytes = 4 * 1024 * 1024 } = {}) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    let end = typeof before === 'number' && Number.isFinite(before) ? Math.max(0, Math.min(before, size)) : size;
    if (anchor) {
      const at = findToolUseLine(fd, anchor);
      if (at === null) throw new Error('that tool call is not in the transcript');
      end = at;
    }
    let span = Math.min(STEP, maxBytes);
    for (;;) {
      const from = Math.max(0, end - span);
      const { lines, from: first } = linesInRange(fd, from, end);
      const events = normalizeLines(agentId, lines);
      const reachedStart = from === 0;
      // Past maxBytes only while not one whole line fits (a giant record): every piece moves `from` back.
      if (reachedStart || events.length >= minEvents || (span >= maxBytes && lines.length)) {
        return { events, from: reachedStart ? 0 : first, done: reachedStart };
      }
      span = span >= maxBytes ? span * 2 : Math.min(maxBytes, span * 2);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** The last `bytes` of a transcript as history events (owned agents show this much when they resume). */
export function readHistoryTail(file, agentId, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const { lines } = linesInRange(fd, Math.max(0, size - bytes), size);
    return normalizeLines(agentId, lines);
  } finally {
    fs.closeSync(fd);
  }
}
