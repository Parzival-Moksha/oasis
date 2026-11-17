// Files an agent sent with SendUserFile, served to the Oasis page at GET /file/<id>.
//
// Claude Code offers SendUserFile in -p mode when CLAUDE_CODE_ATTACHMENTS_BY_PATH=1 (agent.js sets it):
// the host shows the files from their paths. Its tool_use_result lists them:
//   { caption, display, attachments: [{ path, size, isImage, media_type, pathValidated }] }
// Only those validated paths get an id (random, unguessable), so nothing else on disk is reachable.
// Responses carry a sandbox CSP and anything that isn't an image downloads instead of opening: a sent
// .html or .svg must never run script on this origin, which also takes agent commands (/api/cmd).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_FILES = 2000;
const byId = new Map(); // id -> { path, mediaType, isImage }
const byPath = new Map(); // path -> id (replayed history reuses ids)

/** Voice messages recorded in the Oasis (scribe.js): played inline by the page's <audio>. */
const AUDIO_TYPES = {
  '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.flac': 'audio/flac', '.opus': 'audio/ogg', '.aac': 'audio/aac',
};
const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

/**
 * Sound and video an agent sends (or the owner records) play inside the Oasis: served inline, with byte ranges.
 * By the file's extension; a .webm is sound when it was registered as sound (voice messages), else video.
 */
export function playableType(ext, declared) {
  const d = String(declared || '').toLowerCase();
  if (ext === '.webm') return d.startsWith('audio/') ? AUDIO_TYPES['.webm'] : VIDEO_TYPES['.webm'];
  return AUDIO_TYPES[ext] || VIDEO_TYPES[ext] || null;
}

const IMAGE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
};

export function registerAttachment(filePath, mediaType, isImage) {
  const p = path.resolve(String(filePath));
  const known = byPath.get(p);
  if (known) return known;
  const id = randomUUID();
  byId.set(id, { path: p, mediaType: mediaType || null, isImage: !!isImage });
  byPath.set(p, id);
  if (byId.size > MAX_FILES) {
    const [oldest] = byId.keys();
    byPath.delete(byId.get(oldest).path);
    byId.delete(oldest);
  }
  return id;
}

/** SendUserFile's tool_use_result -> what the page shows: name, size, kind and the id for /file/<id>. */
export function attachmentsFromResult(result) {
  const list = Array.isArray(result?.attachments) ? result.attachments : [];
  return list
    .filter((a) => a && typeof a.path === 'string' && a.path && a.pathValidated !== false)
    .slice(0, 24)
    .map((a) => {
      const ext = path.extname(a.path).toLowerCase();
      // SVG stays a download: as a document it could carry script.
      const isImage = !!a.isImage && ext in IMAGE_TYPES;
      return {
        id: registerAttachment(a.path, a.media_type, isImage),
        name: path.basename(a.path),
        size: Number.isFinite(Number(a.size)) ? Number(a.size) : null,
        isImage,
        mediaType: typeof a.media_type === 'string' ? a.media_type : null,
      };
    });
}

/** A picture the agent opened with Read: served like a sent picture (images only; anything else stays unreachable). */
export function attachmentForReadImage(filePath) {
  const p = path.resolve(String(filePath));
  const ext = path.extname(p).toLowerCase();
  if (!(ext in IMAGE_TYPES)) return [];
  let size = null;
  try { size = fs.statSync(p).size; } catch { return []; }
  return [{ id: registerAttachment(p, IMAGE_TYPES[ext], true), name: path.basename(p), size, isImage: true, mediaType: IMAGE_TYPES[ext] }];
}

/** Where a registered file lives (telegram.js uploads what an agent sent). Only ids handed out above resolve. */
export function attachmentFile(id) {
  const f = byId.get(id);
  return f ? { path: f.path, isImage: f.isImage, mediaType: f.mediaType } : null;
}

/** "bytes=a-b" against a file of `size` bytes: {start, end} (inclusive), 'bad' when it can't be served, null for none. */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start;
  let end;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? 'bad' : { start, end };
}

export function serveAttachment(id, res, req = null) {
  const f = byId.get(id);
  if (!f) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('unknown file');
  }
  fs.stat(f.path, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('file is gone');
    }
    const ext = path.extname(f.path).toLowerCase();
    const name = path.basename(f.path).replace(/["\r\n]/g, '_');
    // Pictures, sound and video show inline (the thread plays them; the page never navigates to them);
    // anything else downloads.
    const audio = f.isImage ? null : playableType(ext, f.mediaType);
    const headers = {
      'content-type': f.isImage ? IMAGE_TYPES[ext] : audio || 'application/octet-stream',
      'content-disposition': `${f.isImage || audio ? 'inline' : 'attachment'}; filename="${name}"`,
      'content-security-policy': "default-src 'none'; img-src 'self'; sandbox",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=3600',
    };
    // Sound and video answer byte ranges, so the players can jump around.
    const range = audio ? parseRange(req?.headers?.range, st.size) : null;
    if (range === 'bad') {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return res.end();
    }
    if (range) {
      res.writeHead(206, { ...headers, 'accept-ranges': 'bytes', 'content-range': `bytes ${range.start}-${range.end}/${st.size}`, 'content-length': range.end - range.start + 1 });
      return fs.createReadStream(f.path, { start: range.start, end: range.end }).on('error', () => res.destroy()).pipe(res);
    }
    res.writeHead(200, { ...headers, ...(audio ? { 'accept-ranges': 'bytes' } : {}), 'content-length': st.size });
    fs.createReadStream(f.path).on('error', () => res.destroy()).pipe(res);
  });
}

// ─── the md reader: read and save back a text file an agent sent ───────────────────────────────────────────
// Only files that got an id above (the agent sent them with SendUserFile) and only text types: nothing else on
// disk is reachable, and a save goes to that same path, never anywhere else. A save refuses when the file changed
// on disk since it was read (the agent may have rewritten it), unless the owner forces it.
const TEXT_EDIT_TYPES = new Set(['.md', '.markdown', '.mdx', '.txt']);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export function isReadableText(name) {
  return TEXT_EDIT_TYPES.has(path.extname(String(name || '')).toLowerCase());
}

function textFileOf(id) {
  const f = byId.get(String(id));
  if (!f) throw new Error('unknown file (it was not sent in this engine run: ask the agent to send it again)');
  if (!isReadableText(f.path)) throw new Error('only .md, .markdown and .txt files can be read here');
  return f;
}

/** { name, text, mtimeMs, size } of a sent text file. */
export async function readTextFile(id) {
  const f = textFileOf(id);
  const st = await fs.promises.stat(f.path).catch(() => null);
  if (!st || !st.isFile()) throw new Error('file is gone');
  if (st.size > MAX_TEXT_BYTES) throw new Error(`too big to read here (${Math.round(st.size / 1024)} KB, limit ${MAX_TEXT_BYTES / 1024} KB)`);
  const text = await fs.promises.readFile(f.path, 'utf8');
  return { name: path.basename(f.path), text, mtimeMs: st.mtimeMs, size: st.size };
}

/** Save back to the file's own path. expectedMtimeMs: what the reader saw; a different file on disk is refused unless force. */
/** @param {string} id @param {string} text @param {{ expectedMtimeMs?: number | null, force?: boolean }} [options] */
export async function writeTextFile(id, text, { expectedMtimeMs = null, force = false } = {}) {
  const f = textFileOf(id);
  if (typeof text !== 'string') throw new Error('nothing to save');
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error(`too big to save here (limit ${MAX_TEXT_BYTES / 1024} KB)`);
  const st = await fs.promises.stat(f.path).catch(() => null);
  if (!st || !st.isFile()) throw new Error('file is gone');
  if (!force && expectedMtimeMs !== null && Math.abs(st.mtimeMs - expectedMtimeMs) > 1) {
    const e = new Error('the file changed on disk since you opened it (the agent may have rewritten it)');
    e.code = 'changed';
    throw e;
  }
  await fs.promises.writeFile(f.path, text, 'utf8');
  const after = await fs.promises.stat(f.path);
  return { name: path.basename(f.path), mtimeMs: after.mtimeMs, size: after.size };
}
