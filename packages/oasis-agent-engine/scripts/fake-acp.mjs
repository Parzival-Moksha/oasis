// A fake ACP agent for testing src/hermes.js without a model: it speaks the parts of the Agent Client Protocol that
// Hermes Agent 0.15.1 speaks (initialize, session/new, session/load, session/prompt with streamed session/update,
// session/cancel, session/request_permission, set_model, set_mode). Like Hermes, it saves a conversation only when its
// turn ends. Used by scripts/hermes-runtime-smoke.mjs.
//
//   node fake-acp.mjs <dir> [--fail-open]
//
// <dir> keeps sessions.json and prompts.jsonl (every prompt as received, for the test to read). What a prompt does
// depends on its text: SLOW streams 20 ticks over 6 s (stops early on session/cancel); PERMIT asks permission for
// `rm -rf x` and says which option came back; TOOL makes one tool call; WORLD uses the session's HTTP MCP server for
// real (lists its tools, calls get_world_info, tries clear_world); anything else is echoed.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const dir = process.argv[2];
const failOpen = process.argv.includes('--fail-open');
const SESSIONS = path.join(dir, 'sessions.json');
const PROMPTS = path.join(dir, 'prompts.jsonl');
const load = () => { try { return JSON.parse(fs.readFileSync(SESSIONS, 'utf8')); } catch { return {}; } };
const save = (s) => fs.writeFileSync(SESSIONS, JSON.stringify(s, null, 2));
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const update = (sessionId, u) => send({ method: 'session/update', params: { sessionId, update: u } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cancelled = new Set();
const mcpOf = new Map(); // sessionId -> the HTTP MCP servers the client gave (session/new, session/load)

/** A minimal streamable-HTTP MCP client: one session, JSON or SSE answers. */
async function mcpSession(url) {
  let sid = null; let n = 0;
  const rpc = async (method, params, notify = false) => {
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++n, method, params };
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
    sid = res.headers.get('mcp-session-id') || sid;
    if (notify) return null;
    const text = await res.text();
    const json = (res.headers.get('content-type') || '').includes('event-stream') ? JSON.parse(text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('')) : JSON.parse(text);
    return json;
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-acp', version: '0' } });
  await rpc('notifications/initialized', {}, true);
  return rpc;
}
const waiting = new Map(); // our request id -> resolve
let n = 0;
const ask = (method, params) => new Promise((resolve) => { const id = `fake-${++n}`; waiting.set(id, resolve); send({ id, method, params }); });
const state = { models: { availableModels: [{ modelId: 'fake:1', name: 'fake one' }, { modelId: 'fake:2', name: 'fake two' }], currentModelId: 'fake:1' }, modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'accept_edits', name: 'Accept Edits' }] } };

async function prompt(id, { sessionId, prompt: blocks }) {
  const text = (blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  fs.appendFileSync(PROMPTS, JSON.stringify({ sessionId, text, images: (blocks || []).filter((b) => b.type === 'image').length }) + '\n');
  const first = (blocks || []).find((b) => b.type === 'text')?.text || '';
  cancelled.delete(sessionId);
  let reply = '';
  const say = (t) => { reply += t; update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } }); };
  update(sessionId, { sessionUpdate: 'usage_update', size: 65536, used: 1000 });
  if (/SLOW/.test(text)) {
    for (let i = 1; i <= 20; i++) {
      if (cancelled.has(sessionId)) return send({ id, result: { stopReason: 'cancelled' } }); // nothing saved, like Hermes
      say(`tick ${i}\n`);
      await sleep(300);
    }
    say('DONE');
  } else if (/PERMIT/.test(text)) {
    const r = await ask('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 'perm-check-1', title: 'recursive delete: rm -rf x', kind: 'execute', status: 'pending', rawInput: { command: 'rm -rf x', description: 'recursive delete' } },
      options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' }, { optionId: 'allow_session', kind: 'allow_always', name: 'Allow for session' }, { optionId: 'deny', kind: 'reject_once', name: 'Deny' }],
    });
    say(`permission: ${r?.outcome?.optionId || r?.outcome?.outcome || 'none'}`);
  } else if (/WORLD/.test(text)) {
    const server = (mcpOf.get(sessionId) || []).find((m) => m.type === 'http' || m.url);
    if (!server) say('no world tools');
    else {
      try {
        // On "the remote machine" (fake-ssh.mjs) port numbers are shifted: 127.0.0.1:<port> there is <port + shift> here.
        const shift = Number(process.env.FAKE_PORT_SHIFT) || 0;
        const url = shift ? server.url.replace(/:(\d+)\//, (_, p) => `:${Number(p) + shift}/`) : server.url;
        const rpc = await mcpSession(url);
        const list = await rpc('tools/list', {});
        const info = await rpc('tools/call', { name: 'get_world_info', arguments: {} });
        const wipe = await rpc('tools/call', { name: 'clear_world', arguments: {} });
        say(`world tools: ${list.result.tools.map((t) => t.name).join(',')}; world: ${info.result?.content?.[0]?.text}; clear_world refused: ${wipe.result?.isError === true}`);
      } catch (e) { say(`world tools failed: ${e.message}`); }
    }
  } else if (/TOOL/.test(text)) {
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'mcp_oasis_get_world_info', kind: 'other', rawInput: {} });
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'World "Fake"' } }] });
    say('The world is Fake.');
    // Like Hermes 0.23 with reasoning shown: the reasoning and the whole answer again, as one more chunk.
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\n\n💭 **Reasoning:**\n```\n**Looking up the world**\n```\n\nThe world is Fake.' } });
  } else {
    say(`echo: ${first.slice(0, 60)}`);
  }
  update(sessionId, { sessionUpdate: 'usage_update', size: 65536, used: 1200 });
  const s = load();
  (s[sessionId] ||= []).push({ role: 'user', text }, { role: 'agent', text: reply });
  save(s);
  send({ id, result: { stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 10, cachedReadTokens: 0, totalTokens: 110 } } });
}

function onMessage(m) {
  if (m.id != null && !m.method) { waiting.get(m.id)?.(m.result); waiting.delete(m.id); return; }
  const { id, method, params = {} } = m;
  switch (method) {
    case 'initialize': return send({ id, result: { protocolVersion: 1, agentInfo: { name: 'fake-acp', version: '0.0.1' }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } });
    case 'session/new':
      if (failOpen) return send({ id, error: { code: -32603, message: 'Internal error', data: { details: 'Model fake has a context window of 32,768 tokens, which is below the minimum 64,000.' } } });
      { const sessionId = randomUUID(); const s = load(); s[sessionId] = []; save(s); mcpOf.set(sessionId, params.mcpServers || []); fs.appendFileSync(path.join(dir, 'opened.jsonl'), JSON.stringify({ how: 'new', sessionId, cwd: params.cwd, mcpServers: params.mcpServers }) + String.fromCharCode(10)); return send({ id, result: { sessionId, ...state } }); }
    case 'session/load': {
      const s = load();
      if (!s[params.sessionId]) return send({ id, error: { code: -32002, message: 'Resource not found', data: { details: `no session ${params.sessionId}` } } });
      mcpOf.set(params.sessionId, params.mcpServers || []);
      fs.appendFileSync(path.join(dir, 'opened.jsonl'), JSON.stringify({ how: 'load', sessionId: params.sessionId, cwd: params.cwd, mcpServers: params.mcpServers }) + String.fromCharCode(10));
      for (const h of s[params.sessionId]) update(params.sessionId, { sessionUpdate: h.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk', content: { type: 'text', text: h.text } });
      return send({ id, result: state });
    }
    case 'session/prompt': return void prompt(id, params);
    case 'session/cancel': cancelled.add(params.sessionId); return undefined;
    case 'session/set_model': state.models.currentModelId = params.modelId; return send({ id, result: {} });
    case 'session/set_mode': state.modes.currentModeId = params.modeId; return send({ id, result: {} });
    default: if (id != null) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
  return undefined;
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { onMessage(JSON.parse(line)); } catch { /* ignore */ } } }
});
process.stdin.on('end', () => process.exit(0));
