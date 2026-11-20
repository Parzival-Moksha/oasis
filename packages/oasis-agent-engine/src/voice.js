// Voice: a voiced agent ends each reply with one line `<spoken>…</spoken>`, a short version written to be
// heard. The Oasis page hides the tag in the thread and has the agent's avatar say it out loud with an
// ElevenLabs voice (src/lib/village/village-spoken.ts, /api/village/speak). Roster `speak`, on by default
// for Anorak only: every spoken line costs ElevenLabs credits.
//
// How the agent is told: a short note rides with each message from the owner, the way the eyes picture's
// caption does. Not --append-system-prompt: Claude Code records a conversation's system prompt on its first
// request and resends that record on every later request and resume (--system-prompt-snapshot, on by
// default in 2.1.318), so a prompt appended at a later launch never reaches a session that already exists,
// and every village agent is a resumed session. A note in the message works at once, needs no restart of
// the agent's process, and stops the moment the switch goes off.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The voices an agent can have: the same list the page offers in an agent's settings menu
 * (src/lib/village/village-voices.json: [{key, id, name, sound}]). An agent can pick its own with
 * scripts/voice.mjs (the `chooseVoice` command); the owner's pick in the settings menu wins over it.
 */
const VOICES_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'lib', 'village', 'village-voices.json');
let voices = null;
export function listVoices() {
  if (!voices) {
    try {
      const parsed = JSON.parse(fs.readFileSync(VOICES_FILE, 'utf8'));
      voices = Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.key === 'string').map((v) => ({ key: v.key, name: String(v.name || v.key), sound: String(v.sound || '') })) : [];
    } catch {
      voices = [];
    }
  }
  return voices;
}
export function isVoiceKey(key) {
  return typeof key === 'string' && listVoices().some((v) => v.key === key);
}

/** Every agent makes a spoken line by default (any name matches); the owner switches it per agent (session panel). */
export const VOICE_DEFAULT = /^/;

/** Said next to the owner's message. Kept out of the thread (normalize.js strips it). No `]` inside. */
export const VOICE_NOTE = '[Oasis voice: the owner hears your reply. End it with one line <spoken>…</spoken>: at most about 40 words, written to be heard (plain words; no markdown, code, paths or lists), in the language of your reply. Your avatar says that line out loud; the rest of the reply stays text.]';

/** Said once to a voiced agent that has not picked a voice: how to pick one. `script`: the path of scripts/voice.mjs. No `]` inside. */
export function voicePickNote(script) {
  return `[Oasis voice: you may pick your own voice, once, to fit your character. In a shell: node "${script}" list, then node "${script}" set <key>. Until then you speak with a voice dealt at random; the owner can still change it.]`;
}

/** Said once with the first message after the switch went off: the agent has the habit by then. */
export const VOICE_OFF_NOTE = '[Oasis voice: off now. No <spoken> line at the end of your replies any more.]';

/** A text block that is one of the engine's own notes (eyes caption, voice note, who-you-are note): for the model, not for the thread. */
export const ENGINE_NOTE = /^\[Oasis (eyes|voice|you|schedule|account): [^\]]*\]$/;

/** A reply without its spoken line, for places that only show text (Telegram). */
export function stripSpoken(text) {
  if (typeof text !== 'string' || !/<spoken>/i.test(text)) return text;
  return text
    .replace(/<spoken>[\s\S]*?<\/spoken>/gi, '')
    .replace(/<spoken>[\s\S]*$/i, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
