// Locate the `claude` CLI and build a clean child environment.
//
// Windows notes (verified on Claude Code 2.1.316):
// - `claude.cmd` (npm global shim) just runs
//   %APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe %*
//   so we resolve that .exe and spawn it directly: no shell, no cmd.exe quoting
//   problems, and kill() hits the real process.
// - When the server itself runs inside a Claude Code session (desktop app,
//   terminal), the parent injects CLAUDECODE=1, CLAUDE_CODE_ENTRYPOINT,
//   CLAUDE_CODE_SESSION_ID, messaging sockets, etc. Those must not leak into the
//   child or it behaves like a nested/child session. We drop every CLAUDE*
//   variable except a small allowlist of user-level configuration.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const KEEP = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_GIT_BASH_PATH',
  'CLAUDE_CODE_OAUTH_TOKEN', // `claude setup-token` users
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  ...(process.env.OASIS_KEEP_ENV || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if ((key === 'CLAUDECODE' || key.startsWith('CLAUDE')) && !KEEP.has(key)) delete env[key];
  }
  // The Oasis runs on the owner's subscription login, never an API key.
  if (!process.env.OASIS_KEEP_API_KEY) {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  return { ...env, ...extra };
}

let cached = null;

/** @returns {{command: string, prefixArgs: string[], how: string}} */
export function resolveClaude() {
  if (cached) return cached;
  if (process.env.OASIS_CLAUDE_BIN) {
    const bin = process.env.OASIS_CLAUDE_BIN;
    cached = bin.endsWith('.js')
      ? { command: process.execPath, prefixArgs: [bin], how: 'OASIS_CLAUDE_BIN (node script)' }
      : { command: bin, prefixArgs: [], how: 'OASIS_CLAUDE_BIN' };
    return cached;
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  if (process.platform === 'win32') {
    // Native installer: a real claude.exe on PATH.
    for (const d of dirs) {
      const exe = path.join(d, 'claude.exe');
      if (fs.existsSync(exe)) return (cached = { command: exe, prefixArgs: [], how: 'claude.exe on PATH' });
    }
    // npm global install: parse claude.cmd for the target it launches.
    for (const d of dirs) {
      const cmd = path.join(d, 'claude.cmd');
      if (!fs.existsSync(cmd)) continue;
      const text = fs.readFileSync(cmd, 'utf8');
      const m = text.match(/"%dp0%\\([^"]+?\.(exe|js|cjs|mjs))"/i);
      if (m) {
        const target = path.join(d, m[1]);
        if (fs.existsSync(target)) {
          cached = /\.exe$/i.test(target)
            ? { command: target, prefixArgs: [], how: `resolved from ${cmd}` }
            : { command: process.execPath, prefixArgs: [target], how: `node + script resolved from ${cmd}` };
          return cached;
        }
      }
      // Fallback: let cmd.exe run the shim (quoting is fragile, kill() hits cmd.exe).
      return (cached = { command: cmd, prefixArgs: [], how: 'claude.cmd via shell', shell: true });
    }
  }
  return (cached = { command: 'claude', prefixArgs: [], how: 'claude on PATH' });
}

/**
 * Spawn `claude` with stdio pipes.
 * @param {string[]} args
 * @param {{cwd: string, env?: Record<string,string>}} opts
 */
export function spawnClaude(args, { cwd, env = {} }) {
  const r = resolveClaude();
  return spawn(r.command, [...r.prefixArgs, ...args], {
    cwd,
    env: cleanEnv(env),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: !!r.shell,
  });
}

/** Line splitter for NDJSON streams. */
export function onLines(stream, cb) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.trim()) cb(line);
    }
  });
  stream.on('end', () => {
    if (buf.trim()) cb(buf);
    buf = '';
  });
}
