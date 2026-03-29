export const dynamic = 'force-dynamic'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK SESSIONS — List + load Claude Code session transcripts
// GET /api/claude-code/sessions         → list all sessions
// GET /api/claude-code/sessions?id=xxx  → load conversation history
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

// Claude Code stores sessions as JSONL files in ~/.claude/projects/<project-hash>/
function getProjectSessionDir(): string {
  // The project hash for af_oasis is "C--af-oasis" (drive letter + path with dashes)
  return join(homedir(), '.claude', 'projects', 'C--af-oasis')
}

interface SessionSummary {
  id: string
  label: string
  timestamp: string
  turnCount: number
  fileSize: number
}

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  tools?: { name: string; input?: string }[]
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('id')

  if (sessionId) {
    return loadSessionHistory(sessionId)
  }
  return listSessions()
}

async function listSessions(): Promise<NextResponse> {
  const dir = getProjectSessionDir()

  try {
    const files = await readdir(dir)
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))

    const sessions: SessionSummary[] = []

    for (const file of jsonlFiles) {
      const filePath = join(dir, file)
      const id = file.replace('.jsonl', '')

      try {
        const fileStat = await stat(filePath)
        const content = await readFile(filePath, 'utf-8')
        const lines = content.split('\n').filter(l => l.trim())

        let turnCount = 0
        let firstTimestamp = ''
        let lastTimestamp = ''
        let label = ''

        for (const line of lines) {
          try {
            const obj = JSON.parse(line)
            if (!firstTimestamp && obj.timestamp) firstTimestamp = obj.timestamp
            if (obj.timestamp) lastTimestamp = obj.timestamp

            if (obj.type === 'user') {
              turnCount++
              // Get label from first real user message (skip system preamble)
              if (!label) {
                const msg = obj.message
                const text = extractText(msg)
                if (text && !text.startsWith('You are Claude Code')) {
                  label = text
                }
              }
            }
          } catch { /* skip malformed lines */ }
        }

        // Date-based fallback label (same format as Anorak Pro: "Mar 28 21:15")
        const sessionDate = new Date(lastTimestamp || firstTimestamp || fileStat.mtime.toISOString())
        const dateFallback = sessionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
          sessionDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        sessions.push({
          id,
          label: label || dateFallback,
          timestamp: lastTimestamp || firstTimestamp,
          turnCount,
          fileSize: fileStat.size,
        })
      } catch { /* skip unreadable files */ }
    }

    // Sort by timestamp, most recent first
    sessions.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))

    return NextResponse.json({ sessions })
  } catch (err) {
    return NextResponse.json({ sessions: [], error: String(err) })
  }
}

async function loadSessionHistory(sessionId: string): Promise<NextResponse> {
  // Sanitize sessionId to prevent path traversal
  if (!/^[a-f0-9-]+$/i.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 })
  }

  const filePath = join(getProjectSessionDir(), `${sessionId}.jsonl`)

  try {
    const content = await readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim())

    const messages: ConversationMessage[] = []
    let lastAssistantContent: unknown[] = []

    for (const line of lines) {
      try {
        const obj = JSON.parse(line)

        if (obj.type === 'user') {
          const text = extractText(obj.message)
          if (text && !text.startsWith('You are Claude Code')) {
            messages.push({
              role: 'user',
              content: text,
              timestamp: obj.timestamp,
            })
          }
        }

        if (obj.type === 'assistant') {
          const msg = obj.message || {}
          const contentBlocks = msg.content || []

          // Claude sends complete snapshots — diff to find what's new
          // But for history loading, we just want the final state of each assistant turn
          // A new user message resets the assistant accumulation
          lastAssistantContent = contentBlocks
        }

        // When we see a user message after assistant content, flush the assistant turn
        if (obj.type === 'user' && lastAssistantContent.length > 0) {
          const assistantMsg = buildAssistantMessage(lastAssistantContent)
          if (assistantMsg.content || (assistantMsg.tools && assistantMsg.tools.length > 0)) {
            // Insert before the user message we just added
            messages.splice(messages.length - 1, 0, {
              ...assistantMsg,
              timestamp: obj.timestamp,
            })
          }
          lastAssistantContent = []
        }

        // Result events contain cost info
        if (obj.type === 'result') {
          // Attach to last assistant message
          const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
          if (lastAssistant) {
            lastAssistant.costUsd = obj.total_cost_usd || obj.costUsd
            lastAssistant.inputTokens = obj.total_input_tokens || obj.inputTokens
            lastAssistant.outputTokens = obj.total_output_tokens || obj.outputTokens
          }
        }
      } catch { /* skip malformed */ }
    }

    // Flush any remaining assistant content
    if (lastAssistantContent.length > 0) {
      const assistantMsg = buildAssistantMessage(lastAssistantContent)
      if (assistantMsg.content || (assistantMsg.tools && assistantMsg.tools.length > 0)) {
        messages.push(assistantMsg)
      }
    }

    return NextResponse.json({ sessionId, messages })
  } catch (err) {
    return NextResponse.json({ error: `Session not found: ${err}` }, { status: 404 })
  }
}

function extractText(msg: unknown): string {
  if (!msg) return ''
  if (typeof msg === 'string') return msg

  const content = (msg as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block && (block as Record<string, unknown>).type === 'text') {
        return ((block as Record<string, unknown>).text as string) || ''
      }
    }
  }
  return ''
}

function buildAssistantMessage(contentBlocks: unknown[]): ConversationMessage {
  let text = ''
  const tools: { name: string; input?: string }[] = []

  for (const block of contentBlocks) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>

    if (b.type === 'text') {
      text += (b.text as string) || ''
    } else if (b.type === 'tool_use') {
      tools.push({
        name: (b.name as string) || 'tool',
        input: b.input ? JSON.stringify(b.input) : undefined,
      })
    }
    // Skip thinking blocks for history view — too verbose
  }

  return { role: 'assistant', content: text, tools: tools.length > 0 ? tools : undefined }
}
