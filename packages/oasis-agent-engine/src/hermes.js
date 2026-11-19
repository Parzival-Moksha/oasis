// A Hermes Agent (Nous Research) as an Oasis agent: one long-lived `hermes acp` process, spoken to with the Agent
// Client Protocol (ACP: JSON-RPC 2.0, one message per line on stdin/stdout, the protocol Zed and VS Code use).
// It has the same surface as agent.js (the Claude Code runtime), so the rest of the engine, the page and Telegram
// treat it like any other owned agent. Pick it with `runtime: "hermes"` in spawnAgent or the roster.
//
// Verified against Hermes Agent 0.15.1 (Windows, local checkout in %LOCALAPPDATA%\hermes, 2026-11-18):
// - initialize -> agentInfo {name:"hermes-agent", version}, loadSession, sessionCapabilities {fork, list, resume},
//   promptCapabilities.image. No model call.
// - session/new {cwd, mcpServers} -> sessionId, models {availableModels, currentModelId}, modes {default,
//   accept_edits, dont_ask}. No model call. Then session/update usage_update {size, used}: about 10.5K tokens of
//   system prompt and tools before the first message (21K with every Oasis tool).
// - session/prompt -> streams session/update notifications (agent_thought_chunk, agent_message_chunk, tool_call,
//   tool_call_update, plan, usage_update), then resolves {stopReason, usage {inputTokens, outputTokens, ...}}.
//   One prompt at a time per session, so messages sent during a turn wait here and go out together after it.
// - session/request_permission (Hermes -> us) for dangerous terminal commands and edits in the default mode:
//   options allow_once / allow_session / allow_always / deny / deny_always. Hermes denies by itself after 60 s.
//   MCP tool calls are never asked about, which is why world tools go through worldproxy.js (free tools only).
// - session/cancel (a notification) stops the turn: the prompt resolves with stopReason "cancelled".
// - The model needs at least 64K context (Hermes refuses a smaller model.context_length at session/new).
//
// Where it runs: `remote` {host, hermes?, home?, cwd?, worldPort?} for a Hermes on another machine over SSH (see
// remoteCommand below: keep-alive, no password prompt, world tools through a reverse forward, reconnects); `command`
// (a raw argv array) for anything else; else OASIS_HERMES_BIN; else the Windows installer's venv; else `hermes`.
// `hermesHome` sets HERMES_HOME here (a profile folder or a sandbox); `remote.home` does it on the other machine.
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onLines } from './claude.js';
import { STATUS, clip, clipDeep } from './normalize.js';
import { VOICE_DEFAULT, VOICE_NOTE, VOICE_OFF_NOTE, isVoiceKey, voicePickNote } from './voice.js';
import { outcomeForRoster, restoreOutcome, statusForOutcome } from './outcome.js';
import { RESUME_TEXT, RESUMED_REASON } from './resume.js';
import { normalizeSchedule } from './schedule.js';
import { worldToolsUrl } from './worldtools.js';
import { startWorldGateServer } from './worldproxy.js';
import { registerAttachment } from './files.js';
import { requiredToken } from './token.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VOICE_SCRIPT = path.resolve(HERE, '..', 'scripts', 'voice.mjs').replace(/\\/g, '/');
const PROXY_SCRIPT = path.resolve(HERE, 'worldproxy.js');
/** ACP permission modes Hermes offers, and the Claude Code names the page may send for them. */
const MODES = { default: 'default', manual: 'default', accept_edits: 'accept_edits', acceptEdits: 'accept_edits', dont_ask: 'dont_ask', dontAsk: 'dont_ask' };
/** How long Hermes waits for an answer to a permission request before it denies by itself (approvals.timeout, 60). */
const PERMISSION_MS = 60_000;
/** A slash command (/compact, /reset, /model …) is a prompt of its own: Hermes reads what follows it as its arguments. */
const isCommand = (text) => /^\s*\/[a-z]/i.test(text || '');
/**
 * List prices (USD per million tokens, in / out) of models a Hermes agent here runs on, for a cost estimate per turn:
 * ACP reports tokens, not money. An upper bound (cache discounts are not counted). A model not listed costs 0 (local).
 */
const PRICES = [
  [/deepseek-v4\.1-flash/i, 0.30, 1.20], // OpenRouter, 2026-11-19
];
export function estimateCost(model, usage) {
  const price = PRICES.find(([re]) => re.test(String(model || '')));
  if (!price || !usage) return 0;
  return Number((((usage.inputTokens || 0) * price[1] + (usage.outputTokens || 0) * price[2]) / 1e6).toFixed(6));
}

/** Plain words only in what becomes a remote shell line: a host alias, paths, no quotes, spaces or operators. */
const SAFE_HOST = /^[A-Za-z0-9._@-]{1,128}$/;
const SAFE_PATH = /^[A-Za-z0-9_./~+-]{1,256}$/;
/** An address to reach the host at when its name does not resolve (an IPv4 or IPv6 address, or a plain host name). */
const SAFE_ADDRESS = /^[A-Za-z0-9.:-]{1,64}$/;
/** Reconnect waits after a remote Hermes's line drops with work pending (s); then it waits for the next message. */
const RECONNECT_S = (process.env.OASIS_RECONNECT_S || '5,15,30,60,120,300').split(',').map(Number).filter((n) => n > 0);

/** The roster's `remote` entry, checked. null when absent; throws when it holds something unsafe. */
export function normalizeRemote(r, agentId = '') {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.host !== 'string' || !SAFE_HOST.test(r.host)) throw new Error('remote.host must be an ssh host or alias (letters, digits, . _ @ -)');
  for (const k of ['hermes', 'home', 'cwd']) if (r[k] != null && (typeof r[k] !== 'string' || !SAFE_PATH.test(r[k]))) throw new Error(`remote.${k} must be a plain path`);
  if (r.address != null && r.address !== '' && (typeof r.address !== 'string' || !SAFE_ADDRESS.test(r.address))) throw new Error('remote.address must be an IP address or a host name');
  // The same port on both machines: the engine's gate listens on it here, the Pi reaches it there (ssh -R).
  let worldPort = Number(r.worldPort);
  if (!Number.isInteger(worldPort) || worldPort < 1024 || worldPort > 65535) {
    let h = 0;
    for (const ch of String(agentId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    worldPort = 14516 + (h % 1000);
  }
  return { host: r.host, ...(r.address ? { address: r.address } : {}), ...(r.hermes ? { hermes: r.hermes } : {}), ...(r.home ? { home: r.home } : {}), ...(r.cwd ? { cwd: r.cwd } : {}), worldPort };
}

/** ssh on this machine: OASIS_SSH (a path, or a JSON argv for tests), else Git's ssh on Windows (it resolves .local names; Windows OpenSSH often does not), else `ssh`. */
function sshPrefix() {
  const v = process.env.OASIS_SSH;
  if (v) { try { const a = JSON.parse(v); if (Array.isArray(a) && a.length) return a.map(String); } catch { return [v]; } }
  const git = 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
  return [process.platform === 'win32' && fs.existsSync(git) ? git : 'ssh'];
}

/**
 * The line the other machine runs: start in the home folder, say where that is (OASIS_CWD on stderr, the ACP cwd),
 * then become `hermes acp` (the venv's binary when it is there, else `hermes` on PATH).
 */
export function remoteCommand(remote) {
  // A non-interactive ssh line has a short PATH (/usr/local/bin:/usr/bin:/bin), so absolute launchers first: Hermes
  // 0.22+ keeps its own in <checkout>/.hermes/bin (seen on the Pi, 0.23.2), ~/.local/bin/hermes execs that one, and 0.15's
  // venv launcher runs the old Python.
  const bins = remote.hermes ? [remote.hermes] : ['~/.hermes/hermes-agent/.hermes/bin/hermes', '~/.local/bin/hermes', '~/.hermes/hermes-agent/venv/bin/hermes'];
  return `cd && for H in ${bins.join(' ')} hermes; do [ -x "$H" ] && break; done; ${remote.home ? `export HERMES_HOME=${remote.home}; ` : ''}printf 'OASIS_CWD %s\\n' "$PWD" >&2; exec "$H" acp`;
}

/**
 * When the host's name does not resolve (og.local from this PC, 2026-11-19), remote.address reaches it at an address;
 * the host key is still checked under the name ssh knows it by (its HostName, read with `ssh -G`, no connection).
 */
function addressOptions(remote, prefix) {
  if (!remote.address) return [];
  let alias = remote.host;
  try {
    const out = execFileSync(prefix[0], [...prefix.slice(1), '-G', remote.host], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /^hostname\s+(\S+)/m.exec(out);
    if (m) alias = m[1];
  } catch { /* keep the alias as given */ }
  return ['-o', `HostName=${remote.address}`, '-o', `HostKeyAlias=${alias}`];
}

/**
 * ssh for a remote Hermes. BatchMode: never wait for a password (a key or nothing). ServerAlive 15 s x 3: a dropped
 * network ends the line within about 45 s, so the agent shows it and reconnects. -R: the Pi's 127.0.0.1:<worldPort>
 * leads back to the engine's world gate (free tools only); a taken port there costs the world tools, not the line.
 */
export function sshCommand(remote, { worldTools = true } = {}) {
  const prefix = sshPrefix();
  return [
    ...prefix, ...addressOptions(remote, prefix), '-T', '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=20', '-o', 'ExitOnForwardFailure=no',
    ...(worldTools ? ['-R', `127.0.0.1:${remote.worldPort}:127.0.0.1:${remote.worldPort}`] : []),
    remote.host, remoteCommand(remote),
  ];
}

/**
 * The Hermes home a local Hermes runs in: the profile folder given, else HERMES_HOME, else the Windows installer's
 * (%LOCALAPPDATA%\hermes) or ~/.hermes. It must be an absolute path holding a config.yaml, which a working folder
 * never has: Hermes would otherwise set up a new home wherever it is pointed. -> {ok, path} | {ok:false, error}
 */
export function resolveHermesHome(given, env = process.env) {
  const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const fallback = process.platform === 'win32' ? path.join(local, 'hermes') : path.join(os.homedir(), '.hermes');
  const home = (typeof given === 'string' && given.trim()) || (env.HERMES_HOME || '').trim() || fallback;
  const from = given ? 'the profile folder' : env.HERMES_HOME ? 'HERMES_HOME' : 'the default Hermes home';
  if (!path.isAbsolute(home)) return { ok: false, error: `${from} "${home}" is not a full path: give a Hermes profile folder (one with a config.yaml)` };
  if (!fs.existsSync(path.join(home, 'config.yaml'))) return { ok: false, error: `${from} ${home} is not a Hermes home (no config.yaml): give a Hermes profile folder, e.g. ${path.join(fallback, 'profiles', '<name>')}` };
  return { ok: true, path: home };
}

/** The argv that starts `hermes acp` (see the header). */
export function hermesCommand(spec = {}) {
  if (spec.remote) return sshCommand(spec.remote, { worldTools: spec.worldTools !== false });
  if (Array.isArray(spec.command) && spec.command.length && spec.command.every((s) => typeof s === 'string')) return spec.command;
  if (process.env.OASIS_HERMES_BIN) return [process.env.OASIS_HERMES_BIN, 'acp'];
  // Hermes 0.22+ installs its launcher in <home>\bin (a uv-built Python); 0.15 had it in the checkout's venv.
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = process.platform === 'win32'
    ? [path.join(local, 'hermes', 'bin', 'hermes.exe'), path.join(local, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')]
    : [path.join(os.homedir(), '.hermes', 'bin', 'hermes'), path.join(os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes')];
  const found = candidates.find((p) => fs.existsSync(p));
  return [found || 'hermes', 'acp'];
}

/** Hermes names MCP tools mcp_<server>_<tool>; the Oasis page knows them as mcp__<server>__<tool>. */
/** Hermes 0.15 names them mcp_oasis_<tool>; 0.23 names a server the app hands over mcp__editor_oasis_<hash>__<tool>. */
function toolName(title = '') {
  const head = String(title).split(':')[0].trim();
  const m = /^mcp_oasis_(.+)$/.exec(head) || /^mcp__editor_oasis_[0-9a-f]+__(.+)$/.exec(head);
  return m ? `mcp__oasis__${m[1]}` : head || 'tool';
}

function contentText(content) {
  if (!Array.isArray(content)) return '';
  return content.map((c) => (c?.type === 'content' ? c.content?.text : c?.type === 'diff' ? `diff ${c.path || ''}` : '') || '').filter(Boolean).join('\n');
}

export class HermesAgent {
  /**
   * @param {{id:string,name:string,cwd:string,sessionId?:string,model?:string,permissionMode?:string,worldTools?:boolean,eyes?:boolean,command?:string[],hermesHome?:string}} spec
   * @param {object} hub the engine hub (index.js)
   */
  constructor(spec, hub) {
    this.kind = 'owned';
    this.runtime = 'hermes';
    this.id = spec.id;
    this.name = spec.name;
    this.cwd = spec.cwd;
    this.sessionId = spec.sessionId || null;
    this.model = spec.model || null;
    this.permissionMode = spec.permissionMode || null;
    this.command = Array.isArray(spec.command) ? spec.command : null;
    this.remote = normalizeRemote(spec.remote, spec.id); // a Hermes on another machine, over SSH
    this.remoteCwd = null; // the other machine's home folder, as its shell said (OASIS_CWD)
    this.reconnect = { tries: 0, timer: null };
    this.gate = null; // { port, close } while a remote agent's line is up (worldproxy.js)
    this.hermesHome = typeof spec.hermesHome === 'string' && spec.hermesHome ? spec.hermesHome : null;
    this.worldTools = spec.worldTools !== false;
    this.schedule = normalizeSchedule(spec.schedule);
    this.appointments = Array.isArray(spec.appointments) ? spec.appointments.filter((a) => a && typeof a.id === 'string' && typeof a.at === 'number') : [];
    this.wake = spec.wake && typeof spec.wake === 'object' ? { lastAt: typeof spec.wake.lastAt === 'number' ? spec.wake.lastAt : null, day: typeof spec.wake.day === 'string' ? spec.wake.day : null, count: Number(spec.wake.count) || 0 } : { lastAt: null, day: null, count: 0 };
    this.scheduledPending = null;
    this.scheduledRun = false;
    this.scheduledMixed = false;
    this.eyes = spec.eyes === true; // pictures work over ACP (promptCapabilities.image); off unless asked
    this.chrome = false;
    this.speakSet = spec.speakSet === true;
    this.speak = this.speakSet && typeof spec.speak === 'boolean' ? spec.speak : VOICE_DEFAULT.test(this.name || '');
    this.voiceChoice = isVoiceKey(spec.voiceChoice) ? spec.voiceChoice : null;
    this.voiceOffered = spec.voiceOffered === true;
    this.effort = null;
    this.resolvedEffort = null;
    this.restartPending = false;
    this.hub = hub;
    this.proc = null;
    this.ready = null; // a promise: the session is open (initialize + session/new or session/load)
    this.isReady = false;
    this.status = STATUS.IDLE;
    this.statusReason = 'not started';
    this.lastOutcome = restoreOutcome(spec);
    this.turnOpenAt = null;
    if (this.lastOutcome) {
      const shown = statusForOutcome(this.lastOutcome);
      this.status = shown.status;
      this.statusReason = shown.reason;
    }
    this.rpcN = 0;
    this.calls = new Map(); // our JSON-RPC id -> {resolve, timer}
    this.permissions = new Map(); // requestId -> {rpcId, toolCall, options, ...}
    this.pendingUser = new Map(); // uuid -> {text, sentAt, turnWasRunning, turnIndex}
    this.queue = []; // [{uuid, text, images, picture, scheduled, resume}] waiting for the next turn
    this.turnItems = []; // uuids of the running turn's messages: crossed off the journal when it ends
    this.failReason = null; // why the last start could not open a session (shown after the process is stopped)
    this.sendChain = Promise.resolve();
    this.inFlight = new Set();
    this.turnRunning = false;
    this.turnIndex = 0;
    this.interrupted = false;
    this.resumedAt = null;
    this.stderrTail = [];
    this.meta = {};
    this.models = null;
    this.resolvedModel = null;
    this.effectivePermissionMode = null;
    this.lastContext = null;
    this.killing = false;
    this.replaying = false; // session/load replays the old conversation as session/update notifications
    this.msg = null; // the assistant message being streamed {id, text}
    this.lastText = '';
    this.tools = new Map(); // toolCallId -> name, for tool.end
    this.agentVersion = null;
  }

  emit(kind, payload = {}) { this.hub.emit(this.id, kind, payload); }
  persist() { this.hub.persist(); }

  snapshot() {
    return {
      id: this.id, kind: this.kind, runtime: this.runtime, name: this.name, cwd: this.cwd, sessionId: this.sessionId,
      model: this.model, resolvedModel: this.resolvedModel, permissionMode: this.permissionMode,
      effectivePermissionMode: this.effectivePermissionMode, effort: null, resolvedEffort: null,
      eyes: this.eyes, chrome: false, speak: this.speak, voiceChoice: this.voiceChoice, status: this.status, statusReason: this.statusReason, alive: !!this.proc,
      pid: this.proc?.pid || null, pendingUser: this.pendingUser.size,
      permissions: [...this.permissions.values()].map((r) => this.describePermission(r)),
      context: this.lastContext, models: this.models,
      lastOutcome: this.lastOutcome ? outcomeForRoster(this.lastOutcome) : null,
      resumedAt: this.resumedAt,
      schedule: this.schedule, appointments: this.appointments,
      nextWake: this.hub.nextWake ? this.hub.nextWake(this) : null,
      wakesToday: this.hub.wakesToday ? this.hub.wakesToday(this) : 0,
      scheduledRun: this.scheduledRun && !this.scheduledMixed,
      hermesVersion: this.agentVersion,
      ...(this.remote ? { remote: { host: this.remote.host }, reconnecting: !!this.reconnect.timer } : {}),
    };
  }

  rosterEntry() {
    return {
      id: this.id, runtime: 'hermes', name: this.name, cwd: this.cwd, sessionId: this.sessionId, model: this.model, permissionMode: this.permissionMode,
      eyes: this.eyes, speak: this.speak,
      ...(this.speakSet ? { speakSet: true } : {}), ...(this.voiceChoice ? { voiceChoice: this.voiceChoice } : {}), ...(this.voiceOffered ? { voiceOffered: true } : {}),
      ...(this.worldTools ? {} : { worldTools: false }), ...(this.command ? { command: this.command } : {}), ...(this.remote ? { remote: this.remote } : {}), ...(this.hermesHome ? { hermesHome: this.hermesHome } : {}),
      ...(this.lastOutcome ? { lastOutcome: outcomeForRoster(this.lastOutcome) } : {}), ...(this.turnOpenAt ? { turnOpenAt: this.turnOpenAt } : {}),
      ...(this.proc?.pid ? { pid: this.proc.pid } : {}),
      ...(this.schedule ? { schedule: this.schedule } : {}), ...(this.appointments.length ? { appointments: this.appointments } : {}), ...(this.wake.lastAt || this.wake.count ? { wake: this.wake } : {}),
    };
  }

  isIdle() {
    return !this.turnRunning && !this.pendingUser.size && !this.permissions.size && !this.inFlight.size && !this.queue.length && !this.killing;
  }

  wakeUp(message) { return this.send(message.text, { scheduled: { note: message.note, label: message.label } }); }
  forkPending() { return false; }

  // ------------------------------------------------------------------ process
  start() {
    if (this.proc) return;
    if (!fs.existsSync(this.cwd)) {
      this.setStatus(STATUS.ERROR, `cwd does not exist: ${this.cwd}`);
      this.emit('error', { message: `cwd does not exist: ${this.cwd}` });
      return;
    }
    const [exe, ...args] = hermesCommand(this);
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', OASIS_AGENT_ID: this.id, ...(this.hub.url ? { OASIS_ENGINE_URL: this.hub.url } : {}) };
    for (const key of Object.keys(env)) if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key];
    // A Hermes here only ever runs in a real Hermes home: one with a config.yaml (the profile folder given, else
    // HERMES_HOME, else the installer's home). A folder that is not one (2026-11-19: a working folder typed into
    // the profile field made Hermes set up a fresh home, with a copy of the gh token, in C:\7c_oasis) is refused.
    if (!this.remote && !this.command) {
      const home = resolveHermesHome(this.hermesHome);
      if (!home.ok) {
        this.setStatus(STATUS.ERROR, home.error);
        this.emit('error', { message: home.error });
        return;
      }
      env.HERMES_HOME = home.path;
    }
    this.hub.log(`[${this.name}] spawn ${exe} ${args.join(' ')} (hermes, cwd ${this.cwd}${env.HERMES_HOME && !this.remote ? `, HERMES_HOME ${env.HERMES_HOME}` : ''})`);
    clearTimeout(this.reconnect.timer);
    this.reconnect.timer = null;
    // A remote agent's world gate listens on its fixed port before ssh connects; the Pi only reaches it after
    // session/new, seconds later. The last line's gate is closed first (same port).
    if (this.remote && this.worldTools) {
      const port = this.remote.worldPort;
      this.gateReady = (this.gateClosing || Promise.resolve()).then(() => startWorldGateServer(worldToolsUrl(), { port })).then(
        (g) => { this.gate = g; return g; },
        (e) => { this.hub.log(`[${this.name}] world gate on ${port} did not start (${e.message}): no world tools on this line`); return null; },
      );
    }
    this.remoteCwd = null;
    let cwdSeen;
    this.remoteCwdReady = new Promise((r) => { cwdSeen = r; });
    let proc;
    try {
      proc = spawn(exe, args, { cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    } catch (e) {
      this.setStatus(STATUS.ERROR, `spawn failed: ${e.message}`);
      this.emit('error', { message: `spawn failed: ${e.message}` });
      return;
    }
    this.proc = proc;
    this.killing = false;
    this.isReady = false;
    this.sentSinceStart = false;
    this.youDue = true;
    this.stderrTail = [];
    this.turnRunning = false;
    this.persist();
    onLines(proc.stdout, (line) => this.onLine(line));
    onLines(proc.stderr, (line) => {
      const cwd = /^OASIS_CWD (\/\S*)\s*$/.exec(line);
      if (cwd) { this.remoteCwd = cwd[1]; cwdSeen(cwd[1]); return; }
      if (/remote port forwarding failed/i.test(line)) this.emit('notice', { subtype: 'world', text: `The world tools cannot reach this agent: port ${this.remote?.worldPort} is taken on ${this.remote?.host}.` });
      this.stderrTail.push(line);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
      if (!/\[(INFO|DEBUG)\]/.test(line)) this.hub.log(`[${this.name}] stderr: ${line}`);
    });
    proc.stdin.on('error', () => { /* the process went away; onExit says so */ });
    proc.on('error', (err) => {
      this.emit('error', { message: `spawn failed: ${err.message}` });
      if (this.proc === proc) this.onExit(null, null, err.message);
    });
    proc.on('exit', (code, signal) => { if (this.proc === proc) this.onExit(code, signal); });
    this.recomputeStatus();
    this.ready = this.open(proc).then(() => true, (err) => {
      if (this.proc !== proc || this.killing) return false; // stopped while it opened: not an error
      this.hub.log(`[${this.name}] could not open a Hermes session: ${err.message}`);
      this.emit('error', { message: `Hermes did not open a session: ${err.message}` });
      // A process without a session can never take a message: stop it, keep the reason on the sign (onExit), and
      // the next message starts it again. What was on its way stays in the journal.
      this.failReason = `no session: ${clip(err.message, 160)}`;
      this.kill({ now: true });
      return false;
    });
  }

  /** initialize, then the old session (session/load replays it) or a new one. No model call. */
  async open(proc) {
    const init = await this.call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }, 60000);
    this.agentVersion = init?.agentInfo?.version || null;
    this.canLoad = !!init?.agentCapabilities?.loadSession;
    const mcpServers = await this.worldToolsServers();
    // A remote Hermes works in the other machine's home folder (its shell says which), never in a path from here.
    const cwd = this.remote ? (this.remote.cwd || await Promise.race([this.remoteCwdReady, new Promise((r) => setTimeout(() => r(null), 10000))]) || '.') : this.cwd;
    this.acpCwd = cwd;
    let opened = null;
    if (this.sessionId && this.canLoad) {
      this.replaying = true;
      try {
        opened = await this.call('session/load', { sessionId: this.sessionId, cwd, mcpServers }, 120000);
        this.flushText({ history: true });
        this.emit('notice', { subtype: 'history', text: `resumed Hermes session ${this.sessionId.slice(0, 8)}` });
      } catch (e) {
        this.emit('notice', { subtype: 'history', text: `Hermes could not load session ${this.sessionId.slice(0, 8)} (${clip(e.message, 120)}): a new one starts` });
        this.sessionId = null;
      } finally {
        this.replaying = false;
        this.msg = null;
      }
    }
    if (!opened) {
      opened = await this.call('session/new', { cwd, mcpServers }, 120000);
      this.sessionId = opened?.sessionId || null;
      if (!this.sessionId) throw new Error('session/new returned no sessionId');
    }
    if (proc !== this.proc) return; // stopped meanwhile
    this.readSessionState(opened);
    const mode = this.permissionMode ? MODES[this.permissionMode] : null;
    if (mode && mode !== this.effectivePermissionMode) {
      await this.call('session/set_mode', { sessionId: this.sessionId, modeId: mode }).then(() => { this.effectivePermissionMode = mode; }, (e) => this.hub.log(`[${this.name}] set_mode ${mode} failed: ${e.message}`));
    }
    if (this.model && this.model !== this.resolvedModel) {
      await this.call('session/set_model', { sessionId: this.sessionId, modelId: this.model }).then(() => { this.resolvedModel = this.model; }, (e) => this.hub.log(`[${this.name}] set_model ${this.model} failed: ${e.message}`));
    }
    this.isReady = true;
    this.reconnect.tries = 0;
    this.persist();
    this.emit('init', {
      sessionId: this.sessionId, model: this.resolvedModel, permissionMode: this.effectivePermissionMode, cwd: this.remote ? `${this.remote.host}:${cwd}` : this.cwd,
      tools: [], mcpServers: mcpServers.map((s) => ({ name: s.name, status: 'given' })), agents: [],
      claudeCodeVersion: null, runtime: 'hermes', hermesVersion: this.agentVersion,
    });
    this.emit('meta', { models: this.models, subscription: null, claudeCodeVersion: null, permissionMode: this.effectivePermissionMode, resolvedEffort: null, runtime: 'hermes', hermesVersion: this.agentVersion });
    this.recomputeStatus();
    this.pump();
  }

  /**
   * The Oasis world tools, free tools only (worldproxy.js): here a stdio server Hermes starts; for a remote Hermes the
   * engine's gate, reached at 127.0.0.1:<worldPort> on the other machine through the SSH line. A raw `command` gets none.
   */
  async worldToolsServers() {
    if (!this.worldTools || this.command) return [];
    if (this.remote) {
      const gate = await this.gateReady;
      return gate ? [{ type: 'http', name: 'oasis', url: `http://127.0.0.1:${this.remote.worldPort}/mcp`, headers: [] }] : [];
    }
    // Hermes may not hand its own environment to the servers it starts: the local key (token.js) goes along by name.
    const token = requiredToken();
    return [{ name: 'oasis', command: process.execPath, args: [PROXY_SCRIPT, worldToolsUrl()], env: token ? [{ name: 'OASIS_LOCAL_TOKEN', value: token }] : [] }];
  }

  readSessionState(r) {
    const models = r?.models;
    if (models?.availableModels) {
      this.models = models.availableModels.map((m) => ({ value: m.modelId, resolvedModel: m.modelId, displayName: m.name || m.modelId }));
      this.resolvedModel = models.currentModelId || this.resolvedModel;
    }
    if (r?.modes?.currentModeId) this.effectivePermissionMode = r.modes.currentModeId;
  }

  onExit(code, signal, why) {
    const wasKilling = this.killing;
    this.proc = null;
    this.isReady = false;
    // The open prompt's promise handlers see a different process (pump) and leave the turn alone: a turn cut off by
    // the process ending keeps turnOpenAt, so the next engine start tells the agent to carry on (resume.js).
    for (const [, c] of this.calls) { clearTimeout(c.timer); c.reject(new Error('process exited')); }
    this.calls.clear();
    for (const [id, p] of this.permissions) { clearTimeout(p.timer); this.emit('permission.resolved', { requestId: id, behavior: 'cancelled' }); }
    this.permissions.clear();
    // What Hermes never saved (the queue, and the cut-off turn's messages) stays in the journal for the next start.
    this.queue = [];
    this.pendingUser.clear();
    this.turnItems = [];
    if (this.turnRunning) this.flushText();
    this.turnRunning = false;
    this.scheduledPending = null;
    this.scheduledRun = false;
    this.emit('exit', { code, signal, stderr: wasKilling ? undefined : this.stderrTail.slice(-5) });
    const failed = this.failReason;
    this.failReason = null;
    if (this.gate) { const g = this.gate; this.gate = null; this.gateClosing = g.close().catch(() => {}); }
    if (failed) this.setStatus(STATUS.ERROR, failed);
    else if (wasKilling || code === 0) this.setStatus(STATUS.IDLE, wasKilling ? 'stopped' : 'exited');
    else if (this.remote) this.lineDropped(code);
    else this.setStatus(STATUS.ERROR, why ? `hermes did not start: ${why}` : `hermes exited (code ${code}${signal ? ', ' + signal : ''})`);
  }

  /**
   * A remote agent's line ended by itself (network, the Pi off, ssh refused). With work pending (a cut-off turn or
   * messages in the journal) it tries again after 5 s, 15 s, 30 s, 1, 2 and 5 minutes; a turn cut off is told to carry
   * on, and the messages go out again. Without work it waits for the next message, which starts the line again.
   */
  lineDropped(code) {
    const said = this.stderrTail.filter((l) => !/^OASIS_CWD /.test(l)).slice(-1)[0] || `ssh exit ${code}`;
    const pending = !!this.turnOpenAt || !!this.hub.journal?.queuedFor(this.id).length;
    const n = this.reconnect.tries;
    if (!pending || n >= RECONNECT_S.length) {
      this.setStatus(STATUS.ERROR, `${this.remote.host} not reachable: ${clip(said, 120)}${pending ? ' (gave up; the next message tries again)' : ''}`);
      this.reconnect.tries = 0;
      return;
    }
    const wait = RECONNECT_S[n];
    this.reconnect.tries = n + 1;
    this.setStatus(STATUS.ERROR, `${this.remote.host} not reachable: ${clip(said, 100)}; trying again in ${wait} s (${n + 1}/${RECONNECT_S.length})`);
    this.reconnect.timer = setTimeout(() => {
      this.reconnect.timer = null;
      if (this.proc || this.killing) return;
      const resume = !!this.turnOpenAt;
      this.start();
      if (!this.proc) return;
      const run = this.sendChain.then(() => this.flushLeftovers({ resume }));
      this.sendChain = run.catch(() => {});
    }, wait * 1000);
    this.reconnect.timer.unref?.();
  }

  write(obj) {
    if (!this.proc) throw new Error('agent process not running');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  /** A JSON-RPC request to Hermes. Resolves with the result, rejects with the error. timeoutMs 0: no limit. */
  call(method, params, timeoutMs = 30000) {
    if (!this.proc) return Promise.reject(new Error('not running'));
    const id = ++this.rpcN;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => { this.calls.delete(id); reject(new Error(`${method}: timeout`)); }, timeoutMs) : null;
      this.calls.set(id, { resolve, reject, timer, method });
      try { this.write({ jsonrpc: '2.0', id, method, params }); }
      catch (e) { clearTimeout(timer); this.calls.delete(id); reject(e); }
    });
  }

  notify(method, params) { this.write({ jsonrpc: '2.0', method, params }); }

  // ------------------------------------------------------------------ stdout
  onLine(line) {
    let m;
    try { m = JSON.parse(line); } catch { this.hub.log(`[${this.name}] non-JSON stdout: ${line.slice(0, 200)}`); return; }
    if (m.id != null && !m.method) {
      const c = this.calls.get(m.id);
      if (!c) return;
      clearTimeout(c.timer);
      this.calls.delete(m.id);
      if (m.error) c.reject(new Error(m.error.data?.details || m.error.message || 'error'));
      else c.resolve(m.result);
      return;
    }
    if (m.method === 'session/update') return this.onUpdate(m.params?.update || {});
    if (m.method === 'session/request_permission' && m.id != null) return this.onPermission(m.id, m.params || {});
    // We said we have no file system or terminal for it (initialize): anything else it asks is not handled here.
    if (m.id != null) {
      try { this.write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `the Oasis does not handle ${m.method}` } }); } catch { /* gone */ }
    }
  }

  onUpdate(u) {
    // OASIS_HERMES_TRACE=1: one log line per update (kind, message id, a little text), to see what a Hermes version sends.
    if (process.env.OASIS_HERMES_TRACE === '1') this.hub.log(`[${this.name}] update ${u.sessionUpdate}${u.messageId ? ` msg=${String(u.messageId).slice(0, 8)}` : ''} ${JSON.stringify(u.content?.text ?? u.title ?? u.status ?? '').slice(0, 80)}`);
    const history = this.replaying ? { history: true } : {};
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = u.content?.type === 'text' ? u.content.text : '';
        if (!text) return;
        // Hermes 0.23 with reasoning shown (display.show_reasoning) ends a streamed answer with one more chunk: a
        // "💭 Reasoning" block and the whole answer again (seen with Og, 2026-11-19). A chunk that only repeats what
        // was already streamed is dropped; the reasoning itself came as agent_thought_chunk, which the thread skips.
        const sofar = this.msg?.text.trim();
        if (sofar && sofar.length >= 12 && text.length > sofar.length && text.trimEnd().endsWith(sofar)) return;
        if (!this.msg) this.msg = { id: `hermes-${randomUUID().slice(0, 8)}`, text: '' };
        this.msg.text += text;
        if (!this.replaying) this.emit('text.delta', { messageId: this.msg.id, index: 0, text, parentToolUseId: null });
        return;
      }
      case 'user_message_chunk': {
        // Only during session/load: the old conversation, as it is replayed.
        const text = u.content?.type === 'text' ? u.content.text : '';
        if (!text || !this.replaying) return;
        this.flushText(history);
        this.emit('user', { text, uuid: null, replay: true, ...history });
        return;
      }
      case 'agent_thought_chunk':
        return; // reasoning text: not shown (the Claude runtime shows none either)
      case 'tool_call': {
        this.flushText(history);
        const name = toolName(u.title);
        this.tools.set(u.toolCallId, name);
        this.emit('tool.start', { toolUseId: u.toolCallId, name, input: clipDeep(u.rawInput ?? { title: u.title }), summary: clip(String(u.title || name), 200), parentToolUseId: null, ...history });
        if (u.status === 'completed' || u.status === 'failed') this.endTool(u, history);
        return;
      }
      case 'tool_call_update':
        if (u.status === 'completed' || u.status === 'failed') this.endTool(u, history);
        return;
      case 'plan':
        if (Array.isArray(u.entries)) this.emit('todo', { source: 'plan', todos: u.entries.map((e) => ({ content: e.content, status: e.status, activeForm: e.content })), ...history });
        return;
      case 'usage_update':
        if (typeof u.used === 'number' && typeof u.size === 'number' && u.size > 0) {
          this.lastContext = { usedTokens: u.used, maxTokens: u.size, percent: Math.round((u.used / u.size) * 1000) / 10, model: this.resolvedModel };
          if (!this.replaying) this.emit('context', this.lastContext);
        }
        return;
      case 'current_mode_update':
        if (u.currentModeId) { this.effectivePermissionMode = u.currentModeId; this.emit('mode', { permissionMode: u.currentModeId }); }
        return;
      case 'session_info_update':
        if (u.title) this.emit('meta', { title: u.title });
        return;
      default:
        return; // available_commands_update and anything newer
    }
  }

  endTool(u, history = {}) {
    const name = this.tools.get(u.toolCallId) || toolName(u.title);
    this.tools.delete(u.toolCallId);
    this.emit('tool.end', { toolUseId: u.toolCallId, name, isError: u.status === 'failed', output: clip(contentText(u.content) || (u.rawOutput != null ? JSON.stringify(u.rawOutput) : ''), 2000), ...history });
  }

  /** The streamed assistant text so far becomes one `text` event (before a tool call, and at the end of a turn). */
  flushText(extra = {}) {
    const msg = this.msg;
    this.msg = null;
    if (!msg || !msg.text.trim()) return;
    this.lastText = msg.text;
    this.emit('text', { messageId: msg.id, text: msg.text, parentToolUseId: null, model: this.resolvedModel, ...extra });
  }

  onPermission(rpcId, params) {
    const tc = params.toolCall || {};
    const requestId = `hermes-perm-${rpcId}`;
    const entry = { requestId, rpcId, toolCall: tc, options: Array.isArray(params.options) ? params.options : [], receivedAt: Date.now() };
    // Hermes denies by itself after 60 s and says nothing: the card goes away then too.
    entry.timer = setTimeout(() => {
      if (this.permissions.get(requestId) !== entry) return;
      this.permissions.delete(requestId);
      this.emit('permission.resolved', { requestId, behavior: 'expired', toolName: toolName(tc.title) });
      this.emit('notice', { subtype: 'permission', text: `Hermes denied "${clip(String(tc.title || 'a command'), 120)}" by itself: nobody answered within 60 s.` });
      this.recomputeStatus();
    }, PERMISSION_MS);
    entry.timer.unref?.();
    this.permissions.set(requestId, entry);
    this.emit('permission.request', this.describePermission(entry));
    this.setStatus(STATUS.DECISION, 'permission');
  }

  describePermission(r) {
    const tc = r.toolCall || {};
    const name = toolName(tc.title);
    const always = r.options.find((o) => o.optionId === 'allow_session');
    return {
      requestId: r.requestId, requestKind: 'permission', toolName: name, toolUseId: tc.toolCallId || null,
      input: tc.rawInput ?? { text: contentText(tc.content) }, summary: clip(String(tc.title || name), 300), description: contentText(tc.content) || null,
      suggestions: always ? [{ type: 'hermes', optionId: always.optionId, label: always.name }] : [], blockedPath: null, decisionReason: null,
      expiresAt: r.receivedAt + PERMISSION_MS, // Hermes denies by itself after 60 s
    };
  }

  /** The owner's answer to a permission card. always: "allow for this session" (Hermes's allow_session). */
  respond(requestId, { behavior, always } = {}) {
    const req = this.permissions.get(requestId);
    if (!req) throw new Error(`no pending request ${requestId}`);
    const has = (id) => req.options.some((o) => o.optionId === id);
    const optionId = behavior === 'allow' ? (always && has('allow_session') ? 'allow_session' : 'allow_once') : 'deny';
    this.write({ jsonrpc: '2.0', id: req.rpcId, result: { outcome: { outcome: 'selected', optionId } } });
    clearTimeout(req.timer);
    this.permissions.delete(requestId);
    this.emit('permission.resolved', { requestId, behavior, toolName: toolName(req.toolCall?.title) });
    this.recomputeStatus();
    return { ok: true };
  }

  // ------------------------------------------------------------------ status
  setStatus(status, reason) {
    if (status === this.status && reason === this.statusReason) return;
    this.status = status;
    this.statusReason = reason;
    this.emit('status', { status, reason });
  }

  recomputeStatus() {
    if (!this.proc) return;
    if (this.permissions.size) return this.setStatus(STATUS.DECISION, 'permission');
    if (this.turnRunning) return this.setStatus(STATUS.WORKING, 'turn running');
    if (!this.isReady) return this.setStatus(STATUS.WORKING, 'opening the Hermes session');
    if (this.pendingUser.size) return this.setStatus(STATUS.WORKING, `${this.pendingUser.size} queued message(s)`);
    const o = this.lastOutcome;
    if (!o) return this.setStatus(STATUS.IDLE, 'ready');
    if (o.outcome === 'error') return this.setStatus(STATUS.ERROR, o.reason);
    if (o.outcome === 'needs-decision') return this.setStatus(STATUS.DECISION, o.reason);
    return this.setStatus(STATUS.WAITING, o.reason);
  }

  // ------------------------------------------------------------------ messages
  send(text, { priority, voice, images, source, scheduled } = {}) {
    const pictures = Array.isArray(images) ? images : [];
    if ((!text || !text.trim()) && !pictures.length) return Promise.reject(new Error('empty message'));
    const uuid = randomUUID();
    const kept = pictures.filter((p) => p.path).map((p) => ({ path: p.path, mediaType: p.mediaType, name: p.name }));
    this.hub.journal?.queue(this.id, { uuid, text: text || '', ...(priority ? { priority } : {}), ...(source ? { source } : {}), ...(kept.length ? { images: kept } : {}), ...(scheduled ? { scheduled } : {}) });
    this.inFlight.add(uuid);
    if (scheduled) this.scheduledPending = uuid;
    else if (this.scheduledRun || this.scheduledPending) this.scheduledMixed = true;
    const run = this.sendChain.then(() => this.sendNow(text || '', { uuid, voice, images: pictures, scheduled }));
    this.sendChain = run.then(() => { this.inFlight.delete(uuid); }, () => {
      this.inFlight.delete(uuid);
      if (!this.hub.stopping?.()) this.hub.journal?.done(this.id, uuid);
    });
    return run;
  }

  async sendNow(text, opts = {}) {
    if (!this.proc) {
      this.start();
      if (!this.proc) throw new Error(this.statusReason);
      await this.flushLeftovers();
    }
    return this.deliver(text, opts);
  }

  /** After a start: what the journal still holds for this agent goes out first, oldest first. */
  async flushLeftovers({ resume = false } = {}) {
    const journal = this.hub.journal;
    if (!journal) return { resumed: false, delivered: 0 };
    if (resume && !journal.queuedFor(this.id).some((e) => e.resume)) {
      journal.queue(this.id, { uuid: randomUUID(), text: RESUME_TEXT, resume: true }, { first: true });
    }
    const left = journal.queuedFor(this.id).filter((e) => !this.inFlight.has(e.uuid) && !this.pendingUser.has(e.uuid));
    let resumed = false;
    let delivered = 0;
    for (const e of left) {
      try {
        if (e.scheduled) this.scheduledPending = e.uuid;
        await this.deliver(e.text, { uuid: e.uuid, images: loadPictures(e.images), resume: e.resume === true, scheduled: e.scheduled || null });
        if (e.resume) resumed = true; else delivered += 1;
      } catch (err) {
        this.hub.log(`[${this.name}] a queued message could not go out again (${err.message}); it stays for the next start`);
        break;
      }
    }
    return { resumed, delivered };
  }

  /** Into the queue; it goes to Hermes when the session is open and no turn runs (pump). */
  async deliver(text, { uuid = randomUUID(), voice, images = [], resume = false, scheduled = null } = {}) {
    if (!this.proc) throw new Error(this.statusReason || 'agent process not running');
    let picture = null;
    if (this.eyes && this.hub.eyes && !resume && !scheduled) {
      try { picture = await this.hub.eyes(this.id); } catch { picture = null; }
      if (!this.proc) throw new Error(this.statusReason || 'agent process not running');
    }
    this.sentSinceStart = true;
    const turnWasRunning = this.turnRunning;
    this.pendingUser.set(uuid, { text, sentAt: Date.now(), turnWasRunning, turnIndex: this.turnIndex });
    this.queue.push({ uuid, text, images, picture, resume, scheduled });
    const shown = images.map((p) => ({ fileId: p.fileId, name: p.name, mediaType: p.mediaType }));
    this.emit('user.sent', { uuid, text, midTurn: turnWasRunning, priority: 'next', ...(picture?.data ? { eyes: true } : {}), ...(voice ? { voice } : {}), ...(shown.length ? { images: shown } : {}), ...(resume ? { auto: 'resume' } : {}), ...(scheduled ? { auto: 'schedule', scheduled: scheduled.label || 'scheduled' } : {}) });
    if (resume) {
      this.resumedAt = Date.now();
      this.emit('notice', { subtype: 'resumed', text: 'The engine restarted while this agent was working: it was told to carry on.' });
    }
    if (this.permissions.size) this.recomputeStatus();
    else this.setStatus(STATUS.WORKING, resume ? RESUMED_REASON : scheduled ? 'woke up on its schedule' : turnWasRunning ? 'message queued for the next turn' : 'message sent');
    this.pump();
    return { uuid, midTurn: turnWasRunning };
  }

  /** The prompt for one turn: every queued message, with the engine's notes (voice, who you are) at the end. */
  compose(items) {
    const blocks = [];
    for (const it of items) {
      if (it.scheduled?.note) blocks.push({ type: 'text', text: it.scheduled.note });
      if (it.text) blocks.push({ type: 'text', text: it.text });
      for (const p of it.images || []) if (p.data) blocks.push({ type: 'image', mimeType: p.mediaType, data: p.data });
      if (it.picture?.data) {
        blocks.push({ type: 'image', mimeType: it.picture.mediaType || 'image/jpeg', data: it.picture.data });
        blocks.push({ type: 'text', text: '[Oasis eyes: what your avatar sees from its desk in the village as the owner says this.]' });
      }
    }
    const owner = items.some((it) => !it.resume && !/^\s*\/[a-z]/i.test(it.text || ''));
    if (owner) {
      const voiceNote = this.speak ? VOICE_NOTE : this.speakWentOff ? VOICE_OFF_NOTE : null;
      this.speakWentOff = false;
      if (voiceNote) blocks.push({ type: 'text', text: voiceNote });
      if (this.hub.character) {
        let you = null;
        try { you = this.hub.character(this); } catch { you = null; }
        if (you?.note && (this.youDue || you.stamp !== this.youStamp)) {
          blocks.push({ type: 'text', text: you.note });
          this.youDue = false;
          this.youStamp = you.stamp;
        }
      }
      if (voiceNote === VOICE_NOTE && !this.voiceChoice && !this.voiceOffered) {
        this.voiceOffered = true;
        this.persist();
        blocks.push({ type: 'text', text: voicePickNote(VOICE_SCRIPT) });
      }
    }
    return blocks;
  }

  pump() {
    if (!this.proc || !this.isReady || this.turnRunning || !this.queue.length) return;
    // Everything waiting goes as one prompt, except a slash command, which goes alone.
    const cut = isCommand(this.queue[0].text) ? 1 : this.queue.findIndex((it) => isCommand(it.text));
    const items = this.queue.splice(0, cut > 0 ? cut : this.queue.length);
    const prompt = this.compose(items);
    const proc = this.proc;
    this.turnRunning = true;
    this.turnIndex += 1;
    this.interrupted = false;
    this.lastText = '';
    this.msg = null;
    if (!this.turnOpenAt) this.turnOpenAt = Date.now();
    const startedAt = Date.now();
    // The messages stay in the journal until the turn ends: Hermes saves a conversation only when its turn is over,
    // so a turn cut off by a crash or a restart has to be delivered again.
    this.turnItems = items.map((it) => it.uuid);
    for (const it of items) {
      const p = this.pendingUser.get(it.uuid);
      this.pendingUser.delete(it.uuid);
      if (it.uuid === this.scheduledPending) { this.scheduledPending = null; this.scheduledRun = true; }
      this.emit('user.consumed', { uuid: it.uuid, folded: false, waitedMs: p ? Date.now() - p.sentAt : 0 });
    }
    this.persist();
    this.setStatus(STATUS.WORKING, 'turn started');
    // A turn whose process went away is onExit's (this.proc changed): no turn.end, turnOpenAt kept.
    this.call('session/prompt', { sessionId: this.sessionId, prompt }, 0).then(
      (r) => { if (this.proc === proc) this.endTurn({ stopReason: r?.stopReason || 'end_turn', usage: r?.usage || null, startedAt }); },
      (err) => { if (this.proc === proc) this.endTurn({ error: err.message, startedAt }); },
    );
  }

  endTurn({ stopReason, usage, error, startedAt }) {
    this.flushText();
    for (const uuid of this.turnItems || []) this.hub.journal?.done(this.id, uuid);
    this.turnItems = [];
    for (const [id, p] of this.permissions) { clearTimeout(p.timer); this.emit('permission.resolved', { requestId: id, behavior: 'cancelled' }); }
    this.permissions.clear();
    const interrupted = this.interrupted || stopReason === 'cancelled';
    let outcome;
    if (error && !interrupted) outcome = { outcome: 'error', reason: clip(error, 200) };
    else if (interrupted) outcome = { outcome: 'done-waiting', reason: 'interrupted' };
    else if (/\?\s*(\*\*)?\s*$/.test(this.lastText.replace(/<spoken>[\s\S]*?<\/spoken>\s*$/i, '').trim())) outcome = { outcome: 'needs-decision', reason: 'question-text' };
    else outcome = { outcome: 'done-waiting', reason: stopReason === 'end_turn' ? 'end_turn' : stopReason };
    let ev = {
      subtype: error && !interrupted ? 'error_during_execution' : 'success',
      isError: !!error && !interrupted,
      ...outcome,
      result: clip(this.lastText || error || '', 2000),
      durationMs: Date.now() - startedAt,
      durationApiMs: null,
      numTurns: null,
      usage: usage ? { input: usage.inputTokens ?? null, output: usage.outputTokens ?? null, cacheRead: usage.cachedReadTokens ?? null, cacheCreation: null } : null,
      // ACP reports tokens, not money: an estimate from list prices (PRICES), 0 for a local model.
      costUsd: estimateCost(this.resolvedModel || this.model, usage),
      costEstimated: true,
      totalCostUsd: (this.spentUsd = (this.spentUsd || 0) + estimateCost(this.resolvedModel || this.model, usage)),
      contextTokens: this.lastContext?.usedTokens ?? null,
      contextWindow: this.lastContext?.maxTokens ?? null,
      model: this.resolvedModel,
      permissionDenials: [],
      terminalReason: stopReason || null,
      stopReason: stopReason || null,
      runtime: 'hermes',
    };
    if (this.scheduledRun && !this.scheduledMixed) ev = { ...ev, scheduled: true };
    this.lastOutcome = { ...ev, at: Date.now() };
    this.turnRunning = false;
    this.turnOpenAt = null;
    this.resumedAt = null;
    this.scheduledRun = false;
    this.scheduledMixed = false;
    this.interrupted = false;
    this.emit('turn.end', ev);
    this.persist();
    this.recomputeStatus();
    if (this.queue.length) this.pump();
    else if (this.hub.scheduleCheck) setTimeout(() => this.hub.scheduleCheck(this), 1500).unref?.();
  }

  // ------------------------------------------------------------------ commands
  async interrupt({ cancelQueued = false } = {}) {
    if (!this.proc) return { ok: false, error: 'not running' };
    if (cancelQueued) {
      for (const it of this.queue.splice(0)) {
        const p = this.pendingUser.get(it.uuid);
        this.pendingUser.delete(it.uuid);
        this.hub.journal?.done(this.id, it.uuid);
        this.emit('user.consumed', { uuid: it.uuid, folded: false, waitedMs: p ? Date.now() - p.sentAt : 0, dropped: 'cancelled' });
      }
    }
    if (this.turnRunning) {
      this.interrupted = true;
      try { this.notify('session/cancel', { sessionId: this.sessionId }); } catch (e) { return { ok: false, error: e.message }; }
    }
    this.emit('notice', { subtype: 'interrupt', text: this.turnRunning ? `Interrupt sent${this.queue.length ? `, ${this.queue.length} message(s) still queued` : ''}` : 'Nothing to interrupt' });
    this.recomputeStatus();
    return { ok: true, data: { still_queued: this.queue.map((it) => it.uuid) } };
  }

  async setModel(model) {
    if (!this.proc || !this.isReady) { this.model = model; this.persist(); this.emit('model', { model, applied: 'on next start' }); return { ok: true, data: { model } }; }
    try {
      await this.call('session/set_model', { sessionId: this.sessionId, modelId: model });
    } catch (e) { return { ok: false, error: e.message }; }
    this.model = model;
    this.resolvedModel = model;
    this.persist();
    this.emit('model', { model, resolved: model });
    return { ok: true, data: { model } };
  }

  async setPermissionMode(mode) {
    const modeId = MODES[mode];
    if (!modeId) return { ok: false, error: `Hermes has the modes default, accept_edits and dont_ask (not "${mode}")` };
    if (!this.proc || !this.isReady) { this.permissionMode = modeId; this.persist(); this.emit('mode', { permissionMode: modeId, applied: 'on next start' }); return { ok: true }; }
    try {
      await this.call('session/set_mode', { sessionId: this.sessionId, modeId });
    } catch (e) { return { ok: false, error: e.message }; }
    this.permissionMode = modeId;
    this.effectivePermissionMode = modeId;
    this.persist();
    this.emit('mode', { permissionMode: modeId });
    return { ok: true };
  }

  async setEffort() { return { ok: false, error: 'a Hermes agent has no effort setting' }; }
  setChrome() { return { ok: false, error: 'Claude in Chrome is for Claude Code agents' }; }

  setVoiceChoice(voice) {
    if (voice != null && !isVoiceKey(voice)) return { ok: false, error: `unknown voice "${voice}" (run scripts/voice.mjs list)` };
    this.voiceChoice = voice || null;
    this.voiceOffered = true;
    this.persist();
    this.emit('voice', { voiceChoice: this.voiceChoice });
    return { ok: true, data: { voiceChoice: this.voiceChoice } };
  }

  setSpeak(on) {
    this.speakWentOff = this.speak && !on;
    this.speak = !!on;
    this.speakSet = true;
    this.persist();
    this.emit('speak', { speak: this.speak });
    return { ok: true, data: { speak: this.speak } };
  }

  setEyes(on) {
    this.eyes = !!on;
    this.persist();
    this.emit('eyes', { eyes: this.eyes });
    return { ok: true, data: { eyes: this.eyes } };
  }

  /** The context meter comes with Hermes's usage updates; this only repeats the last one. */
  async refreshContext() {
    if (this.lastContext) this.emit('context', this.lastContext);
    return { ok: true, data: this.lastContext };
  }

  kill({ now = false } = {}) {
    clearTimeout(this.reconnect.timer);
    this.reconnect.timer = null;
    this.reconnect.tries = 0;
    if (!this.proc) { this.setStatus(STATUS.IDLE, 'stopped'); return; }
    this.killing = true;
    const proc = this.proc;
    if (now) { killTree(proc); return; }
    // Closing stdin ends `hermes acp` by itself (seen: exit 0 within a second).
    try { proc.stdin.end(); } catch { /* ignore */ }
    setTimeout(() => { if (this.proc === proc) killTree(proc); }, 3000);
  }
}

/** On Windows the venv's hermes.exe is a launcher with python.exe under it: stop the whole tree. */
function killTree(proc) {
  const plain = () => { try { proc.kill(); } catch { /* gone */ } };
  if (process.platform === 'win32' && proc.pid) {
    try {
      const tk = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      tk.on('error', plain);
      tk.on('exit', (code) => { if (code !== 0 && proc.exitCode === null) plain(); });
      return;
    } catch { /* fall through */ }
  }
  plain();
}

/** Pictures of a journal entry, read back from the files the page's upload left (as agent.js does). */
function loadPictures(images) {
  const out = [];
  for (const p of Array.isArray(images) ? images : []) {
    try {
      const data = fs.readFileSync(p.path).toString('base64');
      out.push({ data, mediaType: p.mediaType, name: p.name, path: p.path, fileId: registerAttachment(p.path, p.mediaType, true) });
    } catch { /* gone */ }
  }
  return out;
}
