// The clip watchdog (Windows): gives back a mouse a browser left confined (../clip-watchdog/clip-watchdog.ps1).
// The engine keeps one running while it runs: a named mutex makes a second copy exit at once (one started by hand,
// or by an earlier engine, keeps the job), so this checks again every minute and takes over when it can; a copy
// that dies is started again. Its lines go to the engine log; the full history is in %TEMP%\oasis-clip-watchdog.log.
// OASIS_CLIP_WATCHDOG=0 turns it off.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', 'clip-watchdog', 'clip-watchdog.ps1');

let child = null;
let timer = null;
let stopped = false;
let state = 'off';

export function clipWatchdogState() {
  return state;
}

export function startClipWatchdog(log) {
  if (process.platform !== 'win32' || process.env.OASIS_CLIP_WATCHDOG === '0') return;
  stopped = false;
  const run = () => {
    timer = null;
    if (stopped || child) return;
    let othersOwn = false;
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    state = 'starting';
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        if (/another clip watchdog is running/.test(line)) { othersOwn = true; state = 'running (another copy)'; continue; }
        if (/watchdog on/.test(line)) state = 'running';
        log?.(`clip: ${line.replace(/^\S+ \S+ /, '')}`);
      }
    });
    child.stderr.on('data', (d) => { const t = d.toString('utf8').trim(); if (t) log?.(`clip: ${t.slice(0, 200)}`); });
    child.on('error', (e) => { log?.(`clip: watchdog did not start (${e.message})`); state = 'off'; });
    child.on('close', () => {
      child = null;
      if (stopped) return;
      if (!othersOwn) state = 'restarting';
      // Another copy has the job: look again in a minute. Ours died: start it again shortly.
      timer = setTimeout(run, othersOwn ? 60_000 : 10_000);
      timer.unref?.();
    });
  };
  run();
}

export function stopClipWatchdog() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  try { child?.kill(); } catch { /* gone */ }
  child = null;
  state = 'off';
}
