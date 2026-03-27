// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SHARED RENDERING — markdown, tool cards, collapsible blocks
// ─═̷─═̷─ॐ─═̷─═̷─ Extracted for reuse across AnorakContent + AnorakProPanel ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { useState } from 'react'
import { MediaBubble, type MediaType } from '../components/forge/MediaBubble'

// Trusted media URL patterns for auto-detection
const MEDIA_URL_RE = /((?:https?:\/\/(?:localhost|127\.0\.0\.1|fal\.media|fal-cdn\.|oaidalleapiprodscus\.|replicate\.delivery)[^\s]+)|(?:\/generated-(?:images|voices|videos)\/[^\s]+))/i

function detectMediaType(url: string): MediaType | null {
  if (/\/generated-images\/|\.(?:png|jpg|jpeg|gif|webp)(?:\?|$)/i.test(url)) return 'image'
  if (/\/generated-voices\/|\.(?:mp3|wav|ogg)(?:\?|$)/i.test(url)) return 'audio'
  if (/\/generated-videos\/|\.(?:mp4|webm)(?:\?|$)/i.test(url)) return 'video'
  return null
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLAPSIBLE BLOCK — for thinking + tool results
// ═══════════════════════════════════════════════════════════════════════════

export function CollapsibleBlock({
  label,
  icon,
  content,
  defaultOpen = false,
  accentColor = 'rgba(56,189,248,0.5)',
  isError = false,
  compact = false,
}: {
  label: string
  icon: string
  content: string
  defaultOpen?: boolean
  accentColor?: string
  isError?: boolean
  compact?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const borderColor = isError ? 'rgba(239,68,68,0.4)' : accentColor
  const textSize = compact ? 'text-[10px]' : 'text-[11px]'
  const labelSize = compact ? 'text-[8px]' : 'text-[9px]'

  return (
    <div
      className="rounded-lg overflow-hidden transition-all"
      style={{
        border: `1px solid ${borderColor}`,
        background: isError ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.02)',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 ${textSize} font-mono cursor-pointer hover:bg-white/5 transition-colors select-none`}
      >
        <span className={`${labelSize} transition-transform`} style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        <span>{icon}</span>
        <span className="truncate" style={{ color: isError ? '#ef4444' : '#94a3b8' }}>{label}</span>
        {content.length > 200 && (
          <span className={`ml-auto ${labelSize} text-gray-600`}>{content.length} chars</span>
        )}
      </button>
      {open && (
        <div
          className={`px-3 py-2 ${textSize} font-mono whitespace-pre-wrap break-all border-t max-h-[300px] overflow-y-auto`}
          style={{
            borderColor,
            color: isError ? '#fca5a5' : '#cbd5e1',
            background: 'rgba(0,0,0,0.3)',
            scrollbarWidth: 'thin',
            scrollbarColor: '#374151 transparent',
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL CALL CARD — expandable with input details
// ═══════════════════════════════════════════════════════════════════════════

export function ToolCallCard({
  name,
  icon,
  display,
  input,
  result,
  compact = false,
}: {
  name: string
  icon: string
  display: string
  input?: Record<string, unknown>
  result?: { preview: string; isError: boolean; length: number; fullResult?: string }
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = input && Object.keys(input).length > 0
  const isFileOp = ['Read', 'Edit', 'Write'].includes(name)
  const filePath = input?.file_path as string | undefined
  const textSize = compact ? 'text-[10px]' : 'text-[11px]'
  const detailSize = compact ? 'text-[9px]' : 'text-[10px]'

  return (
    <div className="rounded-lg overflow-hidden" style={{
      border: `1px solid ${result ? (result.isError ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)') : 'rgba(56,189,248,0.3)'}`,
      background: result ? (result.isError ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)') : 'rgba(56,189,248,0.05)',
    }}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 ${textSize} font-mono transition-colors select-none ${hasDetails ? 'cursor-pointer hover:bg-white/5' : ''}`}
      >
        <span>{icon}</span>
        <span className="font-bold" style={{
          color: result ? (result.isError ? '#ef4444' : '#22c55e') : '#38bdf8',
        }}>{name}</span>
        {isFileOp && filePath && (
          <span className="text-gray-400 truncate flex-1 min-w-0">{String(filePath).split(/[/\\]/).slice(-2).join('/')}</span>
        )}
        {!isFileOp && (
          <span className="text-gray-500 truncate flex-1 min-w-0">{display.replace(`${name}: `, '')}</span>
        )}
        {result && !result.isError && <span className="ml-auto text-green-500">✓</span>}
        {result && result.isError && <span className="ml-auto text-red-400 text-[10px]">✗</span>}
        {!result && (
          <span className="ml-auto w-3 h-3 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
        )}
        {hasDetails && (
          <span className="text-[9px] text-gray-600 ml-1">{expanded ? '▼' : '▶'}</span>
        )}
      </button>

      {/* Expanded input */}
      {expanded && hasDetails && (
        <div className={`px-3 py-2 ${detailSize} font-mono text-gray-400 border-t border-white/5 max-h-[200px] overflow-y-auto whitespace-pre-wrap`}
          style={{ background: 'rgba(0,0,0,0.3)', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}
        >
          {name === 'Edit' && input?.old_string && input?.new_string ? (
            <>
              <div className="text-red-400/70 mb-1">- {String(input.old_string)}</div>
              <div className="text-green-400/70">+ {String(input.new_string)}</div>
            </>
          ) : name === 'Bash' && input?.command ? (
            <span className="text-amber-300">$ {String(input.command)}</span>
          ) : name === 'TodoWrite' && input?.todos ? (
            <div className="space-y-0.5">
              {(input.todos as Array<{ content: string; status: string }>).map((todo, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className={
                    todo.status === 'completed' ? 'text-green-400'
                    : todo.status === 'in_progress' ? 'text-amber-400'
                    : 'text-gray-600'
                  }>
                    {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○'}
                  </span>
                  <span className={
                    todo.status === 'completed' ? 'text-green-400/70 line-through'
                    : todo.status === 'in_progress' ? 'text-amber-300'
                    : 'text-gray-400'
                  }>
                    {todo.content}
                  </span>
                </div>
              ))}
            </div>
          ) : name === 'Grep' && input?.pattern ? (
            <span className="text-cyan-300">/{String(input.pattern)}/ <span className="text-gray-500">in {String(input.path || '.')}</span></span>
          ) : name === 'Glob' && input?.pattern ? (
            <span className="text-cyan-300">{String(input.pattern)}</span>
          ) : name === 'Read' && input?.file_path ? (
            <span className="text-blue-300">{String(input.file_path)}{input.offset ? ` :${input.offset}` : ''}{input.limit ? `-${Number(input.offset || 0) + Number(input.limit)}` : ''}</span>
          ) : name === 'Write' && input?.file_path ? (
            <>
              <div className="text-blue-300 mb-1">{String(input.file_path)}</div>
              {input.content && <div className="text-green-400/50 max-h-[100px] overflow-hidden">{String(input.content).substring(0, 500)}</div>}
            </>
          ) : name === 'Agent' && input?.prompt ? (
            <>
              {input.description && <div className="text-purple-300 mb-1">{String(input.description)}</div>}
              <div className="text-gray-400">{String(input.prompt).substring(0, 300)}{String(input.prompt).length > 300 ? '...' : ''}</div>
            </>
          ) : (
            JSON.stringify(input, null, 2)
          )}
        </div>
      )}

      {/* Tool result */}
      {expanded && result && result.preview && (
        <div
          className={`px-3 py-2 ${detailSize} font-mono border-t border-white/5 max-h-[200px] overflow-y-auto whitespace-pre-wrap`}
          style={{
            color: result.isError ? '#fca5a5' : '#94a3b8',
            background: 'rgba(0,0,0,0.2)',
            scrollbarWidth: 'thin',
            scrollbarColor: '#374151 transparent',
          }}
        >
          {result.fullResult || result.preview}
          {result.length > 2000 && !result.fullResult && (
            <span className="text-gray-600"> ... ({result.length} chars total)</span>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// LIGHTWEIGHT MARKDOWN — no deps, handles Claude's common output patterns
// ═══════════════════════════════════════════════════════════════════════════

export function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const codeIdx = remaining.indexOf('`')
    const boldIdx = remaining.indexOf('**')

    if (codeIdx === -1 && boldIdx === -1) {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }

    const codeFirst = codeIdx !== -1 && (boldIdx === -1 || codeIdx < boldIdx)
    const boldFirst = boldIdx !== -1 && (codeIdx === -1 || boldIdx < codeIdx)

    if (codeFirst) {
      const closeIdx = remaining.indexOf('`', codeIdx + 1)
      if (closeIdx === -1) {
        parts.push(<span key={key++}>{remaining}</span>)
        break
      }
      if (codeIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, codeIdx)}</span>)
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded text-sky-300" style={{ background: 'rgba(56,189,248,0.1)' }}>
          {remaining.slice(codeIdx + 1, closeIdx)}
        </code>
      )
      remaining = remaining.slice(closeIdx + 1)
    } else if (boldFirst) {
      const closeIdx = remaining.indexOf('**', boldIdx + 2)
      if (closeIdx === -1) {
        parts.push(<span key={key++}>{remaining}</span>)
        break
      }
      if (boldIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, boldIdx)}</span>)
      parts.push(<strong key={key++} className="text-white font-semibold">{remaining.slice(boldIdx + 2, closeIdx)}</strong>)
      remaining = remaining.slice(closeIdx + 2)
    } else {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }
  }

  return <>{parts}</>
}

export function renderMarkdownLine(line: string, idx: number): React.ReactNode {
  if (line.startsWith('### ')) return <div key={idx} className="text-sky-300 font-bold mt-2 mb-0.5">{line.slice(4)}</div>
  if (line.startsWith('## ')) return <div key={idx} className="text-sky-300 font-bold text-[13px] mt-2 mb-0.5">{line.slice(3)}</div>
  if (line.startsWith('# ')) return <div key={idx} className="text-sky-200 font-bold text-sm mt-3 mb-1">{line.slice(2)}</div>
  if (/^[-*] /.test(line)) return <div key={idx} className="pl-3">• {renderInline(line.slice(2))}</div>
  if (/^\d+\. /.test(line)) return <div key={idx} className="pl-3">{renderInline(line)}</div>
  if (/^---+$/.test(line.trim())) return <hr key={idx} className="border-white/10 my-2" />
  if (line.trim() === '') return <div key={idx} className="h-1" />
  // Auto-detect media URLs in text
  const mediaMatch = line.match(MEDIA_URL_RE)
  if (mediaMatch) {
    const mt = detectMediaType(mediaMatch[0])
    if (mt) {
      const rest = line.replace(mediaMatch[0], '').trim()
      return (
        <div key={idx}>
          {rest && <div>{renderInline(rest)}</div>}
          <MediaBubble url={mediaMatch[0]} mediaType={mt} />
        </div>
      )
    }
  }
  return <div key={idx}>{renderInline(line)}</div>
}

export function renderMarkdown(content: string): React.ReactNode {
  const lines = content.split('\n')
  const result: React.ReactNode[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeLang = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
        codeLines = []
      } else {
        result.push(
          <div key={`code-${i}`} className="rounded-lg overflow-hidden my-1" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(56,189,248,0.15)' }}>
            {codeLang && <div className="text-[9px] text-gray-600 px-2 py-0.5 border-b border-white/5">{codeLang}</div>}
            <pre className="px-2 py-1.5 text-[11px] overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
              <code className="text-emerald-300/80">{codeLines.join('\n')}</code>
            </pre>
          </div>
        )
        inCodeBlock = false
        codeLines = []
        codeLang = ''
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // Table detection
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[i + 1].trim())) {
      const tableLines: string[] = [line]
      let j = i + 1
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        tableLines.push(lines[j])
        j++
      }
      const parseRow = (row: string) => row.split('|').slice(1, -1).map(c => c.trim())
      const headers = parseRow(tableLines[0])
      const rows = tableLines.slice(2).map(parseRow)
      result.push(
        <div key={`table-${i}`} className="my-1 overflow-x-auto rounded-lg" style={{ border: '1px solid rgba(56,189,248,0.15)', scrollbarWidth: 'thin' }}>
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr style={{ background: 'rgba(56,189,248,0.08)' }}>
                {headers.map((h, hi) => (
                  <th key={hi} className="px-2 py-1 text-left text-sky-300 font-bold border-b border-white/10">{renderInline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.1)' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1 text-gray-400 border-b border-white/5">{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      i = j - 1
      continue
    }

    result.push(renderMarkdownLine(line, i))
  }

  // Unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    result.push(
      <div key="code-unclosed" className="rounded-lg overflow-hidden my-1" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(56,189,248,0.15)' }}>
        {codeLang && <div className="text-[9px] text-gray-600 px-2 py-0.5 border-b border-white/5">{codeLang}</div>}
        <pre className="px-2 py-1.5 text-[11px] overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          <code className="text-emerald-300/80">{codeLines.join('\n')}</code>
        </pre>
      </div>
    )
  }

  return <>{result}</>
}
