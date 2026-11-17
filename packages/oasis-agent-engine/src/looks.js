// Looks: what each avatar looks like, in a sentence or two, so an agent can know its own body without
// spending a picture on it in every turn. One description per avatar file (not per agent), kept in
// <characters>/_looks.json. Made once, from the avatar's gallery thumbnail
// (public/avatars/gallery/thumbs/<id>.jpg), by a one-shot `claude -p --model haiku` that is shown the picture:
// about half a cent per avatar, never again for the same file. OASIS_LOOKS=0 turns it off (the card then
// names the avatar and says how to see it: scripts/me.mjs look).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnClaude, onLines } from './claude.js';

const PROMPT = 'This picture shows a 3D avatar. Describe how it looks in one or two plain sentences, for the character itself to read: start with "You are" or "You have", name its kind of body, clothing, main colours and anything striking. Leave out its pose and the background. No preamble, no markdown, no line breaks.';
const TIMEOUT_MS = 120_000;
const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** One haiku call that is shown a picture file. -> the description, or throws. */
export function describePicture(file, { prompt = PROMPT, timeoutMs = TIMEOUT_MS } = {}) {
  const mediaType = MEDIA[path.extname(file).toLowerCase()];
  if (!mediaType) return Promise.reject(new Error(`not a picture the models read: ${file}`));
  const data = fs.readFileSync(file).toString('base64');
  const cwd = path.join(os.tmpdir(), 'oasis-agent-engine-looks'); // a bare folder: no project instructions, no memory
  fs.mkdirSync(cwd, { recursive: true });
  return new Promise((resolve, reject) => {
    // No tools, no MCP servers, nothing kept: it only looks and answers.
    const proc = spawnClaude(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku',
      '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '--tools', ''], { cwd, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } });
    let settled = false;
    const finish = (err, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.stdin.end(); } catch { /* gone */ }
      setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, 2000).unref?.();
      if (err) reject(err); else resolve(text);
    };
    const timer = setTimeout(() => finish(new Error('the description took too long')), timeoutMs);
    onLines(proc.stdout, (line) => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.type !== 'result') return;
      const text = String(m.result || '').replace(/\s+/g, ' ').trim();
      if (m.is_error || !text) finish(new Error(`no description (${m.subtype || 'empty'})`));
      else finish(null, text.slice(0, 500));
    });
    proc.on('error', (e) => finish(e));
    proc.on('exit', (code) => finish(new Error(`claude exited (${code}) before answering`)));
    proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data } }, { type: 'text', text: prompt }] }, parent_tool_use_id: null, session_id: '' })}\n`);
  });
}

export class Looks {
  /**
   * @param {{file: string, publicDir: string, enabled?: boolean, log?: (...a: any[]) => void,
   *   describe?: (file: string) => Promise<string>, onDescribed?: (avatar: string, description: string) => void}} o
   * publicDir: the Oasis app's public folder; an avatar's thumbnail is a path under it.
   */
  constructor(o) {
    this.file = o.file;
    this.publicDir = o.publicDir;
    this.enabled = o.enabled !== false;
    this.log = o.log || (() => {});
    this.describe = o.describe || ((file) => describePicture(file));
    this.onDescribed = o.onDescribed || (() => {});
    this.data = null;
    this.queue = [];
    this.busy = false;
    this.failed = new Set(); // tried in this run: not again until the engine restarts
    this.thumbs = new Map(); // avatar -> its thumbnail file, as the page reported it
    this.wanted = new Set(); // queued or being described right now
  }

  load() {
    if (this.data) return this.data;
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    } catch { this.data = {}; }
    return this.data;
  }

  /** The description of an avatar file ("/avatars/gallery/Orion.vrm"), or null when there is none yet. */
  get(avatar) {
    const entry = avatar ? this.load()[avatar] : null;
    return entry?.description || null;
  }

  /** The thumbnail's file for a page path like "/avatars/gallery/thumbs/orion.jpg"; null when it is not a file under public. */
  thumbFile(thumb) {
    if (typeof thumb !== 'string' || !thumb) return null;
    const file = path.resolve(this.publicDir, `.${path.posix.normalize(`/${thumb.replace(/[?#].*$/, '').replace(/\\/g, '/')}`)}`);
    if (!file.toLowerCase().startsWith(path.resolve(this.publicDir).toLowerCase() + path.sep)) return null;
    return fs.existsSync(file) ? file : null;
  }

  /** Make sure this avatar has a description: queued when it has none and its thumbnail exists. One at a time. */
  want(avatar, thumb) {
    const file = this.thumbFile(thumb);
    if (avatar && file) this.thumbs.set(avatar, file);
    if (!this.enabled || !avatar || !file || this.get(avatar) || this.failed.has(avatar) || this.wanted.has(avatar)) return false;
    this.wanted.add(avatar);
    this.queue.push({ avatar, file });
    void this.run();
    return true;
  }

  /** The avatar's gallery picture, when the page has named one in this run. */
  thumbFor(avatar) { return this.thumbs.get(avatar) || null; }

  async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const { avatar, file } = this.queue.shift();
        try {
          const description = await this.describe(file);
          this.load()[avatar] = { description, from: path.basename(file), at: new Date().toISOString() };
          fs.mkdirSync(path.dirname(this.file), { recursive: true });
          fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
          this.log(`look: ${avatar} described`);
          try { this.onDescribed(avatar, description); } catch { /* the cards catch up at the next report */ }
        } catch (e) {
          this.failed.add(avatar);
          this.log(`look: ${avatar} could not be described (${e.message})`);
        }
        this.wanted.delete(avatar);
      }
    } finally {
      this.busy = false;
    }
  }
}
