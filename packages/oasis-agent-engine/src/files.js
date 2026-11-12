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
};

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

export function serveAttachment(id, res) {
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
    // Audio registered as audio (voice messages) plays inline; anything else that isn't an image downloads.
    const audio = (f.mediaType || '').startsWith('audio/') && AUDIO_TYPES[ext] ? AUDIO_TYPES[ext] : null;
    res.writeHead(200, {
      'content-type': f.isImage ? IMAGE_TYPES[ext] : audio || 'application/octet-stream',
      'content-length': st.size,
      'content-disposition': `${f.isImage || audio ? 'inline' : 'attachment'}; filename="${name}"`,
      'content-security-policy': "default-src 'none'; img-src 'self'; sandbox",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=3600',
    });
    fs.createReadStream(f.path).on('error', () => res.destroy()).pipe(res);
  });
}
