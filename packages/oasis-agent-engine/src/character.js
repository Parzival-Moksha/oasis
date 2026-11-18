// Characters: who each agent in the village is, one markdown file per session in one folder
// (data/characters/<session id>.md, next to the roster; OASIS_CHARACTERS overrides the folder).
//
//   ---
//   name: Citizens                       the engine keeps these lines up to date
//   session: 12f6ca3a-…
//   voice: Brian (brian): deep, calm     from the Oasis page (the voice its avatar speaks with)
//   look: Orion. A tall figure in …      the avatar it wears, and what that looks like (looks.js)
//   avatar: /avatars/gallery/Orion.vrm
//   world: Oasis Dusk                    where the page last saw it
//   home: Oasis Dusk                     the world it was first seen in
//   place: Its desk is … Nearby: …       from the page: what is around its place
//   role: Makes agents citizens of …     the owner's or the agent's own words, one sentence
//   updated: 2026-11-17T11:02:00.000Z
//   ---
//   <who you are: a few sentences, the owner's or the agent's own words>
//
// The file is the truth: the engine reads it each time, so the owner or the agent can edit `role` and the text
// under the header with any editor (the agent's settings menu and scripts/me.mjs do the same through
// setCharacter). The engine only rewrites its own lines.
//
// How an agent learns it: a short note rides with a message from the owner, the way the voice note does
// (voice.js: a system prompt appended at launch never reaches a session that already exists, and every village
// agent is a resumed session). It goes with the first message after each start of the agent's process, again
// when the owner or the agent changed the card, when its world changed, and after a compaction, so it stays in
// context without costing tokens on every turn. Pure helpers here are unit-tested
// (src/lib/__tests__/agent-engine-character.test.ts).
import { setting } from './settings.js';
import fs from 'node:fs';
import path from 'node:path';

const ENGINE_KEYS = ['name', 'session', 'voice', 'look', 'avatar', 'world', 'home', 'place'];
const KEYS = [...ENGINE_KEYS, 'role', 'updated'];
/** How results reach the owner (his words, 2026-11-17: a player in the thread, not a path to the mp4). */
export const SHOW_FILES = 'To show the owner a picture, an audio file, a video or a document, send the file with SendUserFile: it plays or opens in the thread. A file path alone is not enough.';
/**
 * Where questions for the owner that can wait go (his rule, 2026-11-17), instead of waiting in a thread he may not
 * open for days. Also in the plugin's note; here too, because a session that already exists keeps the system prompt
 * it started with, and this note reaches it with the next message. The file is this machine's `grillFile` setting (settings.js); without one the line is left out.
 */
export const GRILL_FILE = setting('grillFile');
export const ASK_LATER = GRILL_FILE
  ? `Questions for the owner that are not urgent go at the bottom of ${GRILL_FILE}, under "Added by agents": one line with your name, the question and your recommendation, instead of waiting in your thread.`
  : '';
export const ROLE_MAX = 240;
export const WHO_MAX = 1200;

const oneLine = (s, max = 600) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Text of a card file -> { fields: {name, session, voice, look, avatar, world, home, place, role, updated}, who }. */
export function parseCard(text) {
  const fields = {};
  let who = String(text || '');
  const m = who.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([a-z]+):[ \t]*(.*)$/i);
      if (kv && KEYS.includes(kv[1].toLowerCase())) fields[kv[1].toLowerCase()] = kv[2].trim();
    }
    who = who.slice(m[0].length);
  }
  return { fields, who: who.trim() };
}

export function serializeCard({ fields = {}, who = '' }) {
  const lines = KEYS.filter((k) => fields[k]).map((k) => `${k}: ${oneLine(fields[k], k === 'place' || k === 'look' ? 900 : 300)}`);
  return `---\n${lines.join('\n')}\n---\n\n${String(who || '').trim()}\n`;
}

/**
 * The note an agent reads: who it is, in a few lines. No `]` inside (the thread hides `[Oasis you: …]` blocks,
 * normalize.js). `tools`: the path of scripts/me.mjs, so the agent can look at itself and around, and edit its card.
 */
export function characterNote(card, { file = '', tools = '', showFiles = true } = {}) {
  const f = card.fields || {};
  const parts = [`You are ${f.name || 'an agent'}, an agent in the owner's Oasis, a 3D village on this machine where the owner walks around and talks to you.`];
  if (f.role) parts.push(`Role: ${f.role}`);
  if (card.who) parts.push(`Who you are: ${oneLine(card.who, WHO_MAX)}`);
  if (f.look) parts.push(`Your look: ${f.look}`);
  if (f.voice) parts.push(`Your voice: ${f.voice}`);
  if (f.world || f.place) parts.push(`Your place: ${[f.world ? `the world "${f.world}".` : '', f.place || ''].filter(Boolean).join(' ')}`);
  if (tools) {
    parts.push(`In a shell, node "${tools}" look saves a front picture of your avatar, around saves four pictures of what is around you (read the files it prints), card prints this card${card.who ? '' : ', and who "<a few sentences>" writes your own who-you-are (nobody has yet)'}.`);
  }
  // Not for a session in another window: it may not have the tool, so the mod says it there only when it does.
  if (showFiles) parts.push(SHOW_FILES);
  if (ASK_LATER) parts.push(ASK_LATER);
  if (file) parts.push(`Your card is the file ${file}.`);
  return `[Oasis you: ${parts.map((p) => (/[.!?]$/.test(p) ? p : `${p}.`)).join(' ').replace(/\]/g, ')')}]`;
}

/** What makes a card worth telling again: the owner's or the agent's words, its look, and the world it is in. */
export function cardStamp(card) {
  const f = card.fields || {};
  return [f.name, f.role, card.who, f.look, f.world].map((x) => x || '').join('\u0001');
}

export class Characters {
  /** @param {string} dir the folder of card files */
  constructor(dir) {
    this.dir = dir;
  }

  fileFor(sessionId) {
    if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
    return path.join(this.dir, `${sessionId.toLowerCase()}.md`);
  }

  /** The card as it is on disk (an empty one when there is none yet). */
  read(sessionId) {
    const file = this.fileFor(sessionId);
    if (!file) return { fields: {}, who: '', file: null };
    try { return { ...parseCard(fs.readFileSync(file, 'utf8')), file }; } catch { return { fields: {}, who: '', file }; }
  }

  write(sessionId, card) {
    const file = this.fileFor(sessionId);
    if (!file) return null;
    const next = serializeCard({ fields: { ...card.fields, session: sessionId, updated: new Date().toISOString() }, who: card.who });
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, next);
    fs.renameSync(tmp, file);
    return file;
  }

  /**
   * The engine's own lines (name, voice, look, avatar, world, place). Only what changed is written; `role` and
   * the who-you-are text are never touched. `home` is set once, to the first world it is seen in.
   * -> the card after it
   */
  setFacts(sessionId, facts) {
    const card = this.read(sessionId);
    if (!card.file) return card;
    const fields = { ...card.fields };
    let changed = !fs.existsSync(card.file);
    for (const key of ENGINE_KEYS) {
      if (key === 'session' || key === 'home' || facts[key] === undefined) continue;
      const value = oneLine(facts[key], key === 'place' || key === 'look' ? 900 : 300);
      if ((fields[key] || '') !== value) { if (value) fields[key] = value; else delete fields[key]; changed = true; }
    }
    if (!fields.home && fields.world) { fields.home = fields.world; changed = true; }
    if (changed) this.write(sessionId, { fields, who: card.who });
    return { ...card, fields };
  }

  /** The owner's or the agent's words: `role` (one sentence) and `who` (a few). undefined leaves a part as it is. */
  setOwn(sessionId, { role, who } = {}) {
    const card = this.read(sessionId);
    if (!card.file) throw new Error('this agent has no session yet');
    const fields = { ...card.fields };
    if (role !== undefined) { const r = oneLine(role, ROLE_MAX); if (r) fields.role = r; else delete fields.role; }
    const text = who !== undefined ? String(who).replace(/\r\n/g, '\n').trim().slice(0, WHO_MAX) : card.who;
    this.write(sessionId, { fields, who: text });
    return { ...card, fields, who: text };
  }

  /** Cards in the folder: [{ sessionId, name }]. */
  list() {
    try {
      return fs.readdirSync(this.dir).filter((f) => /^[0-9a-f-]{36}\.md$/i.test(f)).map((f) => {
        const sessionId = f.slice(0, -3);
        return { sessionId, name: this.read(sessionId).fields.name || null };
      });
    } catch { return []; }
  }
}

/** Next to the roster: data/agent-engine.local.json -> data/characters. */
export function charactersDirFor(rosterFile) {
  return path.join(path.dirname(rosterFile), 'characters');
}
