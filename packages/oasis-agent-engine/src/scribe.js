// Voice messages from the Oasis: ElevenLabs Scribe, the same request the Telegram module makes for voice
// notes (telegram.js transcribe: scribe_v2, no audio-event tags, the village's names as key terms) and
// the same key (readScribeKey: ELEVENLABS_API_KEY, else the file scribe.py reads). The key is never
// logged or sent to the page.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readScribeKey } from './telegram.js';
import { registerAttachment } from './files.js';

const SCRIBE_API = 'https://api.elevenlabs.io/v1/speech-to-text';
// Long voice messages are fine: Scribe takes long files. At the page's 32 kbit/s that is about 4 hours, and as base64
// it still fits the engine socket's 100 MiB message limit.
export const VOICE_MAX_BYTES = 70 * 1024 * 1024;
const VOICE_DIR = path.join(os.tmpdir(), 'oasis-agent-engine-voice');

const EXT = { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav' };

export function voiceExtension(mime) {
  return EXT[String(mime || '').split(';')[0].trim().toLowerCase()] || '.webm';
}

export async function scribeTranscribe({ audio, name, mime, key, keyterms = [], api = process.env.OASIS_SCRIBE_API || SCRIBE_API, timeoutMs = 120_000 }) {
  const form = new FormData();
  form.append('model_id', 'scribe_v2');
  form.append('tag_audio_events', 'false');
  for (const t of [...new Set(keyterms)].filter((t) => t && t.length <= 40).slice(0, 40)) form.append('keyterms', t);
  form.append('file', new Blob([audio], { type: String(mime || 'audio/webm').split(';')[0] }), name);
  const res = await fetch(api, { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: AbortSignal.timeout(timeoutMs) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Scribe ${res.status}: ${String(data?.detail?.message || data?.detail || '').slice(0, 160)}`);
  return String(data.text || '').trim();
}

/**
 * Keep a recorded voice message as a file the page can play (GET /file/<id>) and transcribe it.
 * Returns { fileId, mime, transcript }.
 */
export async function takeVoiceMessage({ audioBase64, mime, keyterms = [] }) {
  const key = readScribeKey();
  if (!key) throw new Error('Voice messages need an ElevenLabs key (ELEVENLABS_API_KEY).');
  const audio = Buffer.from(String(audioBase64 || ''), 'base64');
  if (!audio.length) throw new Error('empty recording');
  if (audio.length > VOICE_MAX_BYTES) throw new Error('recording too long');
  const type = String(mime || 'audio/webm').split(';')[0].trim().toLowerCase();
  fs.mkdirSync(VOICE_DIR, { recursive: true });
  const file = path.join(VOICE_DIR, `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${voiceExtension(type)}`);
  fs.writeFileSync(file, audio);
  const fileId = registerAttachment(file, type, false);
  // Two minutes, plus time for long recordings (about 30 s more per MB, ~4 minutes of speech).
  const timeoutMs = 120_000 + Math.ceil(audio.length / (1024 * 1024)) * 30_000;
  const transcript = await scribeTranscribe({ audio, name: path.basename(file), mime: type, key, keyterms: ['Anorak', 'Oasis', ...keyterms], timeoutMs });
  return { fileId, mime: type, transcript };
}
