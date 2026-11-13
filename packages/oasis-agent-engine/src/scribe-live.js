// Live dictation through ElevenLabs (Scribe Realtime). The same /listen protocol as ears.js, so the page doesn't care
// which one types: the page asks for it with ?engine=elevenlabs (Settings → Sound → Voice typing; local Moonshine is
// the other choice). The engine opens ElevenLabs' realtime socket with the key (readScribeKey, the one voice messages
// and Telegram use; it never reaches the page), forwards the page's 16 kHz PCM pieces, and turns ElevenLabs' events
// into ears.py's lines:
//   session_started       -> {"t":"ready"}
//   partial_transcript    -> {"t":"partial","line":n,"text":…}   the segment so far (a later one replaces it)
//   committed_transcript  -> {"t":"final","line":n,"text":…}     settled after a pause (VAD), then the next line
// On "stop" it commits what is left, waits for those last words, and answers "stopped".
import WebSocket from 'ws';
import { readScribeKey } from './telegram.js';

const REALTIME_URL = process.env.OASIS_LIVE_SCRIBE_URL || 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
// scribe_v3_live: first words after about a second and a fresh line every ~0.3 s (scribe_v2_realtime: ~2.4 s, ~1 s).
export const LIVE_SCRIBE_MODEL = process.env.OASIS_LIVE_SCRIBE_MODEL || 'scribe_v3_live';
/** Names it should hear right (the same ones voice messages pass to Scribe). */
const KEYTERMS = ['Anorak', 'Oasis'];
/** After "stop": the last words get this long at most. */
const SETTLE_MAX_MS = 5000;
/** After "stop": this long with nothing new means the words are in (shorter once a line has settled). */
const SETTLE_QUIET_MS = 700;
const SETTLE_AFTER_FINAL_MS = 150;
const RATE = 16000;

export function hasLiveScribe() {
  return Boolean(readScribeKey());
}

export function liveScribeParams(lang) {
  const params = new URLSearchParams({ model_id: LIVE_SCRIBE_MODEL, audio_format: 'pcm_16000', commit_strategy: 'vad' });
  if (lang && lang !== 'auto') params.set('language_code', lang);
  for (const term of KEYTERMS) params.append('keyterms', term);
  return params;
}

/** One dictation per page socket. */
export function listenScribe(ws, url, log, { key = readScribeKey(), endpoint = REALTIME_URL } = {}) {
  const lang = (url.searchParams.get('lang') || 'en').slice(0, 8);
  const json = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  const chunk = (pcm, commit = false) => JSON.stringify({
    message_type: 'input_audio_chunk',
    audio_base_64: pcm ? pcm.toString('base64') : '',
    commit,
    sample_rate: RATE,
  });

  let started = false;
  let stopped = false;
  let finished = false;
  let line = 0;
  let partial = '';
  let audioBytes = 0;
  let settleQuiet = null;
  let settleMax = null;
  const pending = [];

  const upstream = new WebSocket(`${endpoint}?${liveScribeParams(lang)}`, { headers: { 'xi-api-key': key } });

  const finish = (why) => {
    if (finished) return;
    finished = true;
    clearTimeout(settleQuiet);
    clearTimeout(settleMax);
    // Words heard but never committed are still the owner's words: keep them.
    if (partial.trim()) json({ t: 'final', line, text: partial.trim() });
    partial = '';
    if (why) json({ t: 'error', text: why });
    json({ t: 'stopped', audio_s: Math.round((audioBytes / (RATE * 2)) * 10) / 10 });
    try { upstream.close(); } catch { /* gone */ }
    setTimeout(() => { try { ws.close(); } catch { /* gone */ } }, 50);
  };
  // After "stop", every message pushes the end back a little; nothing for a moment means done.
  const settleSoon = (ms = SETTLE_QUIET_MS) => {
    clearTimeout(settleQuiet);
    settleQuiet = setTimeout(() => finish(), ms);
  };
  const commitAndSettle = () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(chunk(null, true));
    settleMax = setTimeout(() => finish(), SETTLE_MAX_MS);
    // Nothing waiting to be committed: only the last ~100 ms can still turn into words.
    if (!partial.trim()) settleSoon();
  };

  json({ t: 'status', text: 'Connecting to ElevenLabs…' });

  upstream.on('message', (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    const type = m.message_type;
    if (type === 'session_started') {
      started = true;
      json({ t: 'ready', model: `elevenlabs ${LIVE_SCRIBE_MODEL}`, warm: true });
      for (const b of pending.splice(0)) upstream.send(chunk(b));
      if (stopped) commitAndSettle();
      return;
    }
    if (type === 'partial_transcript') {
      const text = String(m.text || '');
      if (!text && !partial) return; // keepalive
      partial = text;
      json({ t: 'partial', line, text });
      if (stopped) settleSoon();
      return;
    }
    if (type === 'committed_transcript') {
      const text = String(m.text || '').trim();
      partial = '';
      if (text) {
        json({ t: 'final', line, text });
        line += 1;
      }
      if (stopped) settleSoon(SETTLE_AFTER_FINAL_MS);
      return;
    }
    if (m.error || /error|exceeded|limit|throttled|overflow|exhausted|terms|insufficient/.test(String(type))) {
      const text = `ElevenLabs voice typing: ${String(m.error || type).slice(0, 200)}`;
      log?.(`ears(elevenlabs): ${type}`);
      finish(text);
    }
  });
  upstream.on('unexpected-response', (_req, res) => {
    finish(`ElevenLabs refused voice typing (HTTP ${res.statusCode})${res.statusCode === 401 ? ': check the API key' : ''}`);
  });
  upstream.on('error', (e) => finish(`Can't reach ElevenLabs for voice typing: ${e.message}`));
  upstream.on('close', () => finish(started || stopped ? undefined : 'ElevenLabs closed the voice typing connection.'));

  ws.on('message', (data, isBinary) => {
    if (finished) return;
    if (isBinary) {
      const b = Buffer.isBuffer(data) ? data : Buffer.concat(data);
      audioBytes += b.length;
      if (started && upstream.readyState === WebSocket.OPEN) upstream.send(chunk(b));
      else if (pending.length < 600) pending.push(b); // ~60 s while ElevenLabs answers
      return;
    }
    let m = {};
    try { m = JSON.parse(String(data)); } catch { return; }
    if (m.t === 'stop' && !stopped) {
      stopped = true;
      if (started) commitAndSettle();
      // Not started yet: session_started commits; if it never comes, the error or close handler ends it.
    }
  });
  ws.on('close', () => {
    stopped = true;
    finished = true;
    clearTimeout(settleQuiet);
    clearTimeout(settleMax);
    try { upstream.close(); } catch { /* gone */ }
  });
}
