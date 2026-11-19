'use client'

// ░▒▓ AGENT SESSION VIEW — the one renderer for engine schema v1 ▓▒░
// Mounted in the 2D session panel and in each desk's 3D window. Shows text, tool cards, todos,
// subagents, turn outcomes, the context meter and permission / question / plan cards.

import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { effectiveStatus, selectHistoryCursor, type AgentLogEntry, type EngineAgentState } from '../../store/slices/agentEngineSlice'
import { DecisionCard } from './DecisionCards'
import { ToolCallCard, renderMarkdown } from '../../lib/anorak-renderers'
import { TOOL_ICONS_MAP } from '../../lib/anorak-engine'
import {
  VILLAGE_STATUS_COLOR,
  formatCost,
  formatTokens,
  modelLabel,
  statusColor,
  VILLAGE_FONT_BODY,
  VILLAGE_FONT_DISPLAY,
  VILLAGE_TYPE_CLASS,
} from './village-status'
import { openVillageImages, toggleVillageScreen } from './village-actions'
import { agentEngineFileUrl } from '../../lib/agent-engine-client'
import { groupThread, threadImages, toolRunShape, type ThreadItem } from '../../lib/village/village-thread'
import { hasInjectedText, parseInjectedUserText, type TaskNotice } from '../../lib/village/village-injected'
import { getOlderHistoryState, loadOlderHistory, noteThreadScroll, retryOlderHistory, subscribeOlderHistory } from './village-history'
import { formatMessageTime, fullMessageTime } from '../../lib/village/message-time'
import { hideSpokenLive, splitSpoken } from '../../lib/village/village-spoken'
import { SpokenAgentContext, SpokenReply } from './CompanionToggles'
import { AgentSettingsButton } from './AgentSettingsMenu'
import { VoiceClip } from './VoiceMessage'
import { attachmentKind, downloadInPlace } from '../../lib/village/attachment-kind'
import { openMdReader } from '../../lib/village/md-reader'
import { showNotice as noticeForFiles } from '../forge/GlobalNotice'

/** 2d: the side panel · 3d: the desk window (recent lines) · screen: the desk window zoomed in with F */

/**
 * Tool cards and markdown come from the shared Anorak renderers, tuned for its darker, denser panels.
 * In the village thread their gray text is lifted so it reads on the glass (the owner: "way too gray").
 */
const BRIGHT_GRAYS = '[&_.text-gray-400]:text-slate-200 [&_.text-gray-500]:text-slate-300 [&_.text-gray-600]:text-slate-400'

export type SessionViewVariant = '2d' | '3d' | 'screen'

// ─── small pieces ───────────────────────────────────────────────────────────

export function ContextMeter({ agent, compact = false }: { agent: EngineAgentState; compact?: boolean }) {
  const ctx = agent.context
  const percent = ctx?.percent ?? null
  const color = percent === null ? '#64748b' : percent >= 85 ? '#ef4444' : percent >= 60 ? '#f59e0b' : '#22c55e'
  return (
    <div className="flex min-w-0 items-center gap-2" title={ctx ? `${ctx.usedTokens ?? '?'} / ${ctx.maxTokens ?? '?'} tokens` : 'context unknown until the first turn'}>
      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-white/65">ctx</span>
      <div className={`relative h-1.5 ${compact ? 'w-16' : 'w-24'} shrink-0 overflow-hidden rounded-full bg-white/10`}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, Math.max(percent ?? 0, percent ? 2 : 0))}%`, background: color }} />
      </div>
      <span className="truncate text-[10px] tabular-nums text-white/75">
        {ctx ? `${formatTokens(ctx.usedTokens)}${ctx.maxTokens ? ` / ${formatTokens(ctx.maxTokens)}` : ''}${percent !== null ? ` · ${percent}%` : ''}` : 'n/a'}
      </span>
    </div>
  )
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const color = statusColor(status)
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
      style={{ background: `${color}26`, color, border: `1px solid ${color}66` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      {label || status}
    </span>
  )
}

/** Plain text with fenced code blocks; no markdown dependency needed in the 3D windows. */
function RichText({ text, className = '' }: { text: string; className?: string }) {
  const parts = useMemo(() => text.split(/```[a-zA-Z0-9_-]*\n?/), [text])
  return (
    <div className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, index) => (index % 2 === 1
        ? <pre key={index} className="my-1 overflow-x-auto rounded bg-black/50 px-2 py-1 font-mono text-[11px] leading-snug text-emerald-100/90">{part.replace(/\n$/, '')}</pre>
        : <span key={index}>{part}</span>))}
    </div>
  )
}

/** Opens a picture of this thread in the full-screen viewer, which steps through all of the thread's pictures. */
const ThreadImagesContext = createContext<(fileId: string, name: string) => void>((fileId, name) => {
  openVillageImages([{ url: agentEngineFileUrl(fileId), name }], 0)
})

/** A Read of a picture: the picture itself, under the open card. */
function ReadImages({ files }: { files: Array<{ id: string; name: string }> }) {
  const openImage = useContext(ThreadImagesContext)
  return (
    <div className="flex flex-wrap gap-2">
      {files.map(file => (
        <button
          key={file.id}
          type="button"
          onClick={() => openImage(file.id, file.name)}
          title={`${file.name} · open`}
          className="overflow-hidden rounded-md border border-white/15 transition-transform duration-300 hover:scale-[1.02] hover:border-cyan-300/60"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the local engine, not optimizable */}
          <img src={agentEngineFileUrl(file.id)} alt={file.name} loading="lazy" className="block max-h-[220px] max-w-full object-contain" />
        </button>
      ))}
    </div>
  )
}

/** Screenshots inside a tool card open in the viewer too. */
function openCaptures(urls: string[], index: number): void {
  openVillageImages(urls.map((url, i) => ({ url, name: `capture ${i + 1}` })), index)
}

// ─── what Claude Code injects on the user side: quiet pills, not raw XML ────

/** A background subagent or command finished: one line, opening to what it reported. */
function TaskPill({ task }: { task: TaskNotice }) {
  const [open, setOpen] = useState(false)
  const tone = task.failed ? 'border-rose-300/30 bg-rose-500/10 text-rose-100' : 'border-violet-300/30 bg-violet-500/10 text-violet-50'
  return (
    <div className={`rounded-lg border ${tone}`}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-white/5"
        title={open ? 'Fold it up' : 'What it reported'}
      >
        <span aria-hidden className="mt-[3px] text-[9px] text-white/60">{open ? '▼' : '▶'}</span>
        <span aria-hidden>{task.failed ? '✗' : '✓'}</span>
        <span className="min-w-0 flex-1 break-words font-semibold">{task.label}</span>
      </button>
      {open && task.body && (
        <div className="border-t border-white/10 px-2.5 py-2 text-[12.5px] leading-relaxed text-slate-100">
          <Markdown text={task.body} />
        </div>
      )}
    </div>
  )
}

/** <system-reminder> blocks added to a message: folded away, one quiet line. */
function ReminderPill({ reminders }: { reminders: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[10.5px] text-white/55">
      <button type="button" onClick={() => setOpen(value => !value)} className="hover:text-white/80">
        {open ? '▼' : '▶'} {reminders.length === 1 ? 'a system note' : `${reminders.length} system notes`} came with this message
      </button>
      {open && reminders.map((reminder, i) => (
        <pre key={i} className="mt-1 max-h-[240px] overflow-y-auto whitespace-pre-wrap break-words rounded bg-black/30 px-2 py-1 text-[10.5px] text-white/70">{reminder}</pre>
      ))}
    </div>
  )
}

/** Claude's markdown (headings, lists, bold, code, tables), the same renderer as Anorak Pro's window. */
function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const rendered = useMemo(() => renderMarkdown(text), [text])
  return <div className={`break-words ${className}`}>{rendered}</div>
}

function Clip({ text, limit, className = '' }: { text: string; limit: number; className?: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > limit
  return (
    <div className={className}>
      <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-snug text-white/80">{open || !long ? text : `${text.slice(0, limit)}…`}</pre>
      {long && (
        <button type="button" className="mt-0.5 text-[10px] text-sky-300 hover:text-sky-200" onClick={() => setOpen(v => !v)}>
          {open ? 'less' : `more (${text.length} chars)`}
        </button>
      )}
    </div>
  )
}

// ─── log entries ────────────────────────────────────────────────────────────

function userStateLabel(entry: Extract<AgentLogEntry, { type: 'user' }>): string {
  switch (entry.state) {
    case 'queued': return 'sent mid-turn, waiting for a tool boundary'
    case 'folded': return 'folded into the running turn'
    case 'taken': return entry.midTurn ? 'ran as the next turn' : ''
    default: return ''
  }
}

function formatBytes(n: number | null): string {
  if (n === null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * SendUserFile: a little postcard. Pictures as tilted polaroids (click for full size), sound as a player in the
 * thread (play, pause, scrub, speed), video as a tile that plays in the full-screen viewer, other files as chips
 * that download in place. Nothing navigates the Oasis tab to the file (a cross-origin link did: it replaced the
 * Oasis with the browser's bare player, owner 2026-11-17).
 */
function SentFilesCard({ entry, compact }: { entry: Extract<AgentLogEntry, { type: 'tool' }>; compact: boolean }) {
  const openImage = useContext(ThreadImagesContext)
  const files = entry.attachments || []
  const caption = typeof entry.input?.caption === 'string' ? entry.input.caption.trim() : ''
  const images = files.filter(file => file.isImage)
  const sounds = files.filter(file => attachmentKind(file) === 'audio')
  const videos = files.filter(file => attachmentKind(file) === 'video')
  const texts = files.filter(file => attachmentKind(file) === 'text')
  const others = files.filter(file => attachmentKind(file) === 'file')
  const what = images.length && !others.length && !texts.length
    ? `${images.length === 1 ? 'a picture' : `${images.length} pictures`}`
    : `${files.length === 1 ? 'a file' : `${files.length} files`}`
  return (
    <div className="rounded-2xl p-[1.5px]" style={{ background: 'linear-gradient(135deg, #22d3ee, #a78bfa 55%, #f472b6)' }}>
      <div className="rounded-[14px] bg-slate-950/90 px-3 py-2.5">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200/80">
          <span aria-hidden>📬</span>
          <span>{entry.status === 'running' ? 'sending you something…' : `sent you ${what}`}</span>
        </div>
        {images.length > 0 && (
          <div className={`flex flex-wrap gap-3 px-1 pb-1 ${images.length === 1 ? 'justify-center' : ''}`}>
            {images.map((file, i) => {
              const url = agentEngineFileUrl(file.id)
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => openImage(file.id, file.name)}
                  title={`${file.name} · open full size`}
                  className={`block rounded-md bg-white p-1.5 pb-1 text-left shadow-[0_8px_22px_rgba(34,211,238,0.28)] transition-transform duration-300 hover:z-10 hover:rotate-0 hover:scale-[1.03] ${i % 2 ? 'rotate-1' : '-rotate-1'}`}
                  style={{ width: images.length === 1 ? '100%' : compact ? 128 : 'calc(50% - 8px)' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by the local engine, not optimizable */}
                  <img src={url} alt={file.name} loading="lazy" className="block w-full rounded-sm object-cover" style={{ maxHeight: compact ? 130 : 280 }} />
                  <div className="mt-1 truncate text-center text-[9px] text-slate-500">{file.name}</div>
                </button>
              )
            })}
          </div>
        )}
        {sounds.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {sounds.map(file => <VoiceClip key={file.id} fileId={file.id} name={file.name} sizeLabel={file.size !== null ? formatBytes(file.size) : undefined} />)}
          </div>
        )}
        {videos.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {videos.map(file => (
              <button
                key={file.id}
                type="button"
                data-video-attachment
                onClick={() => openVillageImages([{ url: agentEngineFileUrl(file.id), name: file.name, kind: 'video' }], 0)}
                title={`${file.name} · play`}
                className="group relative block overflow-hidden rounded-md border border-cyan-300/30 bg-black"
                style={{ width: compact ? 128 : 200 }}
              >
                <video src={`${agentEngineFileUrl(file.id)}#t=0.5`} muted preload="metadata" playsInline className="block w-full object-cover opacity-80" style={{ maxHeight: compact ? 80 : 120 }} />
                <span className="absolute inset-0 flex items-center justify-center text-[28px] text-white/90 drop-shadow transition group-hover:scale-110">▶</span>
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white/85">{file.name}</span>
              </button>
            ))}
          </div>
        )}
        {texts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {texts.map(file => (
              <span key={file.id} className="inline-flex overflow-hidden rounded-full border border-cyan-300/30 bg-cyan-400/10 text-[11px] text-cyan-100">
                <button
                  type="button"
                  data-text-attachment
                  onClick={() => openMdReader({ fileId: file.id, name: file.name })}
                  title={`${file.name} · read it here (and edit)`}
                  className="px-2.5 py-1 hover:bg-cyan-400/20"
                >
                  📖 {file.name}{file.size !== null ? ` · ${formatBytes(file.size)}` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => { void downloadInPlace(agentEngineFileUrl(file.id), file.name).catch(error => noticeForFiles(`${file.name}: ${error instanceof Error ? error.message : String(error)}`, 'warn')) }}
                  title={`Download ${file.name}`}
                  aria-label={`Download ${file.name}`}
                  className="border-l border-cyan-300/25 px-2 py-1 hover:bg-cyan-400/20"
                >
                  ⬇
                </button>
              </span>
            ))}
          </div>
        )}
        {others.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {others.map(file => (
              <button
                key={file.id}
                type="button"
                onClick={() => { void downloadInPlace(agentEngineFileUrl(file.id), file.name).catch(error => noticeForFiles(`${file.name}: ${error instanceof Error ? error.message : String(error)}`, 'warn')) }}
                title={`Download ${file.name}`}
                className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100 hover:bg-cyan-400/20"
              >
                📄 {file.name}{file.size !== null ? ` · ${formatBytes(file.size)}` : ''}
              </button>
            ))}
          </div>
        )}
        {caption && (
          <div
            className="mt-2.5 text-center text-[13px] italic leading-snug text-pink-100/90"
            style={{ fontFamily: '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", cursive' }}
          >
            {compact && caption.length > 160 ? `${caption.slice(0, 160)}…` : caption}
          </div>
        )}
      </div>
    </div>
  )
}

/** When a message was written (E side panel and F screen; the desk screens stay clean). */
function MessageTime({ ts }: { ts: number }) {
  const label = formatMessageTime(ts)
  if (!label) return null
  return <span className="shrink-0 font-mono text-[9.5px] font-normal normal-case tracking-normal text-white/45" title={fullMessageTime(ts)}>{label}</span>
}

/** Pictures the owner pasted or dropped with a message: small thumbnails in the bubble, full size on click. */
function UserPictures({ images, compact }: { images: Array<{ fileId: string; name?: string }>; compact: boolean }) {
  const openImage = useContext(ThreadImagesContext)
  return (
    <div className="mb-1 flex flex-wrap gap-1.5">
      {images.map(image => (
        <button
          key={image.fileId}
          type="button"
          onClick={() => openImage(image.fileId, image.name || 'picture')}
          title={`${image.name || 'picture'} · open full size`}
          className="block overflow-hidden rounded-md border border-white/20 bg-black/30 transition hover:border-white/60"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the local engine, not optimizable */}
          <img src={agentEngineFileUrl(image.fileId)} alt={image.name || 'picture'} loading="lazy" className="block object-cover" style={{ height: compact ? 44 : 72, maxWidth: compact ? 80 : 140 }} />
        </button>
      ))}
    </div>
  )
}

const LogEntryView = memo(function LogEntryView({ entry, compact }: { entry: AgentLogEntry; compact: boolean }) {
  const dim = entry.history ? 'opacity-90' : ''
  switch (entry.type) {
    case 'session':
      return (
        <div className={`text-[10px] uppercase tracking-[0.14em] text-white/60 ${dim}`}>
          {entry.observed ? 'observing read-only' : `session · ${entry.model || 'default model'}${entry.permissionMode ? ` · ${entry.permissionMode}` : ''}`}
        </div>
      )
    case 'user': {
      const state = userStateLabel(entry)
      // Task notifications and system reminders are Claude Code talking, not the owner: pills, not a prompt.
      const injected = hasInjectedText(entry.text) ? parseInjectedUserText(entry.text) : null
      const text = injected ? injected.text : entry.text
      return (
        <div className={`flex flex-col gap-1.5 ${dim}`}>
          {(text || (entry.images && entry.images.length > 0)) && (
            <div className="ml-6 rounded-lg border border-sky-300/20 bg-sky-400/10 px-2.5 py-1.5">
              <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-sky-200/90">
                {/* A wake-up from its schedule is the engine speaking, not the owner: a tag says so (engine schedule.js). */}
                <span>
                  {entry.scheduled
                    ? <span data-thread-scheduled title={`Sent by the agent's schedule: ${entry.scheduled}`} className="rounded bg-amber-300/20 px-1 text-amber-100">scheduled</span>
                    : entry.engineNote
                    ? <span data-thread-engine-note title="The engine's carry-on note (after an engine restart, or on another Claude account), not your words" className="rounded bg-white/15 px-1 text-white/80">engine</span>
                    : entry.state === 'seen' ? 'prompt' : 'you'}
                  {state ? ` · ${state}` : ''}{entry.priority === 'now' ? ' · urgent' : ''}
                </span>
                {!compact && <MessageTime ts={entry.ts} />}
              </div>
              {entry.voice && !compact && <VoiceClip fileId={entry.voice.fileId} durationMs={entry.voice.durationMs} />}
              {entry.images && entry.images.length > 0 && <UserPictures images={entry.images} compact={compact} />}
              {text && <RichText text={compact && text.length > 280 ? `${text.slice(0, 280)}…` : text} className="text-[12.5px] text-slate-50" />}
            </div>
          )}
          {injected && injected.reminders.length > 0 && <div className="ml-6"><ReminderPill reminders={injected.reminders} /></div>}
          {injected?.tasks.map((task, i) => <TaskPill key={`${task.taskId || 'task'}-${i}`} task={task} />)}
        </div>
      )
    }
    case 'text': {
      // A voiced agent's reply ends with <spoken>…</spoken>: the tag is hidden, the line gets a play button.
      const said = splitSpoken(entry.text)
      return (
        <div className={`${entry.parentToolUseId ? 'ml-3 border-l border-violet-300/30 pl-2 text-slate-200' : 'text-slate-100'} text-[12.5px] leading-relaxed ${dim}`}>
          {entry.parentToolUseId && <span className="mr-1 text-[9px] font-black uppercase tracking-[0.12em] text-violet-200/90">subagent</span>}
          {!compact && !entry.parentToolUseId && <div className="-mb-0.5 text-right"><MessageTime ts={entry.ts} /></div>}
          <Markdown text={compact && said.text.length > 600 ? `${said.text.slice(0, 600)}…` : said.text} />
          {said.spoken && !compact && !entry.parentToolUseId && <SpokenReply spoken={said.spoken} />}
        </div>
      )
    }
    case 'tool':
      if (entry.name === 'SendUserFile' && entry.status !== 'error' && (entry.attachments?.length || entry.status === 'running')) {
        return (
          <div className={`${entry.parentToolUseId ? 'ml-3' : ''} ${dim}`}>
            <SentFilesCard entry={entry} compact={compact} />
          </div>
        )
      }
      {
        // A Read of a picture: the picture instead of "[image]".
        const pictures = (entry.attachments || []).filter(file => file.isImage)
        const output = pictures.length && (entry.output || '').trim() === '[image]' ? '' : entry.output || ''
        return (
          <div className={`${entry.parentToolUseId ? 'ml-3' : ''} ${dim}`}>
            <ToolCallCard
              name={entry.name}
              icon={TOOL_ICONS_MAP[entry.name] || (entry.name.startsWith('mcp__') ? '🔌' : '🔧')}
              display={entry.summary || entry.name}
              input={entry.input}
              result={entry.status === 'running' ? undefined : {
                preview: output,
                isError: entry.status === 'error',
                length: output.length,
                fullResult: output,
              }}
              compact={compact}
              suppressMedia
              bright
              extra={pictures.length ? <ReadImages files={pictures} /> : undefined}
              onImageClick={openCaptures}
            />
          </div>
        )
      }
    case 'subagent':
      return (
        <div className={`rounded-md border border-violet-300/30 bg-violet-500/10 px-2 py-1 ${dim}`}>
          <div className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-200">
            subagent · {entry.subagentType || 'agent'} · {entry.status}{entry.lastToolName && entry.status === 'running' ? ` · ${entry.lastToolName}` : ''}
          </div>
          <div className="text-[12px] text-slate-100">{entry.description}</div>
          {!compact && entry.summary && <Clip text={entry.summary} limit={240} className="mt-0.5" />}
        </div>
      )
    case 'decision':
      return (
        <div className={`rounded-md border border-amber-300/25 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-100 ${dim}`}>
          {entry.requestKind === 'question' ? 'asked' : entry.requestKind === 'plan' ? 'plan' : 'permission'} · {entry.summary || entry.toolName}
          <span className="ml-1 text-white/70">
            {entry.readOnly ? '(seen via hook; answer where it runs)' : entry.resolved ? `-> ${entry.resolved}` : '-> waiting for you'}
          </span>
        </div>
      )
    case 'turn': {
      const color = entry.outcome === 'error' ? VILLAGE_STATUS_COLOR.error : entry.outcome === 'needs-decision' ? VILLAGE_STATUS_COLOR['needs-decision'] : VILLAGE_STATUS_COLOR.waiting
      const bits = [
        entry.costUsd ? formatCost(entry.costUsd) : null,
        entry.durationMs !== null ? `${(entry.durationMs / 1000).toFixed(1)}s` : null,
        entry.numTurns ? `${entry.numTurns} step${entry.numTurns === 1 ? '' : 's'}` : null,
        entry.contextTokens !== null ? `ctx ${formatTokens(entry.contextTokens)}${entry.contextWindow ? `/${formatTokens(entry.contextWindow)}` : ''}` : null,
      ].filter(Boolean)
      return (
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t pt-1 text-[10.5px] ${dim}`} style={{ borderColor: `${color}55` }}>
          <span className="font-black uppercase tracking-[0.12em]" style={{ color }}>
            {entry.outcome === 'done-waiting' ? 'turn done' : entry.outcome === 'needs-decision' ? 'needs you' : entry.outcome}
          </span>
          {entry.reason && entry.reason !== 'end_turn' && <span className="text-white/70">{entry.reason}</span>}
          {bits.length > 0 && <span className="text-white/65">{bits.join(' · ')}</span>}
        </div>
      )
    }
    case 'notice': {
      const color = entry.level === 'error' ? 'text-rose-200' : entry.level === 'warn' ? 'text-amber-200' : 'text-white/65'
      return <div className={`text-[10.5px] italic ${color} ${dim}`}>{entry.text}</div>
    }
    default:
      return null
  }
})

// ─── lists ──────────────────────────────────────────────────────────────────

function TodoList({ agent, compact }: { agent: EngineAgentState; compact: boolean }) {
  if (!agent.todos.length) return null
  const done = agent.todos.filter(todo => todo.status === 'completed').length
  const shown = compact ? agent.todos.filter(todo => todo.status !== 'completed').slice(0, 4) : agent.todos
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5">
      <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.16em] text-white/70">
        <span>todos</span>
        <span className="tabular-nums">{done}/{agent.todos.length}</span>
      </div>
      {shown.map((todo, index) => (
        <div key={`${todo.content}-${index}`} className={`flex gap-1.5 text-[11.5px] leading-snug ${todo.status === 'completed' ? 'text-white/55 line-through' : todo.status === 'in_progress' ? 'text-emerald-100' : 'text-slate-200'}`}>
          <span className="shrink-0 font-mono text-[10px]">{todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[>]' : '[ ]'}</span>
          <span>{todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}</span>
        </div>
      ))}
    </div>
  )
}

function SubagentList({ agent, compact }: { agent: EngineAgentState; compact: boolean }) {
  const running = agent.subagents.filter(s => s.status === 'running')
  const list = compact ? running : agent.subagents.slice(-6)
  if (!list.length) return null
  return (
    <div className="rounded-lg border border-violet-300/20 bg-violet-500/5 px-2.5 py-1.5">
      <div className="mb-1 text-[9px] font-black uppercase tracking-[0.16em] text-violet-200/90">
        subagents{running.length ? ` · ${running.length} running` : ''}
      </div>
      {list.map(sub => (
        <div key={sub.key} className="flex items-center gap-1.5 text-[11.5px] text-slate-100">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: sub.status === 'running' ? '#a78bfa' : sub.status === 'failed' ? '#f87171' : '#64748b' }} />
          <span className="truncate">{sub.description}</span>
          <span className="shrink-0 text-[10px] text-white/65">{sub.subagentType}{sub.status === 'running' && sub.lastToolName ? ` · ${sub.lastToolName}` : sub.status !== 'running' ? ` · ${sub.status}` : ''}</span>
        </div>
      ))}
    </div>
  )
}

// ─── the view ───────────────────────────────────────────────────────────────

export interface AgentSessionViewProps {
  agentId: string
  variant: SessionViewVariant
  /** Rendered above the feed in the 3D window (the 2D panel has its own header). */
  header?: ReactNode
}

/** A finished run of tool calls, folded into one row; a little taller with more calls (stacked cards, last calls). */
function ToolRunRow({ item, compact }: { item: Extract<ThreadItem, { kind: 'tools' }>; compact: boolean }) {
  const [open, setOpen] = useState(false)
  const calls = item.entries.length
  const failedNote = item.failed ? <span className="shrink-0 text-rose-300">· {item.failed} failed</span> : null
  if (open) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-1.5">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 rounded px-1 text-left text-[11.5px] text-slate-100 hover:bg-white/5"
        >
          <span aria-hidden className="text-[9px] text-white/60">▼</span>
          <span className="min-w-0 flex-1 break-words font-semibold">{item.summary}</span>
          {failedNote}
        </button>
        {item.entries.map(entry => <LogEntryView key={entry.key} entry={entry} compact={compact} />)}
      </div>
    )
  }
  const shape = toolRunShape(calls)
  const preview = shape.previewLines ? item.entries.slice(-shape.previewLines) : []
  const dim = item.entries.every(entry => entry.history) ? 'opacity-90' : ''
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title={`${calls} tool call${calls === 1 ? '' : 's'}: click to see them`}
      className={`relative block w-full text-left ${dim}`}
      style={{ paddingTop: shape.stackLayers * 4 }}
    >
      {Array.from({ length: shape.stackLayers }, (_, i) => {
        const depth = shape.stackLayers - i // the farthest card peeks out the most
        return (
          <span
            key={depth}
            aria-hidden
            className="absolute h-6 rounded-lg border border-white/10 bg-slate-800/60"
            style={{ top: i * 4, left: depth * 6, right: depth * 6 }}
          />
        )
      })}
      <span className="relative block rounded-lg border border-white/15 bg-slate-900/85 px-2.5 py-1.5 transition hover:border-white/30 hover:bg-slate-800/90">
        <span className="flex items-start gap-2 text-[11.5px]">
          <span aria-hidden className="text-[9px] text-white/60">▶</span>
          <span className="min-w-0 flex-1 break-words font-semibold text-slate-100">{item.summary}</span>
          {failedNote}
        </span>
        {preview.map(entry => (
          <span key={entry.key} className="mt-0.5 block truncate pl-4 font-mono text-[10.5px] leading-[14px] text-white/65">
            {entry.summary || entry.name}
          </span>
        ))}
      </span>
    </button>
  )
}

/** The top of a long thread: older history loading, an error to retry, or the start of the session. */
function HistoryTop({ agentId, start }: { agentId: string; start: boolean }) {
  const state = useSyncExternalStore(subscribeOlderHistory, () => getOlderHistoryState(agentId), () => getOlderHistoryState(agentId))
  if (state.error) {
    return (
      <button type="button" onClick={() => retryOlderHistory(agentId)} className="py-1 text-center text-[10.5px] text-amber-200 hover:text-amber-100">
        Older history: {state.error} (click to retry)
      </button>
    )
  }
  if (state.loading) return <div className="py-1 text-center text-[10.5px] text-white/65">loading older history…</div>
  if (!start) return null
  return (
    <div className="flex items-center gap-2 py-1 text-[9.5px] font-black uppercase tracking-[0.16em] text-white/55">
      <span className="h-px flex-1 bg-white/15" />
      start of the session
      <span className="h-px flex-1 bg-white/15" />
    </div>
  )
}

/** Within this many pixels of the top, the next older piece loads. */
const LOAD_OLDER_MARGIN_PX = 320

/** One subagent's work alone (its mini avatar was clicked): a header naming it and the way back. */
function SubagentHeader({ agent, subagent }: { agent: EngineAgentState; subagent: EngineAgentState['subagents'][number] }) {
  const back = () => useOasisStore.getState().agentEngineDispatch({ type: 'subagent/focus', agentId: null })
  const running = subagent.status === 'running'
  return (
    <div className="flex shrink-0 items-start gap-2 rounded-lg border border-violet-300/30 bg-violet-500/10 px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-[9.5px] font-black uppercase tracking-[0.14em] text-violet-200">
          subagent · {subagent.subagentType || 'agent'} · {subagent.status}{running && subagent.lastToolName ? ` · ${subagent.lastToolName}` : ''}
        </div>
        <div className="break-words text-[13px] font-semibold text-slate-50" style={{ fontFamily: VILLAGE_FONT_DISPLAY }}>{subagent.description || 'subagent'}</div>
      </div>
      <button
        type="button"
        onClick={back}
        className="shrink-0 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[11px] font-bold text-white/90 transition hover:bg-white/20"
      >
        ← back to {agent.name}
      </button>
    </div>
  )
}

export function AgentSessionView({ agentId, variant, header }: AgentSessionViewProps) {
  const agent = useOasisStore(s => s.agentEngine.agents[agentId])
  const focusedSubagent = useOasisStore(s => s.agentEngine.focusedSubagent)
  const compact = variant === '3d'
  const log = agent?.log
  // The village's subagent mini avatars: clicking one shows only that subagent's work in its parent's panel.
  const subagent = !compact && agent && focusedSubagent?.agentId === agentId
    ? agent.subagents.find(sub => sub.key === focusedSubagent.key) || null
    : null
  const subagentId = subagent ? subagent.toolUseId || subagent.key : null
  const items = useMemo(() => {
    if (!log) return []
    if (subagentId) {
      // Its own text counts as "the last text" here, so its finished tool runs fold like the main thread's.
      const own = log.filter(entry => (entry.type === 'text' || entry.type === 'tool') && entry.parentToolUseId === subagentId)
      return groupThread(own.map(entry => ({ ...entry, parentToolUseId: null })))
    }
    // The desk window shows the recent conversation; the side panel and the screen show all of it.
    const grouped = groupThread(compact ? log.slice(-60) : log)
    return compact ? grouped.slice(-10) : grouped
  }, [log, compact, subagentId])
  const canLoadOlder = Boolean(agent && !compact && !subagentId && selectHistoryCursor(agent))
  const openImage = useCallback((fileId: string, name: string) => {
    const images = threadImages(useOasisStore.getState().agentEngine.agents[agentId]?.log || [])
    const index = images.findIndex(image => image.id === fileId)
    const list = index === -1 ? [{ id: fileId, name }] : images
    openVillageImages(list.map(image => ({ url: agentEngineFileUrl(image.id), name: image.name })), Math.max(0, index))
  }, [agentId])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scrolled near the top: load the piece before. The list is column-reverse, so what is added above leaves the view
  // where it is (scrollTop counts from the bottom).
  const maybeLoadOlder = useCallback(() => {
    const el = scrollRef.current
    if (!el || !canLoadOlder) return
    const fromTop = el.scrollHeight - el.clientHeight + el.scrollTop
    const short = el.scrollHeight <= el.clientHeight + 40
    if (short || fromTop < LOAD_OLDER_MARGIN_PX) void loadOlderHistory(agentId)
  }, [agentId, canLoadOlder])
  // A thread too short to scroll fills itself up from the past (and finds the start of the session).
  const historyFrom = agent?.historyFrom ?? null
  useEffect(() => { maybeLoadOlder() }, [maybeLoadOlder, items.length, historyFrom])
  // A piece of older history just landed above. Chrome aims a smooth (wheel) scroll at a point counted from the top,
  // so a scroll still running would carry on up through everything that landed, to the top of the new text (and load
  // the next piece, and fly through that too). Stop it where the view is: setting scrollTop cancels the animation.
  const landedFromRef = useRef(historyFrom)
  useLayoutEffect(() => {
    if (landedFromRef.current === historyFrom) return
    landedFromRef.current = historyFrom
    const el = scrollRef.current
    if (el && historyFrom !== null) el.scrollTop = el.scrollTop // eslint-disable-line no-self-assign
  }, [historyFrom])

  if (!agent) return null
  const decisions = agent.owned ? agent.decisions : []

  return (
    <ThreadImagesContext.Provider value={openImage}>
    <SpokenAgentContext.Provider value={agent.id}>
    <div className={`flex h-full min-h-0 flex-col gap-2 ${VILLAGE_TYPE_CLASS}`} style={{ fontFamily: VILLAGE_FONT_BODY }}>
      {header}
      {subagent && <SubagentHeader agent={agent} subagent={subagent} />}
      {compact && decisions[0] && <DecisionCard agentId={agent.id} decision={decisions[0]} compact />}
      <div className="flex shrink-0 flex-col gap-1.5">
        {!compact && <ContextMeter agent={agent} />}
        <TodoList agent={agent} compact={compact} />
        <SubagentList agent={agent} compact={compact} />
      </div>
      {/* column-reverse keeps the view pinned to the newest line without measuring on every
          streamed delta; scrolling up still works and is not yanked back. */}
      <div
        ref={scrollRef}
        data-village-thread
        // Every scroll is noted: a piece of older history waits until the thread is still (village-history.ts). Not
        // wheel events: at the top the wheel moves nothing, and the next piece should land then.
        onScroll={compact ? undefined : () => { noteThreadScroll(agentId); maybeLoadOlder() }}
        className={`flex min-h-0 flex-1 flex-col-reverse overflow-y-auto pr-1 [scrollbar-width:thin] ${BRIGHT_GRAYS}`}
      >
      <div className="flex flex-col gap-1.5">
        {!compact && !subagent && <HistoryTop agentId={agent.id} start={agent.historyStart} />}
        {items.length === 0 && (subagent || !agent.live) && (
          <div className="py-3 text-center text-[11px] text-white/60">
            {subagent ? 'Nothing from this subagent in the thread yet.' : agent.owned || agent.bridged ? 'No messages yet. Say hello.' : 'Waiting for the session to do something.'}
          </div>
        )}
        {items.map(item => (item.kind === 'tools'
          ? <ToolRunRow key={item.key} item={item} compact={compact} />
          : <LogEntryView key={item.key} entry={item.entry} compact={compact} />))}
        {!subagent && agent.live?.text && (
          <div className="text-[12.5px] leading-relaxed text-slate-100">
            <Markdown text={compact && agent.live.text.length > 600 ? `…${hideSpokenLive(agent.live.text).slice(-600)}` : hideSpokenLive(agent.live.text)} />
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-emerald-300/80 align-middle" />
          </div>
        )}
        {!compact && decisions.map(decision => <DecisionCard key={decision.requestId} agentId={agent.id} decision={decision} compact={false} />)}
      </div>
      </div>
    </div>
    </SpokenAgentContext.Provider>
    </ThreadImagesContext.Provider>
  )
}

/** Compact header for the 3D window (name, status, model, context, cost). */
export function SessionWindowHeader({ agent, nearby, screen = false }: { agent: EngineAgentState; nearby: boolean; screen?: boolean }) {
  const status = effectiveStatus(agent)
  const color = statusColor(status)
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b pb-1.5" style={{ borderColor: `${color}55` }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {screen && (
            <button
              type="button"
              onClick={() => toggleVillageScreen()}
              title="Back to the side panel (F or Esc)"
              className="shrink-0 rounded-md border border-white/20 bg-white/10 px-2 py-0.5 font-mono text-[11px] font-bold text-white/80 hover:bg-white/20"
            >
              ← F
            </button>
          )}
          <span className={`truncate font-bold tracking-wide text-white ${screen ? 'text-[19px]' : 'text-[16px]'}`} style={{ fontFamily: VILLAGE_FONT_DISPLAY }}>{agent.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusPill status={status} label={status === 'needs-decision' ? 'needs you' : status} />
          {/* The agent's settings (voice, speed, avatar, colour) on its full screen too. */}
          {screen && <AgentSettingsButton agent={agent} large />}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-white/70">
        <span className="truncate">{agent.readOnly ? `${agent.kind} · read-only` : modelLabel(agent)}{agent.statusReason ? ` · ${agent.statusReason}` : ''}</span>
        {nearby ? <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 font-mono font-bold text-white">T talk</span> : <ContextMeter agent={agent} compact />}
      </div>
    </div>
  )
}
