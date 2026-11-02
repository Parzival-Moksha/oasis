// Session discovery over %USERPROFILE%\.claude\projects\<encoded-cwd>\<uuid>.jsonl
//
// Files can be huge (100+ MB), so we only read a head chunk (cwd, first prompt, entrypoint)
// and a tail chunk (latest custom-title / agent-name / summary), cached by mtime+size.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 128 * 1024;
const cache = new Map(); // file -> {mtimeMs, size, info}

/** C:\7c_oasis\spike -> C--7c-oasis-spike (every non-alphanumeric char becomes '-'). */
export function encodeProjectDir(cwd) {
  return path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

export function sessionFileFor(cwd, sessionId) {
  return path.join(PROJECTS_DIR, encodeProjectDir(cwd), `${sessionId}.jsonl`);
}

/** Find <sessionId>.jsonl in any project dir (the owner may pick a cwd that differs from the original). */
export function findSessionFile(sessionId, cwd) {
  if (cwd) {
    const p = sessionFileFor(cwd, sessionId);
    if (fs.existsSync(p)) return p;
  }
  try {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      const p = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
      if (fs.existsSync(p)) return p;
    }
  } catch { /* no projects dir */ }
  return null;
}

export function isTranscriptPath(p) {
  const abs = path.resolve(p);
  return abs.toLowerCase().startsWith(path.resolve(PROJECTS_DIR).toLowerCase() + path.sep) && abs.endsWith('.jsonl');
}

async function readChunk(file, start, len) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

function parseLines(text, { dropFirst = false, dropLast = false } = {}) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift();
  if (dropLast) lines.pop();
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch { out.push({ __raw: l }); }
  }
  return out;
}

function promptText(rec) {
  if (rec.type !== 'user' || rec.isMeta || rec.isSidechain) return null;
  const c = rec.message?.content;
  let t = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b) => b?.type === 'tool_result') ? c.filter((b) => b?.type === 'text').map((b) => b.text).join(' ') : null;
  if (!t) return null;
  t = t.trim();
  if (!t || t.startsWith('<') || t.startsWith('Caveat:') || t.startsWith('[Request interrupted')) return null;
  return t.replace(/\s+/g, ' ').slice(0, 160);
}

async function describe(f) {
  const hit = cache.get(f.file);
  if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) return hit.info;
  const whole = f.size <= CHUNK * 2;
  const headText = await readChunk(f.file, 0, Math.min(f.size, whole ? f.size : CHUNK));
  const head = parseLines(headText, { dropLast: !whole });
  const tail = whole ? head : parseLines(await readChunk(f.file, Math.max(0, f.size - CHUNK), CHUNK), { dropFirst: true });

  let cwd = null, firstPrompt = null, entrypoint = null, version = null, gitBranch = null;
  for (const r of head) {
    if (r.__raw) {
      if (!cwd) { const m = r.__raw.match(/"cwd":"((?:[^"\\]|\\.)*)"/); if (m) cwd = JSON.parse(`"${m[1]}"`); }
      continue;
    }
    if (!cwd && r.cwd) cwd = r.cwd;
    if (r.type === 'user' && !entrypoint && r.entrypoint) { entrypoint = r.entrypoint; version = r.version; gitBranch = r.gitBranch; }
    if (!firstPrompt) firstPrompt = promptText(r);
    if (cwd && firstPrompt && entrypoint) break;
  }
  if (!firstPrompt) for (const r of tail) { firstPrompt = promptText(r); if (firstPrompt) break; }
  // A giant first record (e.g. a file-history snapshot) can push cwd out of the head chunk.
  if (!cwd) for (const r of tail) if (r.cwd) { cwd = r.cwd; break; }
  if (!entrypoint) for (const r of tail) if (r.type === 'user' && r.entrypoint) { entrypoint = r.entrypoint; version = r.version; gitBranch = r.gitBranch; break; }

  let title = null, titleSource = null;
  const titleFile = path.join(f.dir, f.sessionId, 'custom-title.json');
  try {
    const t = JSON.parse(fs.readFileSync(titleFile, 'utf8')).customTitle;
    if (t) { title = t; titleSource = 'custom-title.json'; }
  } catch { /* none */ }
  if (!title) {
    for (let i = tail.length - 1; i >= 0; i--) {
      const r = tail[i];
      if (r.type === 'custom-title' && r.customTitle) { title = r.customTitle; titleSource = 'custom-title'; break; }
      if (r.type === 'agent-name' && r.agentName && !title) { title = r.agentName; titleSource = 'agent-name'; }
      if (r.type === 'summary' && r.summary && !title) { title = r.summary; titleSource = 'summary'; }
    }
  }
  let lastPrompt = null;
  for (let i = tail.length - 1; i >= 0 && !lastPrompt; i--) if (tail[i].type === 'last-prompt') lastPrompt = tail[i].lastPrompt;
  if (!title && firstPrompt) { title = firstPrompt.slice(0, 80); titleSource = 'first-prompt'; }

  const info = {
    sessionId: f.sessionId,
    path: f.file,
    projectDir: f.projectDir,
    cwd,
    title: title || '(untitled)',
    titleSource,
    firstPrompt,
    lastPrompt: lastPrompt ? String(lastPrompt).slice(0, 160) : null,
    entrypoint,
    version,
    gitBranch,
    size: f.size,
    mtime: f.mtimeMs,
  };
  cache.set(f.file, { mtimeMs: f.mtimeMs, size: f.size, info });
  return info;
}

// Live registry: every running Claude Code process (desktop app, terminal, -p, SDK) keeps
// ~/.claude/sessions/<pid>.json = {pid, sessionId, cwd, kind, entrypoint, name, status: idle|busy, ...}.
// `claude agents --json` reads the same data. Files of dead pids linger, so check the pid.
// (<pid>.<hash>.key files next to them hold peer tokens: never read them.)
export const LIVE_DIR = path.join(CLAUDE_DIR, 'sessions');

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** @returns {Map<string, {pid:number, status:string, kind:string, entrypoint:string, name:string, cwd:string, statusUpdatedAt:number}>} */
export function readLiveRegistry() {
  const out = new Map();
  let files = [];
  try { files = fs.readdirSync(LIVE_DIR).filter((f) => /^\d+\.json$/.test(f)); } catch { return out; }
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(LIVE_DIR, f), 'utf8'));
      if (!r.sessionId || !pidAlive(r.pid)) continue;
      const prev = out.get(r.sessionId);
      if (prev && prev.statusUpdatedAt > (r.statusUpdatedAt || 0)) continue;
      out.set(r.sessionId, { pid: r.pid, status: r.status, kind: r.kind, entrypoint: r.entrypoint, name: r.name, cwd: r.cwd, statusUpdatedAt: r.statusUpdatedAt || r.updatedAt || 0 });
    } catch { /* partial write; skip */ }
  }
  return out;
}

/** Newest first. `live` = a running process has it open right now (from the registry above). */
export async function listSessions({ limit = 150, project } = {}) {
  let dirs;
  try { dirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    if (project && d.name.toLowerCase() !== String(project).toLowerCase()) continue;
    const dir = path.join(PROJECTS_DIR, d.name);
    let entries;
    try { entries = await fsp.readdir(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const sessionId = name.slice(0, -6);
      if (!UUID_RE.test(sessionId)) continue;
      files.push({ dir, projectDir: d.name, file: path.join(dir, name), sessionId });
    }
  }
  await Promise.all(files.map(async (f) => {
    try { const st = await fsp.stat(f.file); f.mtimeMs = st.mtimeMs; f.size = st.size; } catch { f.mtimeMs = 0; f.size = 0; }
  }));
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const now = Date.now();
  const live = readLiveRegistry();
  const infos = await Promise.all(files.slice(0, limit).map((f) => describe(f).catch((e) => ({ sessionId: f.sessionId, path: f.file, projectDir: f.projectDir, title: `(unreadable: ${e.message})`, mtime: f.mtimeMs, size: f.size }))));
  return infos.map((i) => ({ ...i, recentlyActive: now - i.mtime < 5 * 60 * 1000, live: live.get(i.sessionId) || null }));
}
