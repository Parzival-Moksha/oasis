// Pictures the owner pastes or drops into an agent chat in the Oasis. Each one is checked (a picture type the
// models read, at most PICTURE_MAX_BYTES, at most PICTURES_MAX per message), kept as a file the page can show
// (GET /file/<id>, like SendUserFile's pictures) and sent to the agent as an image block in the same user
// message as the text (agent.js sendNow, the path the eyes picture takes).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerAttachment } from './files.js';

/** What the models take as image blocks. */
export const PICTURE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
/** The API's limit for one image (base64 characters). */
export const PICTURE_MAX_BYTES = 5 * 1024 * 1024;
export const PICTURES_MAX = 10;
const PICTURE_DIR = path.join(os.tmpdir(), 'oasis-agent-engine-pictures');

/**
 * [{ data: base64, mediaType, name? }] from the page -> [{ data, mediaType, name, fileId }], or throws with a
 * sentence for the owner.
 */
export function takePictures(images, { dir = PICTURE_DIR } = {}) {
  if (images == null) return [];
  if (!Array.isArray(images)) throw new Error('pictures must be a list');
  if (images.length > PICTURES_MAX) throw new Error(`at most ${PICTURES_MAX} pictures in one message`);
  return images.map((image, i) => {
    const mediaType = String(image?.mediaType || '').toLowerCase();
    const ext = PICTURE_TYPES[mediaType];
    const name = String(image?.name || `picture-${i + 1}${ext || ''}`).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
    if (!ext) throw new Error(`${name}: the agents read PNG, JPEG, GIF and WebP pictures, not ${mediaType || 'this file'}`);
    const data = String(image?.data || '').replace(/^data:[^,]*,/, '');
    // The API's 5 MB is counted on the base64 the request carries.
    if (data.length > PICTURE_MAX_BYTES) throw new Error(`${name}: ${(data.length / 1048576).toFixed(1)} MB as sent, the limit is 5 MB a picture`);
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length) throw new Error(`${name}: empty picture`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${ext}`);
    fs.writeFileSync(file, bytes);
    // path: the journal keeps it with a message that has not reached its agent yet (journal.js).
    return { data: bytes.toString('base64'), mediaType, name, path: file, fileId: registerAttachment(file, mediaType, true) };
  });
}
