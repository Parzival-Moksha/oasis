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
for row in con.execute("""
select id, role, content, reasoning, finish_reason, timestamp
from messages
where session_id = ?
  and role in ('user', 'assistant')
order by timestamp asc, id asc
""", (session_id,)):
  messages.append({
    'id': str(row['id']),
    'role': row['role'],
    'content': row['content'] or '',
    'reasoning': row['reasoning'] or '',
    'finishReason': row['finish_reason'],
    'timestamp': row['timestamp'],
  })

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

cmd = [str(hermes_bin), 'chat', '-Q', '-q', prompt]
if session_id:
  cmd.extend(['--resume', session_id])
else:
  cmd.extend(['--source', 'oasis'])

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

export async function listHermesNativeSessions(options?: { source?: string; limit?: number }): Promise<HermesNativeSessionSummary[]> {
  const source = sanitizeString(options?.source)
  const limit = Math.max(1, Math.min(options?.limit ?? 30, 100))
  const result = await runHermesRemotePython(buildListSessionsScript(source, limit), 120000)
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || 'Unable to list Hermes sessions.')
  }

  const parsed = JSON.parse(result.stdout) as { sessions?: HermesNativeSessionSummary[] }
  return Array.isArray(parsed.sessions) ? parsed.sessions : []
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

  return parsed
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
