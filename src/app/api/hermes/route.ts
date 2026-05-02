import { spawn } from 'child_process'
import * as http from 'http'
import * as https from 'https'

import { NextRequest, NextResponse } from 'next/server'

import { resolveHermesConfig } from '@/lib/hermes-config'
import { buildHermesRemoteExec, ensureHermesRemoteOasisMcpUrl } from '@/lib/hermes-remote'
import { getHermesRemoteOasisBaseUrl } from '@/lib/hermes-tunnel'
import {
  publishWorldPlayerContext,
  type RuntimePlayerContext as PromptPlayerContext,
} from '@/lib/world-runtime-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ClientMessage = {
  role?: string
  content?: unknown
}

type NativeHermesEvent =
  | { type?: 'text'; content?: unknown }
  | { type?: 'tool'; index?: unknown; id?: unknown; name?: unknown; argumentsChunk?: unknown }
  | { type?: 'done'; finishReason?: unknown }
  | { type?: 'session'; sessionId?: unknown }
  | { type?: 'end'; code?: unknown; stderr?: unknown }

const HERMES_OASIS_TOOLSETS = 'web,terminal,vision,skills,tts,todo,memory,session_search,clarify,delegation,mcp-oasis'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeWorldId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readToolNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function readToolVec3(value: unknown): [number, number, number] | undefined {
  if (Array.isArray(value) && value.length >= 3) {
    const [x, y, z] = value.slice(0, 3).map(Number)
    return [x, y, z].every(Number.isFinite) ? [x, y, z] : undefined
  }

  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed) && parsed.length >= 3) {
      const [x, y, z] = parsed.slice(0, 3).map(Number)
      return [x, y, z].every(Number.isFinite) ? [x, y, z] : undefined
    }
  } catch {
    // Fall back to token parsing below.
  }

  const parts = trimmed
    .replace(/^[\[\(\{]\s*/, '')
    .replace(/\s*[\]\)\}]$/, '')
    .split(/[,\s]+/)
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length < 3) return undefined
  const [x, y, z] = parts.slice(0, 3).map(Number)
  return [x, y, z].every(Number.isFinite) ? [x, y, z] : undefined
}

function formatPromptVec3(value: [number, number, number]): string {
  return `[${value.map(component => Number.isFinite(component) ? Number(component.toFixed(2)) : component).join(', ')}]`
}

function parsePromptPlayerContext(value: unknown): PromptPlayerContext | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const avatarRecord = record.avatar && typeof record.avatar === 'object' ? record.avatar as Record<string, unknown> : null
  const cameraRecord = record.camera && typeof record.camera === 'object' ? record.camera as Record<string, unknown> : null

  const avatarPosition = avatarRecord ? readToolVec3(avatarRecord.position) : undefined
  const avatarForward = avatarRecord ? readToolVec3(avatarRecord.forward) : undefined
  const avatarYaw = avatarRecord ? readToolNumber(avatarRecord.yaw) : undefined
  const cameraPosition = cameraRecord ? readToolVec3(cameraRecord.position) : undefined
  const cameraForward = cameraRecord ? readToolVec3(cameraRecord.forward) : undefined

  const avatar = avatarPosition
    ? {
        position: avatarPosition,
        ...(avatarYaw !== undefined ? { yaw: avatarYaw } : {}),
        ...(avatarForward ? { forward: avatarForward } : {}),
      }
    : null
  const camera = cameraPosition
    ? {
        position: cameraPosition,
        ...(cameraForward ? { forward: cameraForward } : {}),
      }
    : null

  if (!avatar && !camera) return null
  return { avatar, camera }
}

function buildOasisRuntimeContext(worldId: string, playerContext?: PromptPlayerContext | null): string {
  const context: string[] = []

  if (worldId) {
    context.push(`- Active Oasis world ID: ${worldId}.`)
    context.push(`- Always include worldId="${worldId}" on Oasis tool calls instead of relying on implicit active-world state.`)
  }

  if (playerContext?.avatar) {
    context.push(`- The user's live avatar body is at ${formatPromptVec3(playerContext.avatar.position)}.`)
    if (playerContext.avatar.forward) {
      context.push(`- The user's live avatar forward vector is ${formatPromptVec3(playerContext.avatar.forward)}.`)
    }
    context.push('- When the user says "me", "my avatar", or "come to me", they mean that live avatar body above.')
  }

  if (playerContext?.camera) {
    context.push(`- The user's current camera is at ${formatPromptVec3(playerContext.camera.position)}.`)
    if (playerContext.camera.forward) {
      context.push(`- The user's camera forward vector is ${formatPromptVec3(playerContext.camera.forward)}.`)
    }
  }

  context.push('- Oasis avatar actions and crafting may take time to execute visibly; do not assume teleport-style instant completion.')
  context.push('- Self-crafted craft_scene calls with explicit objects are the default. Call get_craft_guide when you need the primitive schema. Use prompt-based craft_scene only with strategy: "sculptor", then poll get_craft_job if it starts a long-running job.')
  context.push('- If the user asks for asset library, catalog assets, prefab objects, or specific existing models, use search_assets then place_object. Reserve craft_scene for procedural primitive geometry you describe yourself.')
  context.push('- Call list_avatar_animations before play_avatar_animation instead of guessing clip names.')
  context.push('- When you call Oasis screenshot tools, include defaultAgentType="hermes" so your agent-view captures resolve to Hermes-compatible screenshot paths.')
  context.push('- For multi-angle Oasis vision, prefer one screenshot_viewport call with a views array instead of many separate screenshot calls.')
  context.push('- Do not use generic browser_* tools to inspect Oasis worlds. Those browsers run remotely and can point at the wrong world. For Oasis visual checks use only the Oasis screenshot tools.')
  context.push('- If Oasis screenshot tools fail, report that the live Oasis screenshot bridge is unavailable, unfocused, or on a different world instead of falling back to browser tools.')

  if (!context.length) return ''
  return ['Oasis runtime context:', ...context].join('\n')
}

function appendSystemPrompt(systemPrompt: string, runtimeContext: string) {
  if (!runtimeContext) return systemPrompt
  if (!systemPrompt) return runtimeContext
  return `${systemPrompt}\n\n${runtimeContext}`.trim()
}

function sanitizeHermesThreadMessageText(role: 'user' | 'assistant', content: string): string {
  let next = sanitizeString(content)
  if (!next) return ''

  if (role === 'user' && next.startsWith('Oasis runtime context:')) {
    const marker = /User request:\s*/i.exec(next)
    if (marker) {
      next = next.slice(marker.index + marker[0].length).trim() || next
    }
  }

  next = next
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('MEDIA:'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return next.length > 420 ? `${next.slice(0, 417)}...` : next
}

function sanitizeClientHistory(raw: unknown): ClientMessage[] {
  if (!Array.isArray(raw)) return []

  const sanitized: ClientMessage[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : ''
    if (!role) continue
    const content = sanitizeHermesThreadMessageText(role, extractText(item.content))
    if (!content) continue
    sanitized.push({ role, content })
  }

  return sanitized.slice(-24)
}

function buildNativeContinuationContext(history: ClientMessage[]): string {
  const recent = history
    .slice(-8)
    .map(entry => {
      const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : ''
      const content = sanitizeHermesThreadMessageText(role || 'user', extractText(entry.content))
      if (!role || !content) return ''
      return `${role === 'assistant' ? 'Hermes' : 'User'}: ${content}`
    })
    .filter(Boolean)

  if (recent.length === 0) return ''

  return [
    'Conversation continuity context from the same Oasis thread. Use it if resumed session context is incomplete.',
    'Do not claim this is the first user message when prior turns are listed below.',
    ...recent,
  ].join('\n')
}

function buildPromptWithRuntimeContext(prompt: string, runtimeContext: string, continuationContext = '') {
  const sections: string[] = []
  if (runtimeContext) sections.push(runtimeContext)
  if (continuationContext) sections.push(continuationContext)
  sections.push(`User request:\n${prompt}`)
  return sections.join('\n\n').trim()
}

function rootBaseFromApiBase(apiBase: string): string {
  return apiBase.replace(/\/v1$/i, '')
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function splitHostHeader(host: string): { hostName: string; hostPort: string } {
  const trimmed = host.trim()
  if (!trimmed) return { hostName: '', hostPort: '' }

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end >= 0) {
      return {
        hostName: trimmed.slice(0, end + 1),
        hostPort: trimmed.slice(end + 2),
      }
    }
  }

  const colonIndex = trimmed.lastIndexOf(':')
  if (colonIndex > -1 && trimmed.indexOf(':') === colonIndex) {
    return {
      hostName: trimmed.slice(0, colonIndex),
      hostPort: trimmed.slice(colonIndex + 1),
    }
  }

  return { hostName: trimmed, hostPort: '' }
}

function canUseHermesProxy(request: NextRequest): boolean {
  if (process.env.OASIS_ALLOW_REMOTE_HERMES_PROXY === 'true') return true
  if (process.env.NODE_ENV !== 'production') return true

  const host = request.headers.get('host') || ''
  const hostName = splitHostHeader(host).hostName.toLowerCase()
  if (!isLoopbackHost(hostName)) return false

  const forwardedHost = (request.headers.get('x-forwarded-host') || '').split(',')[0]?.trim().toLowerCase()
  if (forwardedHost && !isLoopbackHost(splitHostHeader(forwardedHost).hostName || '')) return false

  const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim()
  if (forwardedFor && forwardedFor !== '127.0.0.1' && forwardedFor !== '::1' && forwardedFor !== '[::1]') return false

  return true
}

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return true

  try {
    const originUrl = new URL(origin)
    if (originUrl.host === host) return true

    const { hostName, hostPort } = splitHostHeader(host)
    const originPort = originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80')
    const requestPort = hostPort || (originUrl.protocol === 'https:' ? '443' : '80')

    return isLoopbackHost(originUrl.hostname) && isLoopbackHost(hostName) && originPort === requestPort
  } catch {
    return false
  }
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractText).join('')
  if (!value || typeof value !== 'object') return ''

  const obj = value as Record<string, unknown>
  if (typeof obj.text === 'string') return obj.text
  if (typeof obj.content === 'string') return obj.content
  if (obj.text && typeof obj.text === 'object') return extractText(obj.text)
  if (typeof obj.value === 'string') return obj.value
  if (typeof obj.reasoning === 'string') return obj.reasoning

  return ''
}

function buildMessages(history: ClientMessage[], prompt: string, systemPrompt: string, runtimeContext = '') {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

  const combinedSystemPrompt = appendSystemPrompt(systemPrompt, runtimeContext)
  if (combinedSystemPrompt) {
    messages.push({ role: 'system', content: combinedSystemPrompt })
  }

  for (const entry of history.slice(-20)) {
    if (entry.role !== 'user' && entry.role !== 'assistant') continue
    const content = typeof entry.content === 'string' ? entry.content.trim() : ''
    if (!content) continue
    messages.push({ role: entry.role, content })
  }

  messages.push({ role: 'user', content: prompt })
  return messages
}

function buildNativeChatRunnerScript(prompt: string, sessionId: string) {
  return `
from pathlib import Path
import json
import re
import subprocess
import sys

prompt = ${JSON.stringify(prompt)}
session_id = ${JSON.stringify(sessionId)}
toolsets = ${JSON.stringify(HERMES_OASIS_TOOLSETS)}
home = Path.home()
workspace = home / 'hermes-workspace'
hermes_bin = home / '.hermes' / 'hermes-agent' / 'venv' / 'bin' / 'hermes'

def emit(payload):
  sys.stdout.write(json.dumps(payload) + '\\n')
  sys.stdout.flush()

tool_index = 0

def is_ignored_stdout_line(value):
  lowered = value.strip().lower()
  lowered = lowered.replace('[yellow]', '').replace('[/]', '').strip()
  lowered = lowered.lstrip('![](){}<>-:;,. ').lstrip('⚠️').strip()
  return lowered.startswith('normalized model') or lowered.startswith('normalized m')

def is_tool_progress_prefix(value):
  lowered = value.strip().lower()
  normalized = re.sub(r'^[^a-z0-9]+', '', lowered)
  return (
    normalized.startswith('preparing ') or
    'preparing '.startswith(normalized) or
    normalized.startswith('auto-repaired tool name') or
    'auto-repaired tool name'.startswith(normalized)
  )
  lowered = lowered.lstrip('┊').strip()
  normalized = lowered.lstrip('⚡').lstrip('🔧').strip()
  return (
    normalized.startswith('preparing ') or
    'preparing '.startswith(normalized) or
    normalized.startswith('auto-repaired tool name') or
    'auto-repaired tool name'.startswith(normalized)
  )

def extract_preparing_tool_name(value):
  match = re.search(r'preparing\\s+([A-Za-z0-9_]+)', value, re.IGNORECASE)
  if not match:
    return None
  return match.group(1)
  tail = tail.rstrip('â€¦').rstrip('...')
  return match.group(1) if match else None
  return match.group(1) if match else None

def extract_repaired_tool_name(value):
  match = re.search(r"->\\s*'([^']+)'", value)
  return match.group(1) if match else None

cmd = [str(hermes_bin), 'chat', '--toolsets', toolsets, '-Q']
if session_id:
  cmd.extend(['--resume', session_id])
else:
  cmd.extend(['--source', 'oasis'])
cmd.extend(['-q', prompt])

proc = subprocess.Popen(
  cmd,
  cwd=str(workspace),
  stdout=subprocess.PIPE,
  stderr=subprocess.PIPE,
  text=True,
  bufsize=1,
)

for raw_line in iter(proc.stdout.readline, ''):
  line = raw_line.rstrip('\\n')
  stripped = line.strip()
  if stripped.startswith('session_id:'):
    emit({'type': 'session', 'sessionId': stripped.split(':', 1)[1].strip()})
    continue
  if stripped.lower().startswith('finish_reason'):
    continue
  prepared_tool = extract_preparing_tool_name(stripped)
  if prepared_tool:
    emit({'type': 'done', 'finishReason': 'tool_calls'})
    emit({'type': 'tool', 'index': tool_index, 'name': prepared_tool, 'argumentsChunk': ''})
    tool_index += 1
    continue
  repaired_tool = extract_repaired_tool_name(stripped)
  if repaired_tool and tool_index > 0:
    emit({'type': 'tool', 'index': tool_index - 1, 'name': repaired_tool, 'argumentsChunk': ''})
    continue
  if is_ignored_stdout_line(stripped):
    continue
  if stripped and ord(stripped[0]) in (9581, 9584, 9474):
    continue
  emit({'type': 'text', 'content': raw_line})

stderr = proc.stderr.read() or ''
code = proc.wait()
emit({'type': 'end', 'code': code, 'stderr': stderr})
`
}

function buildNativeChatRunnerScriptWithContext(
  prompt: string,
  sessionId: string,
  context?: {
    worldId?: string
    oasisToolsUrl?: string
    oasisMcpUrl?: string
  },
) {
  if (!context?.worldId && !context?.oasisToolsUrl && !context?.oasisMcpUrl) {
    return buildNativeChatRunnerScript(prompt, sessionId)
  }
  return `
from pathlib import Path
import json
import os
import re
import selectors
import shutil
import subprocess
import sys

prompt = ${JSON.stringify(prompt)}
session_id = ${JSON.stringify(sessionId)}
toolsets = ${JSON.stringify(HERMES_OASIS_TOOLSETS)}
world_id = ${JSON.stringify(context?.worldId || '')}
oasis_tools_url = ${JSON.stringify(context?.oasisToolsUrl || '')}
oasis_mcp_url = ${JSON.stringify(context?.oasisMcpUrl || '')}
home = Path.home()
workspace = home / 'hermes-workspace'
hermes_bin = home / '.hermes' / 'hermes-agent' / 'venv' / 'bin' / 'hermes'

def emit(payload):
  sys.stdout.write(json.dumps(payload) + '\\n')
  sys.stdout.flush()

tool_index = 0

def is_control_prefix(value):
  lowered = value.strip().lower()
  return (
    'session_id:'.startswith(lowered) or
    'finish_reason'.startswith(lowered)
  )

def is_ignored_stdout_line(value):
  lowered = value.strip().lower()
  lowered = lowered.replace('[yellow]', '').replace('[/]', '').strip()
  lowered = lowered.lstrip('![](){}<>-:;,. ').lstrip('⚠️').strip()
  return lowered.startswith('normalized model') or lowered.startswith('normalized m')

def is_tool_progress_prefix(value):
  lowered = value.strip().lower()
  normalized = re.sub(r'^[^a-z0-9]+', '', lowered)
  return (
    normalized.startswith('preparing ') or
    'preparing '.startswith(normalized) or
    normalized.startswith('auto-repaired tool name') or
    'auto-repaired tool name'.startswith(normalized)
  )

def extract_preparing_tool_name(value):
  match = re.search(r'preparing\\s+([A-Za-z0-9_]+)', value, re.IGNORECASE)
  if not match:
    return None
  return match.group(1)
  marker = 'preparing '
  idx = lowered.find(marker)
  if idx < 0:
    return None
  tail = value[idx + len(marker):].strip()
  tail = tail.rstrip('â€¦').rstrip('...')
  match = re.search(r'([A-Za-z0-9_]+)', tail)
  return match.group(1) if match else None

def extract_repaired_tool_name(value):
  match = re.search(r"->\\s*'([^']+)'", value)
  return match.group(1) if match else None

def handle_stdout_line(line):
  global tool_index
  stripped = line.strip()
  if stripped.startswith('session_id:'):
    emit({'type': 'session', 'sessionId': stripped.split(':', 1)[1].strip()})
    return
  if stripped.lower().startswith('finish_reason'):
    return
  prepared_tool = extract_preparing_tool_name(stripped)
  if prepared_tool:
    emit({'type': 'done', 'finishReason': 'tool_calls'})
    emit({'type': 'tool', 'index': tool_index, 'name': prepared_tool, 'argumentsChunk': ''})
    tool_index += 1
    return
  repaired_tool = extract_repaired_tool_name(stripped)
  if repaired_tool and tool_index > 0:
    emit({'type': 'tool', 'index': tool_index - 1, 'name': repaired_tool, 'argumentsChunk': ''})
    return
  if is_ignored_stdout_line(stripped):
    return
  if stripped and ord(stripped[0]) in (9581, 9584, 9474):
    return
  emit({'type': 'text', 'content': line})

cmd = [str(hermes_bin), 'chat', '--toolsets', toolsets, '-Q']
if session_id:
  cmd.extend(['--resume', session_id])
else:
  cmd.extend(['--source', 'oasis'])
cmd.extend(['-q', prompt])

env = dict(os.environ)
env['OASIS_AGENT_TYPE'] = 'hermes'
env['PYTHONUNBUFFERED'] = '1'
if world_id:
  env['OASIS_ACTIVE_WORLD_ID'] = world_id
if oasis_tools_url:
  env['OASIS_TOOLS_URL'] = oasis_tools_url
if oasis_mcp_url:
  env['OASIS_MCP_URL'] = oasis_mcp_url

stdbuf = shutil.which('stdbuf')
if stdbuf:
  cmd = [stdbuf, '-o0', '-e0', *cmd]

proc = subprocess.Popen(
  cmd,
  cwd=str(workspace),
  stdout=subprocess.PIPE,
  stderr=subprocess.PIPE,
  text=False,
  bufsize=0,
  env=env,
)

selector = selectors.DefaultSelector()
selector.register(proc.stdout, selectors.EVENT_READ, 'stdout')
selector.register(proc.stderr, selectors.EVENT_READ, 'stderr')

stdout_line = ''
stderr_chunks = []

while selector.get_map():
  events = selector.select(timeout=0.1)
  if not events and proc.poll() is not None:
    break
  for key, _ in events:
    label = key.data
    stream = key.fileobj
    chunk = stream.read1(4096) if hasattr(stream, 'read1') else stream.read(4096)
    if not chunk:
      selector.unregister(stream)
      continue

    if label == 'stderr':
      stderr_chunks.append(chunk.decode('utf-8', 'ignore'))
      continue

    text = chunk.decode('utf-8', 'ignore')
    for char in text:
      stdout_line += char
      if char == '\\n':
        handle_stdout_line(stdout_line)
        stdout_line = ''
        continue
      if (
        len(stdout_line) >= 16 and
        not is_control_prefix(stdout_line) and
        not is_ignored_stdout_line(stdout_line) and
        not is_tool_progress_prefix(stdout_line)
      ):
        emit({'type': 'text', 'content': stdout_line})
        stdout_line = ''

if stdout_line:
  if is_control_prefix(stdout_line) or is_tool_progress_prefix(stdout_line):
    handle_stdout_line(stdout_line)
  else:
    emit({'type': 'text', 'content': stdout_line})

stderr = ''.join(stderr_chunks)
code = proc.wait()
emit({'type': 'end', 'code': code, 'stderr': stderr})
`
}

function makeSseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  }
}

function serializeSse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function getSsePayloads(buffer: string): { payloads: string[]; remainder: string } {
  const normalized = buffer.replace(/\r/g, '')
  const blocks = normalized.split('\n\n')
  const remainder = blocks.pop() || ''

  const payloads = blocks
    .map(block =>
      block
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
        .trim()
    )
    .filter(Boolean)

  return { payloads, remainder }
}

async function readErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 1200)
  } catch {
    return `HTTP ${response.status}`
  }
}

async function requestHermesStatus(urlString: string, headers: Record<string, string>): Promise<{
  status: number
  ok: boolean
  bodyText: string
}> {
  const target = new URL(urlString)
  const client = target.protocol === 'https:' ? https : http

  return await new Promise((resolve, reject) => {
    const request = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port ? Number(target.port) : (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers,
    }, response => {
      let bodyText = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        bodyText += chunk
      })
      response.on('end', () => {
        const status = response.statusCode || 0
        resolve({
          status,
          ok: status >= 200 && status < 300,
          bodyText,
        })
      })
    })

    request.once('error', reject)
    request.setTimeout(5000, () => request.destroy(new Error('Hermes upstream status request timed out.')))
    request.end()
  })
}

export async function GET(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canUseHermesProxy(request)) {
    return NextResponse.json({
      error: 'Hermes proxy is localhost-only by default. Set OASIS_ALLOW_REMOTE_HERMES_PROXY=true to allow remote access.',
    }, { status: 403 })
  }

  const config = await resolveHermesConfig()
  if (!config.apiKey) {
    return NextResponse.json({
      configured: false,
      connected: false,
      source: config.source,
      base: config.apiBase,
      defaultModel: config.defaultModel || null,
      models: [],
      error: 'Hermes is not configured yet. Open config and paste the setup block from Hermes.',
    })
  }

  try {
    const authHeaders = { Authorization: `Bearer ${config.apiKey}` }
    const modelsResponse = await requestHermesStatus(`${config.apiBase}/models`, authHeaders)

    if (modelsResponse.ok) {
      const data = JSON.parse(modelsResponse.bodyText || '{}') as { data?: unknown }
      const models = Array.isArray(data?.data)
        ? data.data
            .map((entry: unknown) =>
              entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
                ? (entry as { id: string }).id
                : null
            )
            .filter((entry: string | null): entry is string => Boolean(entry))
        : []

      return NextResponse.json({
        configured: true,
        connected: true,
        source: config.source,
        base: config.apiBase,
        defaultModel: config.defaultModel || models[0] || null,
        models,
      })
    }

    const healthResponse = await requestHermesStatus(`${rootBaseFromApiBase(config.apiBase)}/health`, authHeaders).catch(() => null)

    return NextResponse.json({
      configured: true,
      connected: Boolean(healthResponse?.ok),
      source: config.source,
      base: config.apiBase,
      defaultModel: config.defaultModel || null,
      models: [],
      error: (modelsResponse.bodyText || `HTTP ${modelsResponse.status}`).slice(0, 1200),
    })
  } catch (error) {
    return NextResponse.json({
      configured: true,
      connected: false,
      source: config.source,
      base: config.apiBase,
      defaultModel: config.defaultModel || null,
      models: [],
      error: error instanceof Error ? error.message : 'Unable to reach Hermes upstream.',
    })
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canUseHermesProxy(request)) {
    return NextResponse.json({
      error: 'Hermes proxy is localhost-only by default. Set OASIS_ALLOW_REMOTE_HERMES_PROXY=true to allow remote access.',
    }, { status: 403 })
  }

  const config = await resolveHermesConfig()
  if (!config.apiKey) {
    return NextResponse.json({ error: 'Hermes is not configured. Save Hermes connection data first.' }, { status: 500 })
  }

  const body = await request.json().catch(() => null) as {
    message?: unknown
    history?: ClientMessage[]
    sessionMode?: unknown
    sessionId?: unknown
    worldId?: unknown
    playerContext?: unknown
  } | null

  const prompt = sanitizeString(body?.message)
  if (!prompt) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  }

  const sessionMode = sanitizeString(body?.sessionMode)
  const requestedSessionId = sanitizeString(body?.sessionId)
  const history = sanitizeClientHistory(body?.history)
  const worldId = sanitizeWorldId(body?.worldId)
  const playerContext = parsePromptPlayerContext(body?.playerContext)
  const runtimeContext = buildOasisRuntimeContext(worldId, playerContext)
  const nativeContinuationContext = buildNativeContinuationContext(history)
  const remoteOasisBaseUrl = await getHermesRemoteOasisBaseUrl()
  const remoteOasisToolsUrl = `${remoteOasisBaseUrl}/api/oasis-tools`
  const remoteOasisMcpUrl = `${remoteOasisBaseUrl}/api/mcp/oasis${worldId ? `?worldId=${encodeURIComponent(worldId)}&agentType=hermes` : '?agentType=hermes'}`

  if (playerContext && worldId) {
    await publishWorldPlayerContext(worldId, playerContext)
  }

  if (sessionMode === 'native') {
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(serializeSse(payload)))
        }

        let closed = false
        const closeStream = () => {
          if (closed) return
          closed = true
          controller.close()
        }

        try {
          await ensureHermesRemoteOasisMcpUrl(remoteOasisMcpUrl)
          const exec = await buildHermesRemoteExec(['python3', '-'])
          const child = spawn(exec.executable, exec.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          })

          let stdoutBuffer = ''
          let stderrBuffer = ''
          let nativeEnded = false

          const flushJsonLine = (line: string) => {
            const trimmed = line.trim()
            if (!trimmed) return

            try {
              const parsed = JSON.parse(trimmed) as NativeHermesEvent
              if (parsed.type === 'text') {
                const content = typeof parsed.content === 'string' ? parsed.content : ''
                if (content) emit({ type: 'text', content })
                return
              }

              if (parsed.type === 'tool') {
                const index = readToolNumber(parsed.index) ?? 0
                const name = sanitizeString(parsed.name)
                const argumentsChunk = typeof parsed.argumentsChunk === 'string' ? parsed.argumentsChunk : ''
                if (name) {
                  emit({
                    type: 'tool',
                    index,
                    name,
                    ...(argumentsChunk ? { argumentsChunk } : {}),
                  })
                }
                return
              }

              if (parsed.type === 'done') {
                const finishReason = sanitizeString(parsed.finishReason)
                emit({ type: 'done', ...(finishReason ? { finishReason } : {}) })
                return
              }

              if (parsed.type === 'session') {
                const sessionId = sanitizeString(parsed.sessionId)
                if (sessionId) {
                  emit({ type: 'meta', sessionMode: 'native', sessionId, upstream: 'ssh' })
                }
                return
              }

              if (parsed.type === 'end') {
                nativeEnded = true
                const code = typeof parsed.code === 'number' ? parsed.code : 0
                const stderr = sanitizeString(parsed.stderr)
                if (code !== 0) {
                  emit({
                    type: 'error',
                    message: stderr || `Hermes native chat exited with code ${code}.`,
                  })
                }
                emit({ type: 'done', finishReason: code === 0 ? 'stop' : 'error' })
                closeStream()
              }
            } catch {
              // Skip malformed JSONL chunks.
            }
          }

          child.stdout.setEncoding('utf8')
          child.stderr.setEncoding('utf8')

          child.stdout.on('data', chunk => {
            stdoutBuffer += chunk
            const lines = stdoutBuffer.split('\n')
            stdoutBuffer = lines.pop() || ''
            lines.forEach(flushJsonLine)
          })

          child.stderr.on('data', chunk => {
            stderrBuffer += chunk
          })

          child.once('error', error => {
            emit({ type: 'error', message: error.message })
            closeStream()
          })

          child.once('close', code => {
            if (stdoutBuffer.trim()) flushJsonLine(stdoutBuffer)
            if (nativeEnded) return

            if (code && code !== 0) {
              emit({
                type: 'error',
                message: sanitizeString(stderrBuffer) || `Hermes native chat exited with code ${code}.`,
              })
            }
            emit({ type: 'done', finishReason: code === 0 ? 'stop' : 'error' })
            closeStream()
          })

          request.signal.addEventListener('abort', () => {
            try {
              child.kill()
            } catch {
              // Best effort.
            }
          }, { once: true })

          emit({
            type: 'meta',
            sessionMode: 'native',
            upstream: 'ssh',
            sessionId: requestedSessionId || undefined,
            ...(worldId ? { worldId } : {}),
          })
          child.stdin.write(buildNativeChatRunnerScriptWithContext(
            buildPromptWithRuntimeContext(prompt, runtimeContext, nativeContinuationContext),
            requestedSessionId,
            {
              worldId,
              oasisToolsUrl: remoteOasisToolsUrl,
              oasisMcpUrl: remoteOasisMcpUrl,
            },
          ))
          child.stdin.end()
        } catch (error) {
          emit({
            type: 'error',
            message: error instanceof Error ? error.message : 'Unable to start Hermes native chat.',
          })
          emit({ type: 'done', finishReason: 'error' })
          closeStream()
        }
      },
    })

    return new Response(stream, { headers: makeSseHeaders() })
  }

  const model = config.defaultModel || 'hermes'

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(`${config.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        messages: buildMessages(history, prompt, config.systemPrompt, runtimeContext),
      }),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Hermes upstream request failed.' },
      { status: 502 }
    )
  }

  if (!upstreamResponse.ok) {
    return NextResponse.json(
      {
        error: `Hermes upstream returned HTTP ${upstreamResponse.status}.`,
        detail: await readErrorText(upstreamResponse),
      },
      { status: 502 }
    )
  }

  if (!upstreamResponse.body) {
    return NextResponse.json({ error: 'Hermes upstream returned no stream body.' }, { status: 502 })
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const upstreamReader = upstreamResponse.body.getReader()

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = ''

      const emit = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(serializeSse(payload)))
      }

      emit({
        type: 'meta',
        model,
        upstream: config.apiBase,
        sessionMode: 'compat',
        ...(worldId ? { worldId } : {}),
      })

      try {
        while (true) {
          const { done, value } = await upstreamReader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const { payloads, remainder } = getSsePayloads(buffer)
          buffer = remainder

          for (const payload of payloads) {
            if (payload === '[DONE]') {
              emit({ type: 'done' })
              continue
            }

            try {
              const parsed = JSON.parse(payload) as Record<string, unknown>
              if (parsed.error && typeof parsed.error === 'object') {
                const error = parsed.error as { message?: unknown }
                emit({ type: 'error', message: typeof error.message === 'string' ? error.message : 'Hermes upstream error.' })
                continue
              }

              const choice = Array.isArray(parsed.choices) ? parsed.choices[0] as Record<string, unknown> | undefined : undefined
              const delta = (choice?.delta as Record<string, unknown> | undefined) || {}

              const content = extractText(delta.content)
              if (content) emit({ type: 'text', content })

              const reasoning = extractText(delta.reasoning ?? delta.reasoning_content ?? parsed.reasoning)
              if (reasoning) emit({ type: 'reasoning', content: reasoning })

              const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
              toolCalls.forEach((call, index) => {
                if (!call || typeof call !== 'object') return
                const toolCall = call as {
                  index?: unknown
                  id?: unknown
                  function?: { name?: unknown; arguments?: unknown }
                }

                emit({
                  type: 'tool',
                  index: typeof toolCall.index === 'number' ? toolCall.index : index,
                  id: typeof toolCall.id === 'string' ? toolCall.id : undefined,
                  name: typeof toolCall.function?.name === 'string' ? toolCall.function.name : undefined,
                  argumentsChunk: extractText(toolCall.function?.arguments),
                })
              })

              const usage = parsed.usage && typeof parsed.usage === 'object'
                ? parsed.usage as Record<string, unknown>
                : null

              if (usage) {
                emit({
                  type: 'usage',
                  promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
                  completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
                  totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
                })
              }

              if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
                emit({ type: 'done', finishReason: choice.finish_reason })
              }
            } catch {
              // Skip malformed upstream chunks.
            }
          }
        }
      } catch (error) {
        emit({
          type: 'error',
          message: error instanceof Error ? error.message : 'Hermes stream parsing failed.',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: makeSseHeaders() })
}
