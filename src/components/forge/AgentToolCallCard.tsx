'use client'

import { useMemo, useState } from 'react'

import { MediaBubble, type MediaType } from './MediaBubble'

export interface AgentToolMediaReference {
  path: string
  mediaType: MediaType
}

export interface AgentToolCallCardProps {
  name: string
  label?: string
  icon?: string
  summary?: string
  input?: Record<string, unknown> | string | null
  result?: {
    ok?: boolean
    message?: string
    detail?: string | null
  }
  media?: AgentToolMediaReference[]
  autoPlayAudio?: boolean
  audioTargetAvatarId?: string | null
  showResultMessage?: boolean
  mediaCompact?: boolean
}

function stringifyToolPayload(payload: Record<string, unknown> | string | null | undefined): string {
  if (!payload) return ''
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

export function AgentToolCallCard({
  name,
  label = name,
  icon = '🔧',
  summary = '',
  input,
  result,
  media = [],
  autoPlayAudio = false,
  audioTargetAvatarId = null,
  showResultMessage = false,
  mediaCompact = true,
}: AgentToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const inputText = useMemo(() => stringifyToolPayload(input), [input])
  const resultText = result?.detail ?? result?.message ?? ''
  const hasDetails = Boolean(inputText || resultText)
  const status = result?.ok
  const canExpand = hasDetails

  const accent = status === true
    ? {
        border: 'rgba(34,197,94,0.3)',
        background: 'rgba(34,197,94,0.08)',
        text: '#22c55e',
      }
    : status === false
      ? {
          border: 'rgba(239,68,68,0.3)',
          background: 'rgba(239,68,68,0.08)',
          text: '#ef4444',
        }
      : {
          border: 'rgba(168,85,247,0.3)',
          background: 'rgba(168,85,247,0.08)',
          text: '#a855f7',
        }

  return (
    <div className="space-y-1">
      <div
        className="rounded-lg overflow-hidden"
        style={{
          border: `1px solid ${accent.border}`,
          background: accent.background,
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (canExpand) setExpanded(current => !current)
          }}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono transition-colors ${canExpand ? 'cursor-pointer hover:bg-white/5' : 'cursor-default'}`}
        >
          <span className="text-sm">{icon}</span>
          <span style={{ color: accent.text }}>{label}</span>
          {summary && (
            <span className="text-gray-400 truncate min-w-0 flex-1">{summary}</span>
          )}
          {status === true && <span className="ml-auto text-green-500">✓</span>}
          {status === false && <span className="ml-auto text-red-400 text-[10px]">✕</span>}
          {status === undefined && (
            <span className="ml-auto w-3 h-3 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />
          )}
          {canExpand && (
            <span className="text-[9px] text-gray-500">{expanded ? '▼' : '▶'}</span>
          )}
        </button>

        {expanded && inputText && (
          <div
            className="px-3 py-2 text-[10px] font-mono text-slate-300 whitespace-pre-wrap break-all border-t border-white/5 max-h-[220px] overflow-y-auto"
            style={{ background: 'rgba(0,0,0,0.3)', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}
          >
            {inputText}
          </div>
        )}

        {expanded && resultText && (
          <div
            className="px-3 py-2 text-[10px] font-mono whitespace-pre-wrap break-all border-t border-white/5 max-h-[220px] overflow-y-auto"
            style={{
              color: status === false ? '#fca5a5' : '#cbd5e1',
              background: 'rgba(0,0,0,0.22)',
              scrollbarWidth: 'thin',
              scrollbarColor: '#374151 transparent',
            }}
          >
            {resultText}
          </div>
        )}
      </div>

      {showResultMessage && result?.message && (
        <div className="px-2.5 text-[10px] font-mono text-gray-400">
          {result.message}
        </div>
      )}

      {media.length > 0 && (
        <div className="space-y-1 pl-2">
          {(() => {
            let audioConsumed = false
            return media.map((entry, index) => {
              const shouldAutoPlay = entry.mediaType === 'audio' && autoPlayAudio && !audioConsumed
              if (shouldAutoPlay) audioConsumed = true
              return (
                <MediaBubble
                  key={`${name}-media-${index}-${entry.path}`}
                  url={entry.path}
                  mediaType={entry.mediaType}
                  prompt={`${label} ${entry.mediaType}`}
                  compact={mediaCompact}
                  autoPlay={shouldAutoPlay}
                  avatarLipSyncTargetId={entry.mediaType === 'audio' ? audioTargetAvatarId || undefined : undefined}
                />
              )
            })
          })()}
        </div>
      )}
    </div>
  )
}
