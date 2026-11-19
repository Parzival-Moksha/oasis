#!/usr/bin/env node
// The Oasis supervisor: runs the agent engine and the page server with no windows, keeps their output in log files,
// starts again one that dies, and restarts one when the owner clicks Restart in Settings (through the page's
// /api/oasis/services route). The mission: C:/7c_oasis/docs/missions/oasis-app.md.
//
//   node scripts/oasis-supervisor.mjs          run (scripts/oasis-app.ps1 starts it hidden; one per machine)
//   node scripts/oasis-supervisor.mjs status   what it sees, from the running supervisor
//
// Services (a port that already answers is left alone and only watched, so the old two-window launcher can still be
// used and the supervisor takes over when one of its windows closes):
//   engine  pnpm dev:engine  127.0.0.1:4530   stopped through its own `shutdown` command first (a planned goodbye:
//                                              agents mid-turn are resumed at start), killed only if it does not go
//   world   pnpm dev         127.0.0.1:4516   the page server (next dev): its process tree is ended
// Logs: logs/engine.log and logs/world.log (rolled over to .1 at 20 MB). A dead service is started again after
// 5, 15, then 60 s; after five crashes in ten minutes it is left down and the status says so.
//
// Control: http://127.0.0.1:4531, loopback only, never from a browser (any Origin header is refused).
//   GET  /status                       the services' state (no secrets)
//   POST /restart {service}            needs the header x-oasis-key: the key in data/oasis-supervisor.local.json,
//                                      which the page's server reads. Agents must not call it (the owner's rule);
//                                      the key keeps out web pages and mistakes, not a determined local process.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.OASIS_SUPERVISOR_PORT || 4531);
const LOGS = process.env.OASIS_SUPERVISOR_LOGS || path.join(HOME, 'logs');
const KEY_FILE = process.env.OASIS_SUPERVISOR_KEY_FILE || path.join(HOME, 'data', 'oasis-supervisor.local.json');
const CHECK_MS = Number(process.env.OASIS_SUPERVISOR_CHECK_MS || 5000);
const BACKOFF_MS = [5000, 15000, 60000];
const GIVE_UP = { crashes: 5, withinMs: 10 * 60_000 };
const LOG_MAX = 20 * 1024 * 1024;
const WIN = process.platform === 'win32';

/** The services; `command` is run through the shell (pnpm is a .cmd on Windows). Overridable for tests. */
const SERVICES = process.env.OASIS_SUPERVISOR_SERVICES ? JSON.parse(process.env.OASIS_SUPERVISOR_SERVICES) : [
  { name: 'engine', label: 'Agent engine', command: 'pnpm dev:engine', port: Number(process.env.OASIS_PORT || 4530), shutdown: `http://127.0.0.1:${Number(process.env.OASIS_PORT || 4530)}/api/cmd` },
  { name: 'world', label: 'Page server', command: 'pnpm dev', port: Number(process.env.OASIS_WEB_PORT || 4516) },
];

const say = (...a) => process.stdout.write(`${new Date().toISOString().slice(0, 19).replace('T', ' ')} ${a.join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(1500, () => { s.destroy(); resolve(false); });
  });
}

function logStream(name) {
  fs.mkdirSync(LOGS, { recursive: true });
  const file = path.join(LOGS, `${name}.log`);
  try { if (fs.statSync(file).size > LOG_MAX) fs.renameSync(file, `${file}.1`); } catch { /* no log yet */ }
  return fs.openSync(file, 'a');
}

/** The pid listening on a port (a server the supervisor did not start), or null. */
function pidOnPort(port) {
  if (WIN) {
    const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }).stdout || '';
    for (const line of out.split(/\r?\n/)) {
      const m = line.trim().split(/\s+/);
      if (m.length >= 5 && /LISTENING/i.test(m[3]) && new RegExp(`:${port}$`).test(m[1])) return Number(m[4]) || null;
    }
    return null;
  }
  const out = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout || '';
  return Number(out.trim().split('\n')[0]) || null;
}

/**
 * The top of a foreign server's process tree on Windows: from the listening process up through its parents while
 * they are node, cmd or pnpm running this Oasis, so ending the tree ends `pnpm dev` and not the console around it.
 */
function treeTop(pid) {
  if (!WIN || !pid) return pid;
  let top = pid;
  for (let i = 0; i < 6; i++) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${top}"; if ($p) { $q = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; if ($q) { "$($q.ProcessId)|$($q.Name)|$($q.CommandLine)" } }`], { encoding: 'utf8', windowsHide: true });
    const [parentPid, name, cmd] = String(r.stdout || '').trim().split('|');
    if (!parentPid || !/^(node|cmd|pnpm)\.exe$/i.test(name || '') || !/pnpm|next|oasis-agent-engine|dev:engine/i.test(cmd || '')) break;
    top = Number(parentPid);
  }
  return top;
}

function killTree(pid) {
  if (!pid) return;
  if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } } }
}

class Service {
  constructor(spec) {
    Object.assign(this, spec);
    this.child = null;
    this.state = 'unknown'; // running | starting | down | stopping | gave-up
    this.managed = false; // started by this supervisor (else: it runs in a window of its own)
    this.since = null;
    this.restarts = 0;
    this.crashes = [];
    this.lastExit = null;
    this.next = 0; // not before this time (backoff)
    this.busy = false;
  }

  view() {
    return { name: this.name, label: this.label, port: this.port, state: this.state, managed: this.managed, pid: this.child?.pid || null, since: this.since, restarts: this.restarts, lastExit: this.lastExit, log: path.join(LOGS, `${this.name}.log`) };
  }

  start(why) {
    const fd = logStream(this.name);
    fs.writeSync(fd, `\n===== ${new Date().toISOString()} starting (${why}) =====\n`);
    const child = spawn(this.command, { cwd: HOME, shell: true, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, OASIS_SUPERVISED: '1' } });
    fs.closeSync(fd);
    this.child = child;
    this.managed = true;
    this.state = 'starting';
    this.since = Date.now();
    say(`${this.name}: started (${why}), pid ${child.pid}`);
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.lastExit = { at: Date.now(), code, signal };
      if (this.state === 'stopping') return;
      // Died by itself: count it, and wait a little longer each time before starting it again.
      const now = Date.now();
      this.crashes = [...this.crashes.filter((t) => now - t < GIVE_UP.withinMs), now];
      this.state = 'down';
      if (this.crashes.length >= GIVE_UP.crashes) {
        this.state = 'gave-up';
        say(`${this.name}: crashed ${this.crashes.length} times in ten minutes; left down (Restart in Settings tries again)`);
        return;
      }
      this.next = now + BACKOFF_MS[Math.min(this.crashes.length - 1, BACKOFF_MS.length - 1)];
      say(`${this.name}: exited (code ${code ?? signal}); starting it again in ${Math.round((this.next - now) / 1000)} s`);
    });
  }

  /** Every CHECK_MS: notice a server that is up (ours or not), and start one that is down when its pause is over. */
  async check() {
    if (this.busy || this.state === 'stopping' || this.state === 'gave-up') return;
    const up = await listening(this.port);
    if (up) {
      if (this.state !== 'running') { this.state = 'running'; this.since = this.since || Date.now(); if (!this.child) this.managed = false; }
      return;
    }
    if (this.child) return; // ours, still starting
    if (this.state === 'running') {
      // It was up in a window of its own and went away: from now on it runs here.
      this.state = 'down';
      this.since = null;
      this.next = Date.now();
      say(`${this.name}: no longer answers on port ${this.port}; starting it here`);
    }
    if (Date.now() >= this.next) this.start(this.restarts || this.crashes.length ? 'it had stopped' : 'not running');
  }

  /** The owner's Restart: stop it (gracefully when it can), then start it here, hidden. */
  async restart() {
    if (this.busy) throw new Error(`${this.label} is already restarting`);
    this.busy = true;
    try {
      this.state = 'stopping';
      say(`${this.name}: restart asked`);
      if (this.shutdown && await listening(this.port)) {
        // The engine says goodbye properly: the roster, the journal, who was mid-turn.
        try { await fetch(this.shutdown, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'shutdown' }), signal: AbortSignal.timeout(5000) }); } catch { /* it may close the socket */ }
        for (let i = 0; i < 40 && await listening(this.port); i++) await sleep(250);
      }
      if (this.child) killTree(this.child.pid);
      else if (await listening(this.port)) killTree(treeTop(pidOnPort(this.port)));
      for (let i = 0; i < 40 && await listening(this.port); i++) await sleep(250);
      if (await listening(this.port)) throw new Error(`${this.label} did not stop (port ${this.port} still answers)`);
      this.child = null;
      this.crashes = [];
      this.restarts += 1;
      this.start('restart asked in Settings');
      return this.view();
    } finally {
      this.busy = false;
    }
  }
}

function readKey() {
  try { return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')).key || null; } catch { return null; }
}

async function main() {
  const services = SERVICES.map((s) => new Service(s));
  const startedAt = Date.now();
  // One per machine: the control port is the lock.
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const host = String(req.headers.host || '').split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(host) || req.headers.origin) return send(403, { error: 'loopback only, not from a browser' });
    if (req.method === 'GET' && req.url === '/status') return send(200, { ok: true, startedAt, pid: process.pid, services: services.map((s) => s.view()) });
    if (req.method === 'POST' && req.url === '/restart') {
      if (!readKey() || req.headers['x-oasis-key'] !== readKey()) return send(403, { error: 'restarts come from the Oasis Settings only' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 10_000) break; }
      let name = null;
      try { name = JSON.parse(body).service; } catch { /* below */ }
      const svc = services.find((s) => s.name === name);
      if (!svc) return send(400, { error: `service: ${services.map((s) => s.name).join(' or ')}` });
      // Answer first: restarting the page server ends the request that asked for it.
      send(202, { ok: true, restarting: svc.name });
      svc.restart().catch((e) => say(`${svc.name}: restart failed: ${e.message}`));
      return undefined;
    }
    return send(404, { error: 'not found' });
  });
  await new Promise((resolve, reject) => {
    server.once('error', (e) => (e.code === 'EADDRINUSE' ? (say(`another supervisor runs on port ${PORT}; leaving`), process.exit(0)) : reject(e)));
    server.listen(PORT, '127.0.0.1', resolve);
  });
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify({ key: randomBytes(24).toString('hex'), port: PORT, pid: process.pid, startedAt: new Date(startedAt).toISOString() }, null, 2));
  say(`supervisor on 127.0.0.1:${PORT}, pid ${process.pid}; logs in ${LOGS}`);
  const tick = async () => { for (const s of services) { try { await s.check(); } catch (e) { say(`${s.name}: check failed: ${e.message}`); } } };
  await tick();
  setInterval(tick, CHECK_MS);
  const leave = () => { say('supervisor leaving (the servers keep running)'); try { fs.rmSync(KEY_FILE, { force: true }); } catch { /* fine */ } process.exit(0); };
  process.on('SIGINT', leave);
  process.on('SIGTERM', leave);
}

if (process.argv[2] === 'status') {
  fetch(`http://127.0.0.1:${PORT}/status`).then((r) => r.json()).then((s) => {
    for (const v of s.services) say(`${v.name.padEnd(7)} ${v.state.padEnd(9)} ${v.managed ? 'hidden, under the supervisor' : 'in its own window'}  restarts ${v.restarts}  log ${v.log}`);
  }).catch(() => { say('no supervisor is running'); process.exitCode = 1; });
} else {
  main().catch((e) => { say(`supervisor failed: ${e.message}`); process.exit(1); });
}
