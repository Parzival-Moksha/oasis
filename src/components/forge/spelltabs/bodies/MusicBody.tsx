// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MUSIC BODY — Text-to-music generation panel body
// ─═̷─ Used by both the Wizard Console's Music tab and the standalone
// Text-to-Music spelltab. Hits POST /api/media/music (ElevenLabs Music API).
// Maintains a local "in-flight" list and a gallery sourced from /api/media/list
// (audio entries) so generated MP3s show up next to anything else uploaded.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useCallback, useEffect, useState } from 'react'
import { CollapsibleSection, scrollIntoViewOnFocus } from '../SpellTabFrame'
import { useOasisStore } from '@/store/oasisStore'
import { buildAudioPlacementPending } from '../../../../lib/forge/placement-builders'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// ElevenLabs Music API current public model. Single option for now — future
// models can land here without changing the spelltab callsites.
const MUSIC_MODELS = [
  { key: 'music_v1', label: 'ElevenLabs Music v1', desc: 'Default text-to-music engine' },
] as const

const DURATIONS = [
  { ms: 10000, label: '10s' },
  { ms: 20000, label: '20s' },
  { ms: 30000, label: '30s' },
  { ms: 60000, label: '60s' },
  { ms: 120000, label: '2 min' },
] as const

interface InFlightMusic {
  id: string
  prompt: string
  durationMs: number
  instrumental: boolean
  startedAt: number
  error?: string
}

interface GeneratedMusic {
  id: string
  prompt: string
  url: string
  durationMs: number
  instrumental: boolean
  createdAt: string
}

interface MediaListItem {
  name: string
  url: string
  type: 'image' | 'video' | 'audio'
  size: number
  createdAt: string
}

const STORAGE_KEY = 'oasis-music-spelltab-history'

function readHistory(): GeneratedMusic[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, 50) : []
  } catch { return [] }
}

function writeHistory(items: GeneratedMusic[]) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50))) } catch {}
}

export interface MusicBodyProps {
  /** When true, defaults open both sections (NEW + GALLERY). */
  defaultExpandNew?: boolean
  defaultExpandGallery?: boolean
}

export function MusicBody({ defaultExpandNew = true, defaultExpandGallery = true }: MusicBodyProps) {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string>(MUSIC_MODELS[0].key)
  const [durationMs, setDurationMs] = useState<number>(30000)
  const [instrumental, setInstrumental] = useState(false)
  const [inFlight, setInFlight] = useState<InFlightMusic[]>([])
  const [history, setHistory] = useState<GeneratedMusic[]>(() => readHistory())
  const [uploaded, setUploaded] = useState<MediaListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expandNew, setExpandNew] = useState(defaultExpandNew)
  const [expandGallery, setExpandGallery] = useState(defaultExpandGallery)
  const enterPlacementMode = useOasisStore(s => s.enterPlacementMode)

  // ── Fetch uploaded audio so the gallery shows previously-uploaded MP3s too
  const fetchUploaded = useCallback(async () => {
    try {
      const res = await fetch(`${OASIS_BASE}/api/media/list`)
      if (!res.ok) return
      const data = await res.json()
      const items: MediaListItem[] = Array.isArray(data.items) ? data.items : []
      setUploaded(items.filter(it => it.type === 'audio'))
    } catch {}
  }, [])

  useEffect(() => { fetchUploaded() }, [fetchUploaded])

  const handleGenerate = useCallback(async () => {
    const text = prompt.trim()
    if (!text) return
    const flightId = `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setInFlight(prev => [
      ...prev,
      { id: flightId, prompt: text, durationMs, instrumental, startedAt: Date.now() },
    ])
    setPrompt('')
    setError(null)
    try {
      const res = await fetch(`${OASIS_BASE}/api/media/music`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, durationMs, instrumental, model }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Music generation failed' })) as { error?: string; detail?: string; hint?: string; cause?: string }
        // Compose a rich error so the player sees WHY it failed (e.g. DNS,
        // missing API key, fal/elevenlabs outage) instead of a generic
        // "Music generation failed."
        const parts = [data.error || `Error ${res.status}`]
        if (data.detail) parts.push(data.detail)
        if (data.hint) parts.push(`Hint: ${data.hint}`)
        else if (data.cause) parts.push(`(${data.cause})`)
        const msg = parts.join(' — ')
        setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: msg } : f))
        setError(msg)
        return
      }
      const data = await res.json()
      const entry: GeneratedMusic = {
        id: flightId,
        prompt: text,
        url: data.url,
        durationMs: data.durationMs ?? durationMs,
        instrumental: data.instrumental ?? instrumental,
        createdAt: new Date().toISOString(),
      }
      setHistory(prev => {
        const next = [entry, ...prev].slice(0, 50)
        writeHistory(next)
        return next
      })
      setInFlight(prev => prev.filter(f => f.id !== flightId))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Music generation failed'
      setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: msg } : f))
      setError(msg)
    }
  }, [prompt, durationMs, instrumental, model])

  const handleDelete = useCallback((id: string) => {
    setHistory(prev => {
      const next = prev.filter(h => h.id !== id)
      writeHistory(next)
      return next
    })
  }, [])

  const placeAudioTrack = useCallback((track: GeneratedMusic) => {
    enterPlacementMode(buildAudioPlacementPending({
      name: track.prompt.slice(0, 30) || 'Music speaker',
      defaultScale: 1,
      audioUrl: track.url,
    }))
  }, [enterPlacementMode])

  // Merge history + previously-uploaded audio (de-duplicated by URL).
  const galleryEntries = [
    ...history,
    ...uploaded
      .filter(u => !history.some(h => h.url === u.url))
      .map<GeneratedMusic>(u => ({
        id: u.url,
        prompt: u.name,
        url: u.url,
        durationMs: 0,
        instrumental: false,
        createdAt: u.createdAt,
      })),
  ]

  return (
    <div className="space-y-2">
      <CollapsibleSection
        label="New Music"
        accentColor="#A78BFA"
        expanded={expandNew}
        onToggle={() => setExpandNew(e => !e)}
        rightSlot={`${MUSIC_MODELS.find(m => m.key === model)?.label || model} / ${(durationMs / 1000).toFixed(0)}s`}
      >
        <style>{`
          @keyframes oasisMusicBars {
            0%, 100% { transform: scaleY(0.35); opacity: 0.45; }
            50% { transform: scaleY(1); opacity: 1; }
          }
        `}</style>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="text-[10px] bg-black/60 border border-purple-500/30 rounded px-2 py-1 text-purple-200 font-mono focus:outline-none focus:border-purple-400/60 cursor-pointer"
          >
            {MUSIC_MODELS.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <select
            value={durationMs}
            onChange={e => setDurationMs(parseInt(e.target.value, 10))}
            className="text-[10px] bg-black/60 border border-purple-500/30 rounded px-2 py-1 text-purple-200 font-mono focus:outline-none focus:border-purple-400/60 cursor-pointer"
            title="Track length"
          >
            {DURATIONS.map(d => (
              <option key={d.ms} value={d.ms}>{d.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[10px] text-purple-300/80 font-mono cursor-pointer">
            <input
              type="checkbox"
              checked={instrumental}
              onChange={e => setInstrumental(e.target.checked)}
              className="w-3 h-3 rounded accent-purple-500"
            />
            Instrumental
          </label>
        </div>

        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onFocus={scrollIntoViewOnFocus}
          rows={3}
          placeholder="describe the music... e.g. 'slow lo-fi beats over ambient pads, raindrops, melancholy'"
          className="w-full text-xs bg-black/60 border border-purple-500/30 rounded-lg px-3 py-2 text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-purple-400/60 font-mono"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] text-purple-400/60 font-mono">
            ElevenLabs Music API · ~{(durationMs / 1000).toFixed(0)}s output
          </span>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, rgba(167, 139, 250, 0.3), rgba(139, 92, 246, 0.3))',
              color: '#C4B5FD',
              border: '1px solid rgba(167, 139, 250, 0.4)',
            }}
          >
            {inFlight.length > 0 ? `Generating (${inFlight.length})` : 'Generate 🎵'}
          </button>
        </div>

        {error && (
          <div className="text-[10px] text-red-400 font-mono">{error}</div>
        )}

        {inFlight.length > 0 && (
          <div className="space-y-1.5">
            {inFlight.map(f => (
              <div
                key={f.id}
                className="rounded-md border border-purple-500/20 bg-black/40 px-2.5 py-1.5 flex items-center gap-2"
              >
                {f.error ? (
                  <>
                    <span className="text-red-400 text-sm">{'✕'}</span>
                    <span className="text-[10px] text-red-400 font-mono flex-1 truncate">{f.error}</span>
                    <button
                      onClick={() => setInFlight(prev => prev.filter(x => x.id !== f.id))}
                      className="text-[9px] text-gray-400 hover:text-gray-200 font-mono"
                    >dismiss</button>
                  </>
                ) : (
                  <>
                    <span className="flex h-5 items-end gap-0.5" aria-hidden="true">
                      {[0, 1, 2, 3].map(i => (
                        <span
                          key={i}
                          className="block h-4 w-1 rounded-full bg-purple-300"
                          style={{ animation: `oasisMusicBars 680ms ease-in-out ${i * 90}ms infinite` }}
                        />
                      ))}
                    </span>
                    <span className="text-[10px] text-purple-300 font-mono flex-1 truncate">{f.prompt}</span>
                    <span className="text-[9px] text-purple-400/60 font-mono">
                      generating {(f.durationMs / 1000).toFixed(0)}s
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        label={`Gallery (${galleryEntries.length})`}
        accentColor="#A78BFA"
        expanded={expandGallery}
        onToggle={() => setExpandGallery(e => !e)}
      >
        {galleryEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-gray-400">
            <div className="text-2xl mb-1">{'\u{1F3B5}'}</div>
            <div className="text-xs">No music generated yet</div>
            <div className="text-[10px] mt-1 text-gray-500">Describe a vibe and hit Generate</div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {galleryEntries.map(track => (
              <div
                key={track.id}
                className="rounded-md border border-purple-500/20 bg-black/40 px-2.5 py-1.5"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] text-purple-200 font-mono truncate" title={track.prompt}>
                    {track.prompt}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => placeAudioTrack(track)}
                      className="rounded border border-purple-300/35 bg-purple-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-purple-100 hover:border-purple-200/60 hover:bg-purple-300/20"
                      title="Place this track on a speaker"
                    >
                      Place
                    </button>
                    {history.some(h => h.id === track.id) && (
                      <button
                        onClick={() => handleDelete(track.id)}
                        className="text-[10px] text-gray-500 hover:text-red-400"
                        title="Forget from history"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                </div>
                <audio controls preload="none" src={track.url} className="w-full" style={{ height: 32 }} />
                <div className="text-[9px] text-gray-500 font-mono mt-0.5">
                  {new Date(track.createdAt).toLocaleString()}
                  {track.durationMs > 0 && ` · ${(track.durationMs / 1000).toFixed(0)}s`}
                  {track.instrumental && ' · instrumental'}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}
