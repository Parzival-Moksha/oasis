// A fake `claude -p --input-format stream-json` for tests of account failover (scripts/accounts-smoke.mjs). Never
// spends a real account: it answers every turn itself, and refuses with the real usage-limit shape (as found in the
// transcripts and the CLI 2.1.323 schema, docs/missions/account-failover.md) when its account is marked out.
//
//   OASIS_CLAUDE_BIN=<this file>   the engine runs it with node instead of claude.exe
//   FAKE_CLAUDE_STATE=<json file>  { out: { <account>: { resetsAt (s), window } }, overload: { <account>: true },
//                                    weekly: { <account>: resetsAt (s) } }   read at every turn
//   FAKE_CLAUDE_LOG=<jsonl file>   one line per start and per turn: { pid, account, session, resume, text }
// The account is the token in CLAUDE_CODE_OAUTH_TOKEN ("tok-a" -> "a"), or "cli" without one.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const session = arg('--resume') || arg('--session-id') || randomUUID();
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN || '';
const account = token ? token.replace(/^tok-/, '') : 'cli';
const model = arg('--model') || 'fake-model';
const log = (entry) => { if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ at: Date.now(), pid: process.pid, account, session, ...entry })}\n`); };
const state = () => { try { return JSON.parse(fs.readFileSync(process.env.FAKE_CLAUDE_STATE, 'utf8')); } catch { return {}; } };
const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

log({ start: true, resume: args.includes('--resume'), tokenSet: Boolean(token), model, noTools: args.includes('--strict-mcp-config') && arg('--tools') === '' });

function turn(user) {
  const s = state();
  const text = typeof user.message?.content === 'string' ? user.message.content
    : (user.message?.content || []).filter((b) => b.type === 'text' && !/^\[Oasis /.test(b.text)).map((b) => b.text).join(' ');
  out({ type: 'system', subtype: 'init', session_id: session, model, permissionMode: 'bypassPermissions', cwd: process.cwd(), tools: [], mcp_servers: [], apiKeySource: 'none' });
  out({ type: 'user', isReplay: true, uuid: user.uuid, session_id: session, message: user.message });
  const limit = s.out?.[account];
  const weekly = s.weekly?.[account];
  // The engine's notes ride as their own text blocks ([Oasis you: …], [Oasis account: …]): their first words, for tests.
  const notes = typeof user.message?.content === 'string' ? [] : (user.message?.content || []).filter((b) => b.type === 'text' && /^\[Oasis /.test(b.text)).map((b) => b.text.slice(0, 80));
  log({ turn: true, text: text.slice(0, 200), notes, refused: Boolean(limit), overloaded: Boolean(s.overload?.[account]) });
  if (limit) {
    // What the CLI sends when the account is out (the rate_limit_event first, then the error message and the result).
    const said = `You've hit your ${limit.window === 'seven_day' ? 'weekly' : '5-hour'} limit · resets 1:20pm (Europe/Budapest)`;
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: limit.resetsAt, rateLimitType: limit.window || 'five_hour', overageStatus: 'rejected', isUsingOverage: false }, uuid: randomUUID(), session_id: session });
    out({ type: 'assistant', message: { id: `msg_${randomUUID()}`, model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: said }], stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0 } }, parent_tool_use_id: null, session_id: session, uuid: randomUUID(), error: 'rate_limit', is_api_error_message: true, api_error_status: 429, api_error: limit.kind || 'usage_limit_reached' });
    out({ type: 'result', subtype: 'success', is_error: true, result: said, api_error_status: 429, api_error: limit.kind || 'usage_limit_reached', num_turns: 1, duration_ms: 5, duration_api_ms: 0, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, modelUsage: {}, permission_denials: [], session_id: session, uuid: randomUUID() });
    return;
  }
  if (s.overload?.[account]) {
    const said = 'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.';
    out({ type: 'assistant', message: { id: `msg_${randomUUID()}`, model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: said }], stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0 } }, parent_tool_use_id: null, session_id: session, uuid: randomUUID(), error: 'server_error', is_api_error_message: true, api_error_status: 529 });
    out({ type: 'result', subtype: 'success', is_error: true, result: said, api_error_status: 529, num_turns: 1, duration_ms: 5, duration_api_ms: 0, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, modelUsage: {}, permission_denials: [], session_id: session, uuid: randomUUID() });
    return;
  }
  // As the CLI sends it (2.1.323, seen on a real account on 19 Nov): no top-level utilization; every window's figure in unifiedWindows.
  const weekReset = weekly || Math.floor(Date.now() / 1000) + 5 * 86400;
  const fiveReset = Math.floor(Date.now() / 1000) + 3 * 3600;
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: fiveReset, rateLimitType: 'five_hour', overageStatus: 'rejected', isUsingOverage: false, unifiedWindows: { five_hour: { utilization: account === 'a' ? 0.7 : 0.3, resetsAt: fiveReset, status: 'allowed' }, seven_day: { utilization: account === 'a' ? 0.42 : 0.17, resetsAt: weekReset, status: 'allowed' } } }, uuid: randomUUID(), session_id: session });
  const reply = `ok from ${account}: ${text.slice(0, 120)}`;
  out({ type: 'assistant', message: { id: `msg_${randomUUID()}`, model, role: 'assistant', content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }, parent_tool_use_id: null, session_id: session, uuid: randomUUID() });
  out({ type: 'result', subtype: 'success', is_error: false, result: reply, num_turns: 1, duration_ms: 20, duration_api_ms: 10, total_cost_usd: 0.0001, usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: { [model]: { contextWindow: 200000 } }, permission_denials: [], session_id: session, uuid: randomUUID() });
}

function control(req) {
  const ok = (response = {}) => out({ type: 'control_response', response: { subtype: 'success', request_id: req.request_id, response } });
  const sub = req.request?.subtype;
  if (sub === 'initialize') return ok({ models: [{ value: 'haiku', resolvedModel: 'fake-haiku', displayName: 'Haiku' }], account: { email: `${account}@fake.test`, subscriptionType: account === 'b' ? 'Claude Max' : 'Claude Ultra', organization: 'fake' }, current_permission_mode: 'bypassPermissions', claude_code_version: 'fake' });
  if (sub === 'get_settings') return ok({ applied: { effort: null } });
  if (sub === 'get_context_usage') return ok({ totalTokens: 100, maxTokens: 200000, percentage: 0, model });
  return ok({});
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type === 'control_request') control(msg);
    else if (msg.type === 'user') turn(msg);
  }
});
process.stdin.on('end', () => { log({ exit: true }); process.exit(0); });
