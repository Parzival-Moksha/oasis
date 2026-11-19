// Adds a Claude account for the village's agents (src/accounts.js): asks for a label and the token that
// `claude setup-token` printed, checks it with one tiny turn on that account (no system prompt, no tools: a few dozen
// tokens; the free checks don't tell a wrong token from a right one), asks whether it is the account the CLI itself is
// logged in to, and writes data/claude-accounts.local.json (outside git). The token is never shown, logged or sent anywhere else;
// the engine hands it to the agents' `claude` processes in their environment only. Run it in your own terminal,
// not through an agent: an agent's thread would keep what you paste.
//
//   node add-account.mjs                 add one (asks for the label, then the token, typed invisibly)
//   node add-account.mjs list            the accounts in the file (no tokens)
//   node add-account.mjs remove <id>     take one out
//   OASIS_ACCOUNTS=<file>                another accounts file (tests)
//
// The engine reads the file again within 15 s; no restart is needed for a new account.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawnClaude, onLines } from '../src/claude.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const FILE = process.env.OASIS_ACCOUNTS || path.join(ROOT, 'data', 'claude-accounts.local.json');

const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { accounts: [] }; } };
function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

// One reader for the whole run: a second one on piped input would lose the lines the first had buffered.
let reader = null;
const pending = [];
const waiting = [];
function nextLine() {
  if (!reader) {
    reader = readline.createInterface({ input: process.stdin, terminal: false });
    reader.on('line', (line) => { const w = waiting.shift(); if (w) w(line); else pending.push(line); });
    reader.on('close', () => { for (const w of waiting.splice(0)) w(''); });
  }
  return pending.length ? Promise.resolve(pending.shift()) : new Promise((resolve) => waiting.push(resolve));
}

async function ask(question) {
  process.stdout.write(question);
  const answer = (await nextLine()).trim();
  if (!process.stdin.isTTY) process.stdout.write('\n');
  return answer;
}

function closeReader() { reader?.close(); }

/** Read a line without echoing it (a terminal); from a pipe, the line as it comes. */
function askHidden(question) {
  if (!process.stdin.isTTY) return ask(question);
  closeReader(); // raw mode reads the keys itself
  reader = null;
  return new Promise((resolve) => {
    process.stdout.write(question);
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write(`\n(${value.length} characters)\n`);
          resolve(value.trim());
          return;
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); } // Ctrl+C
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

/** The CLI login's email (free: get_status reads it from the CLI's own login). */
function cliEmail() {
  return controlOnce(null, 'get_status').then((r) => {
    for (const section of r?.sections || []) for (const row of section.rows || []) if (row.label === 'Email') return String(row.value);
    return null;
  });
}

/** One control request to a fresh `claude -p` (with this token, or the CLI login): its answer, or null. */
function controlOnce(token, subtype) {
  return runClaude(token, (proc) => proc.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'q', request: { subtype } })}\n`), (m, finish) => {
    if (m.type === 'control_response') finish(m.response?.subtype === 'success' ? m.response.response : null);
  }, 45_000);
}

/**
 * The real check: one tiny turn on this token (no system prompt, no tools, a two-word answer: a few dozen tokens on
 * that account). -> { ok, refused, reason, usage: { window, utilization, resetsAt } }
 */
function tinyTurn(token) {
  let usage = null;
  return runClaude(token, (proc) => proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with the word OK.' }, parent_tool_use_id: null, session_id: '' })}\n`), (m, finish) => {
    if (m.type === 'rate_limit_event') usage = { window: m.rate_limit_info?.rateLimitType, utilization: m.rate_limit_info?.utilization, resetsAt: m.rate_limit_info?.resetsAt, status: m.rate_limit_info?.status };
    if (m.type === 'result') {
      const refused = m.api_error === 'usage_limit_reached' || m.api_error === 'model_requires_usage_credits';
      finish({ ok: !m.is_error || refused, refused, reason: m.is_error ? String(m.result || m.api_error || 'error').slice(0, 200) : null, usage });
    }
  }, 120_000, ['--model', 'haiku', '--system-prompt', 'Answer in one word.', '--tools', '', '--strict-mcp-config', '--disable-slash-commands']);
}

function runClaude(token, send, onMessage, timeoutMs, extra = []) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-add-account-'));
  return new Promise((resolve) => {
    const proc = spawnClaude(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', ...extra], { cwd, env: { CLAUDE_CODE_OAUTH_TOKEN: token || null, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { proc.stdin.end(); } catch { /* gone */ }
      setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, 1500);
      resolve(value);
    };
    onLines(proc.stdout, (line) => { let m; try { m = JSON.parse(line); } catch { return; } onMessage(m, finish); });
    proc.on('exit', () => {
      finish(null);
      // Windows holds a running process's folder: clean up once it is gone, and never fail over it.
      setTimeout(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* the temp folder stays */ } }, 500);
    });
    setTimeout(() => finish(null), timeoutMs);
    send(proc);
  });
}

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

const [action, id] = process.argv.slice(2);
try {
  if (action === 'list') {
    const list = read().accounts || [];
    if (!list.length) console.log(`No accounts in ${FILE}: agents run on the CLI's own login.`);
    for (const a of list) console.log(`${a.id.padEnd(12)} ${String(a.label || '').padEnd(22)} ${a.email || '?'} · ${a.plan || '?'} · priority ${a.priority ?? 100}`);
  } else if (action === 'remove') {
    if (!id) throw new Error('which one? node add-account.mjs remove <id> (see: list)');
    const data = read();
    const before = (data.accounts || []).length;
    data.accounts = (data.accounts || []).filter((a) => a.id !== id);
    if (data.accounts.length === before) throw new Error(`no account "${id}"`);
    write(data);
    console.log(`Removed "${id}". Agents on it move to another account before their next turn.`);
  } else if (!action) {
    console.log('A Claude account for the village. Make its token first: sign in to claude.ai with that account in your browser,');
    console.log('then run `claude setup-token` in PowerShell and copy what it prints. Nothing you type here is shown or logged.\n');
    const label = (await ask('A name for it (for example "Yahoo Max"): ')) || 'Claude account';
    const token = await askHidden('Paste the token, then Enter: ');
    if (!token || /\s/.test(token) || token.length < 20) throw new Error('that does not look like a token (no spaces, and long)');
    if (!/^sk-ant-/.test(token)) console.log('(It does not start with sk-ant-: trying it anyway.)');
    const before = await cliEmail();
    console.log('Checking it with one tiny turn on that account (a few dozen tokens)...');
    const check = await tinyTurn(token);
    if (!check) throw new Error('the CLI gave no answer with this token in two minutes; nothing was written');
    if (!check.ok) throw new Error(`the token did not work: ${check.reason}. Nothing was written; copy the whole token and try again`);
    const u = check.usage;
    const usage = u && typeof u.utilization === 'number' ? `${Math.round(u.utilization * 100)}% of its ${u.window === 'seven_day' ? 'week' : u.window || 'window'} used` : 'its usage will show once an agent runs on it';
    console.log(check.refused ? `It works, and that account is out of usage right now (${check.reason}). Added anyway: it is used once it resets.` : `It works: ${usage}.`);
    const same = before ? /^y/i.test(await ask(`Is this the account the CLI itself is logged in to (${before})? y/N: `)) : false;
    const data = read();
    const list = Array.isArray(data.accounts) ? data.accounts : [];
    let accountId = slug(label) || `account-${list.length + 1}`;
    if (accountId === 'cli') accountId = 'cli-token';
    const existing = list.find((a) => a.id === accountId);
    const entry = { id: accountId, label, token, priority: existing?.priority ?? list.length + 1, ...(same ? { email: before } : {}), addedAt: new Date().toISOString() };
    data.accounts = existing ? list.map((a) => (a === existing ? entry : a)) : [...list, entry];
    write(data);
    const after = await cliEmail();
    console.log(`${existing ? 'Replaced' : 'Added'} "${label}" (id ${accountId})${same ? `, the same account as the CLI login: the engine counts them as one` : ''}.`);
    if (before && after && before !== after) console.log(`Note: the CLI's own login changed while checking (${before} -> ${after}). Tell Citizens.`);
    else if (before) console.log(`The CLI's own login is unchanged (${before}).`);
    console.log(`Written to ${FILE}. The engine takes it within 15 s.`);
  } else {
    console.log('usage: node add-account.mjs | list | remove <id>');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`add-account: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeReader();
}
