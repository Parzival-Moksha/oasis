import 'server-only'

import { spawn } from 'child_process'

import { readStoredHermesTunnelConfig } from '@/lib/hermes-tunnel'

export interface HermesNativeSessionSummary {
  id: string
  title: string | null
  preview: string
  source: string
  model: string | null
  startedAt: number | null
  lastActiveAt: number | null
  messageCount: number
}

export interface HermesNativeSessionDetail {
  session: HermesNativeSessionSummary
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    reasoning?: string
    tools?: Array<{
      index: number
      id?: string
      name: string
      arguments: string
      resultOk?: boolean
      resultMessage?: string
      resultDetail?: string
      mediaPaths?: string[]
    }>
    finishReason?: string
    timestamp: number
  }>
}

export interface HermesNativeChatResult {
  content: string
  sessionId: string
  rawStdout: string
}

type RemoteExecResult = {
  code: number | null
  stdout: string
  stderr: string
}

export type SpawnableCommand = {
  executable: string
  args: string[]
}

const SSH_FLAGS_WITH_VALUE = new Set([
  '-b',
  '-c',
  '-D',
  '-E',
  '-e',
  '-F',
  '-I',
  '-i',
  '-J',
  '-L',
  '-l',
  '-m',
  '-O',
  '-o',
  '-p',
  '-Q',
  '-R',
  '-S',
  '-W',
  '-w',
])

const STRIP_TUNNEL_FLAGS = new Set(['-L', '-R', '-D'])
const STRIP_TUNNEL_FLAGS_NO_VALUE = new Set(['-N', '-f', '-n'])

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function tokenizeCommand(raw: string): string[] {
  const matches = raw.match(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g) || []
  return matches.map(token => {
    const trimmed = token.trim()
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  })
}

function buildHermesSshExec(command: string, remoteArgs: string[]): SpawnableCommand {
  const tokens = tokenizeCommand(command)
  if (tokens.length === 0) {
    throw new Error('SSH tunnel command is empty.')
  }

  const executable = tokens[0]?.toLowerCase()
  if (executable !== 'ssh') {
    throw new Error('Native Hermes sessions require a raw ssh tunnel command.')
  }

  const args: string[] = []
  let destination = ''
  let expectValueForKeptFlag = false
  let expectValueForStrippedFlag = false

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue

    if (expectValueForStrippedFlag) {
      expectValueForStrippedFlag = false
      continue
    }

    if (expectValueForKeptFlag) {
      args.push(token)
      expectValueForKeptFlag = false
      continue
    }

    if (STRIP_TUNNEL_FLAGS_NO_VALUE.has(token)) {
      continue
    }

    if (STRIP_TUNNEL_FLAGS.has(token)) {
      expectValueForStrippedFlag = true
      continue
    }

    if (
      (token.startsWith('-L') || token.startsWith('-R') || token.startsWith('-D')) &&
      token.length > 2
    ) {
      continue
    }

    if (SSH_FLAGS_WITH_VALUE.has(token)) {
      args.push(token)
      expectValueForKeptFlag = true
      continue
    }

    if (token.startsWith('-')) {
      args.push(token)
      continue
    }

    if (!destination) {
      destination = token
      continue
    }

    throw new Error('SSH tunnel command contains extra remote shell arguments. Save a plain ssh tunnel command instead.')
  }

  if (!destination) {
    throw new Error('Unable to determine the SSH destination from the saved tunnel command.')
  }

  return {
    executable: tokens[0],
    args: [...args, destination, ...remoteArgs],
  }
}

export async function buildHermesRemoteExec(remoteArgs: string[]): Promise<SpawnableCommand> {
  const stored = await readStoredHermesTunnelConfig()
  const tunnelCommand = sanitizeString(stored?.command)
  if (!tunnelCommand) {
    throw new Error('Save an SSH tunnel command first to enable native Hermes sessions.')
  }

  return buildHermesSshExec(tunnelCommand, remoteArgs)
}

export async function ensureHermesRemoteOasisMcpUrl(url: string): Promise<void> {
  const desiredUrl = sanitizeString(url)
  if (!desiredUrl) return

  const script = `
from pathlib import Path
import json
import yaml

path = Path.home() / '.hermes' / 'config.yaml'
desired_url = ${JSON.stringify(desiredUrl)}

data = {}
if path.exists():
  try:
    loaded = yaml.safe_load(path.read_text('utf-8')) or {}
    if isinstance(loaded, dict):
      data = loaded
  except Exception:
    data = {}

mcp_servers = data.get('mcp_servers')
if not isinstance(mcp_servers, dict):
  mcp_servers = {}

oasis = mcp_servers.get('oasis')
if not isinstance(oasis, dict):
  oasis = {}

current_url = str(oasis.get('url') or '').strip()
if current_url != desired_url:
  oasis['url'] = desired_url
  mcp_servers['oasis'] = oasis
  data['mcp_servers'] = mcp_servers
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), 'utf-8')

print(json.dumps({'ok': True, 'currentUrl': current_url, 'desiredUrl': desired_url}))
`

  const result = await runHermesRemotePython(script, 120000)
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Unable to update Hermes Oasis MCP config.')
  }

  const parsed = JSON.parse(result.stdout || '{}') as { ok?: boolean }
  if (!parsed.ok) {
    throw new Error('Hermes Oasis MCP config update failed.')
  }
}

async function runHermesRemotePython(script: string, timeoutMs: number = 120000): Promise<RemoteExecResult> {
  const exec = await buildHermesRemoteExec(['python3', '-'])

  return await new Promise<RemoteExecResult>((resolve, reject) => {
    const child = spawn(exec.executable, exec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let finished = false

    const finish = (result: RemoteExecResult) => {
      if (finished) return
      finished = true
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Remote Hermes command timed out.'))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', code => {
      clearTimeout(timer)
      finish({ code, stdout, stderr })
    })

    child.stdin.write(script)
    child.stdin.end()
  })
}

function buildListSessionsScript(source: string, limit: number): string {
  return `
from pathlib import Path
import json
import re
import sqlite3

home = Path.home()
state_db = home / '.hermes' / 'state.db'
con = sqlite3.connect(state_db)
con.row_factory = sqlite3.Row
source_filter = ${JSON.stringify(source)}
limit = ${JSON.stringify(limit)}

sql = """
select
  s.id,
  s.source,
  s.model,
  s.title,
  s.started_at,
  s.message_count,
  coalesce((select max(m.timestamp) from messages m where m.session_id = s.id), s.started_at) as last_active_at,
  coalesce((
    select m.content
    from messages m
    where m.session_id = s.id
      and m.role in ('user', 'assistant')
      and m.content is not null
      and trim(m.content) != ''
    order by m.timestamp desc, m.id desc
    limit 1
  ), '') as preview
from sessions s
"""

params = []
if source_filter:
  sql += " where s.source = ?"
  params.append(source_filter)

sql += " order by last_active_at desc limit ?"
params.append(limit)

rows = []
for row in con.execute(sql, params):
  preview = re.sub(r'\\s+', ' ', row['preview'] or '').strip()
  rows.append({
    'id': row['id'],
    'source': row['source'] or '',
    'model': row['model'],
    'title': row['title'],
    'preview': preview[:160],
    'startedAt': row['started_at'],
    'lastActiveAt': row['last_active_at'],
    'messageCount': int(row['message_count'] or 0),
  })

print(json.dumps({
  'available': True,
  'sessions': rows,
}))
`
}

function buildReadSessionScript(sessionId: string): string {
  return `
from pathlib import Path
import json
import re
import sqlite3
import sys

session_id = ${JSON.stringify(sessionId)}
home = Path.home()
state_db = home / '.hermes' / 'state.db'
con = sqlite3.connect(state_db)
con.row_factory = sqlite3.Row

session = con.execute("""
select
  s.id,
  s.source,
  s.model,
  s.title,
  s.started_at,
  s.message_count,
  coalesce((select max(m.timestamp) from messages m where m.session_id = s.id), s.started_at) as last_active_at,
  coalesce((
    select m.content
    from messages m
    where m.session_id = s.id
      and m.role in ('user', 'assistant')
      and m.content is not null
      and trim(m.content) != ''
    order by m.timestamp desc, m.id desc
    limit 1
  ), '') as preview
from sessions s
where s.id = ?
""", (session_id,)).fetchone()

if session is None:
  print(json.dumps({'error': 'Session not found'}))
  sys.exit(1)

messages = []
active_assistant = None
active_tool_index = 0

def append_media_lines(content, media_paths):
  next_content = content or ''
  existing_lines = set((next_content or '').splitlines())
  for path in media_paths:
    if not isinstance(path, str):
      continue
    cleaned = path.strip()
    if not cleaned:
      continue
    media_line = f"MEDIA:{cleaned}"
    if media_line in existing_lines:
      continue
    next_content = f"{next_content}\\n{media_line}".strip() if next_content else media_line
    existing_lines.add(media_line)
  return next_content

def maybe_parse_json_string(value):
  if not isinstance(value, str):
    return value
  stripped = value.strip()
  if not stripped or stripped[0] not in '{[':
    return value
  try:
    return json.loads(stripped)
  except Exception:
    return value

def collect_media_paths(value, results):
  if isinstance(value, dict):
    for key, item in value.items():
      lowered = str(key).lower()
      if lowered in ('url', 'filepath', 'primarycaptureurl', 'primarycapturepath', 'image_url', 'imageurl', 'audio_url', 'audiourl', 'video_url', 'videourl'):
        if isinstance(item, str) and item.strip():
          results.append(item.strip())
          continue
      collect_media_paths(item, results)
    return
  if isinstance(value, list):
    for item in value:
      collect_media_paths(item, results)

def parse_tool_result(content):
  text = content or ''
  detail = text
  message = ''
  ok = None
  media_paths = []

  parsed = None
  try:
    parsed = json.loads(text)
  except Exception:
    parsed = None

  if isinstance(parsed, dict):
    structured = parsed.get('structuredContent') if isinstance(parsed.get('structuredContent'), dict) else None
    nested_result = maybe_parse_json_string(parsed.get('result'))
    nested_error = maybe_parse_json_string(parsed.get('error'))

    if structured is not None:
      if isinstance(structured.get('ok'), bool):
        ok = structured.get('ok')
      if isinstance(structured.get('message'), str):
        message = structured.get('message')
      collect_media_paths(structured, media_paths)
      detail_source = parsed.get('result') if parsed.get('result') is not None else parsed.get('error')
      if isinstance(detail_source, str) and detail_source.strip():
        detail = detail_source
      elif structured:
        detail = json.dumps(structured, ensure_ascii=False)

    elif 'result' in parsed or 'error' in parsed:
      ok = False if parsed.get('error') is not None else True
      detail_source = parsed.get('result') if parsed.get('result') is not None else parsed.get('error')
      if isinstance(detail_source, str) and detail_source.strip():
        detail = detail_source
      elif detail_source is not None:
        detail = json.dumps(detail_source, ensure_ascii=False)
      nested = nested_result if parsed.get('result') is not None else nested_error
      if isinstance(nested, dict):
        collect_media_paths(nested, media_paths)
        if isinstance(nested.get('message'), str):
          message = nested.get('message')

    elif 'success' in parsed:
      success = parsed.get('success')
      if isinstance(success, bool):
        ok = success
      if isinstance(parsed.get('analysis'), str) and parsed.get('analysis').strip():
        detail = parsed.get('analysis')
      elif isinstance(parsed.get('error'), str) and parsed.get('error').strip():
        detail = parsed.get('error')
      else:
        detail = json.dumps(parsed, ensure_ascii=False)
      if ok is False and isinstance(parsed.get('error'), str):
        message = parsed.get('error')
      collect_media_paths(parsed, media_paths)

    elif 'output' in parsed or 'exit_code' in parsed:
      exit_code = parsed.get('exit_code')
      ok = (isinstance(exit_code, int) and exit_code == 0) if exit_code is not None else parsed.get('error') in (None, '')
      if isinstance(parsed.get('output'), str) and parsed.get('output').strip():
        detail = parsed.get('output')
      elif isinstance(parsed.get('error'), str) and parsed.get('error').strip():
        detail = parsed.get('error')
      else:
        detail = json.dumps(parsed, ensure_ascii=False)
      collect_media_paths(parsed, media_paths)

  deduped_media_paths = []
  seen_media = set()
  for path in media_paths:
    if path in seen_media:
      continue
    seen_media.add(path)
    deduped_media_paths.append(path)

  result = {}
  if isinstance(ok, bool):
    result['resultOk'] = ok
  if message:
    result['resultMessage'] = message
  if isinstance(detail, str) and detail.strip():
    result['resultDetail'] = detail
  if deduped_media_paths:
    result['mediaPaths'] = deduped_media_paths
  return result

for row in con.execute("""
select id, role, content, reasoning, finish_reason, timestamp, tool_calls, tool_name
from messages
where session_id = ?
  and role in ('user', 'assistant', 'tool')
order by timestamp asc, id asc
""", (session_id,)):
  if row['role'] == 'tool':
    if active_assistant and active_assistant.get('tools') and active_tool_index < len(active_assistant['tools']):
      tool_result = parse_tool_result(row['content'] or '')
      if tool_result:
        active_tool = active_assistant['tools'][active_tool_index]
        active_tool.update(tool_result)
        media_paths = tool_result.get('mediaPaths')
        if isinstance(media_paths, list) and media_paths:
          active_assistant['content'] = append_media_lines(active_assistant.get('content') or '', media_paths)
      active_tool_index += 1
    continue

  tools = []
  raw_tool_calls = row['tool_calls']
  if raw_tool_calls:
    try:
      parsed_tool_calls = json.loads(raw_tool_calls)
      if isinstance(parsed_tool_calls, list):
        for index, tool in enumerate(parsed_tool_calls):
          if not isinstance(tool, dict):
            continue
          function_data = tool.get('function') if isinstance(tool.get('function'), dict) else {}
          tool_name = function_data.get('name') or tool.get('tool_name') or ''
          if not isinstance(tool_name, str) or not tool_name:
            continue
          tool_args = function_data.get('arguments')
          if not isinstance(tool_args, str):
            tool_args = json.dumps(tool_args) if tool_args is not None else ''
          tool_id = tool.get('id') or tool.get('call_id') or tool.get('tool_call_id') or ''
          tools.append({
            'index': index,
            'id': tool_id if isinstance(tool_id, str) and tool_id else None,
            'name': tool_name,
            'arguments': tool_args,
          })
    except Exception:
      tools = []

  messages.append({
    'id': str(row['id']),
    'role': row['role'],
    'content': row['content'] or '',
    'reasoning': row['reasoning'] or '',
    'tools': tools,
    'finishReason': row['finish_reason'],
    'timestamp': row['timestamp'],
  })
  active_assistant = messages[-1] if row['role'] == 'assistant' else None
  active_tool_index = 0

preview = re.sub(r'\\s+', ' ', session['preview'] or '').strip()
print(json.dumps({
  'session': {
    'id': session['id'],
    'source': session['source'] or '',
    'model': session['model'],
    'title': session['title'],
    'preview': preview[:160],
    'startedAt': session['started_at'],
    'lastActiveAt': session['last_active_at'],
    'messageCount': int(session['message_count'] or 0),
  },
  'messages': messages,
}))
`
}

function buildNativeChatScript(prompt: string, sessionId?: string): string {
  return `
from pathlib import Path
import json
import subprocess
import sys

prompt = ${JSON.stringify(prompt)}
session_id = ${JSON.stringify(sessionId || '')}
home = Path.home()
workspace = home / 'hermes-workspace'
hermes_bin = home / '.hermes' / 'hermes-agent' / 'venv' / 'bin' / 'hermes'

cmd = [str(hermes_bin), 'chat', '-Q']
if session_id:
  cmd.extend(['--resume', session_id])
else:
  cmd.extend(['--source', 'oasis'])
cmd.extend(['-q', prompt])

result = subprocess.run(
  cmd,
  cwd=str(workspace),
  capture_output=True,
  text=True,
  timeout=600,
)

stdout = result.stdout or ''
stderr = result.stderr or ''
session_out = session_id
content_lines = []

for line in stdout.splitlines():
  stripped = line.strip()
  if stripped.startswith('session_id:'):
    session_out = stripped.split(':', 1)[1].strip()
    continue
  if stripped.startswith('╭─') or stripped.startswith('╰─'):
    continue
  if stripped == '':
    content_lines.append('')
    continue
  content_lines.append(line)

content = '\\n'.join(content_lines).strip()

print(json.dumps({
  'code': result.returncode,
  'stdout': stdout,
  'stderr': stderr,
  'content': content,
  'sessionId': session_out,
}))
`
}

function normalizeEpochMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value < 1_000_000_000_000 ? Math.round(value * 1000) : Math.round(value)
}

function normalizeSessionSummary(session: HermesNativeSessionSummary): HermesNativeSessionSummary {
  return {
    ...session,
    startedAt: normalizeEpochMs(session.startedAt),
    lastActiveAt: normalizeEpochMs(session.lastActiveAt),
  }
}

function normalizeSessionDetail(detail: HermesNativeSessionDetail): HermesNativeSessionDetail {
  return {
    session: normalizeSessionSummary(detail.session),
    messages: Array.isArray(detail.messages)
      ? detail.messages.map(message => ({
          ...message,
          timestamp: normalizeEpochMs(message.timestamp) ?? Date.now(),
        }))
      : [],
  }
}

export async function listHermesNativeSessions(options?: { source?: string; limit?: number }): Promise<HermesNativeSessionSummary[]> {
  const source = sanitizeString(options?.source)
  const limit = Math.max(1, Math.min(options?.limit ?? 30, 100))
  const result = await runHermesRemotePython(buildListSessionsScript(source, limit), 120000)
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || 'Unable to list Hermes sessions.')
  }

  const parsed = JSON.parse(result.stdout) as { sessions?: HermesNativeSessionSummary[] }
  return Array.isArray(parsed.sessions) ? parsed.sessions.map(normalizeSessionSummary) : []
}

export async function readHermesNativeSession(sessionId: string): Promise<HermesNativeSessionDetail> {
  const result = await runHermesRemotePython(buildReadSessionScript(sessionId), 120000)
  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || 'Unable to load Hermes session.'
    throw new Error(message)
  }

  const parsed = JSON.parse(result.stdout) as HermesNativeSessionDetail & { error?: string }
  if (parsed.error) {
    throw new Error(parsed.error)
  }

  return normalizeSessionDetail(parsed)
}

export async function runHermesNativeChat(prompt: string, sessionId?: string): Promise<HermesNativeChatResult> {
  const cleanPrompt = sanitizeString(prompt)
  if (!cleanPrompt) {
    throw new Error('Message is required.')
  }

  const result = await runHermesRemotePython(buildNativeChatScript(cleanPrompt, sessionId), 600000)
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Native Hermes chat failed.')
  }

  const parsed = JSON.parse(result.stdout) as {
    code?: number
    stdout?: string
    stderr?: string
    content?: string
    sessionId?: string
  }

  if (typeof parsed.code === 'number' && parsed.code !== 0) {
    throw new Error(sanitizeString(parsed.stderr) || sanitizeString(parsed.stdout) || 'Native Hermes chat failed.')
  }

  const nextSessionId = sanitizeString(parsed.sessionId)
  if (!nextSessionId) {
    throw new Error('Hermes did not return a session id for the native chat.')
  }

  return {
    content: sanitizeString(parsed.content),
    sessionId: nextSessionId,
    rawStdout: sanitizeString(parsed.stdout),
  }
}
