// One tiny turn on an account, to learn whether it takes turns right now. The engine uses it while an account is
// marked out (accounts.js): a reset time we were told is only a forecast. The owner may upgrade the plan, buy extra
// usage, or the limit may lift early; then the account takes turns again long before that time, and nobody would
// know without asking. A refused try costs nothing; a taken one costs a few dozen tokens on haiku.
// scripts/add-account.mjs checks a new token the same way.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnClaude, onLines } from './claude.js';

export const LIMIT_KINDS = new Set(['usage_limit_reached', 'model_requires_usage_credits']);

/** A fresh `claude -p` with this token (null: the CLI login), fed by `send`; resolves with what `onMessage` finishes with, or null. */
export function runClaude(token, send, onMessage, timeoutMs, extra = []) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-probe-'));
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawnClaude(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', ...extra], { cwd, env: { CLAUDE_CODE_OAUTH_TOKEN: token || null, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } });
    } catch {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { proc.stdin.end(); } catch { /* gone */ }
      setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, 1500);
      resolve(value);
    };
    onLines(proc.stdout, (line) => { let m; try { m = JSON.parse(line); } catch { return; } onMessage(m, finish); });
    proc.on('error', () => finish(null));
    proc.on('exit', () => {
      finish(null);
      // Windows holds a running process's folder: clean up once it is gone.
      setTimeout(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* the temp folder stays */ } }, 500);
    });
    setTimeout(() => finish(null), timeoutMs);
    send(proc);
  });
}

/**
 * One tiny turn (haiku, one-word system prompt, no tools, no MCP). ->
 *   { ok: true, refused: false, usage }            the account takes turns now
 *   { ok: true, refused: true, kind, usage }        out of usage (usage.resetsAt: when, if it said)
 *   { ok: false, reason }                           anything else (bad token, network, 529, timeout): no verdict
 * usage: the last rate_limit_event's { rateLimitType, utilization, resetsAt, status } or null.
 */
export function tinyTurn(token, { timeoutMs = 120_000 } = {}) {
  let usage = null;
  let kind = null;
  return runClaude(token, (proc) => proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with the word OK.' }, parent_tool_use_id: null, session_id: '' })}\n`), (m, finish) => {
    if (m.type === 'rate_limit_event' && m.rate_limit_info) usage = { rateLimitType: m.rate_limit_info.rateLimitType, utilization: m.rate_limit_info.utilization, resetsAt: m.rate_limit_info.resetsAt, status: m.rate_limit_info.status };
    const k = m.api_error || m.message?.api_error || null;
    if (LIMIT_KINDS.has(k)) kind = k;
    if (m.type === 'result') {
      if (kind || LIMIT_KINDS.has(m.api_error)) return finish({ ok: true, refused: true, kind: kind || m.api_error, usage });
      if (m.is_error) return finish({ ok: false, reason: String(m.result || m.api_error || 'error').slice(0, 200), usage });
      finish({ ok: true, refused: false, usage });
    }
  }, timeoutMs, ['--model', 'haiku', '--system-prompt', 'Answer in one word.', '--tools', '', '--strict-mcp-config', '--disable-slash-commands']).then((r) => r || { ok: false, reason: 'no answer (timeout or the CLI did not start)' });
}
