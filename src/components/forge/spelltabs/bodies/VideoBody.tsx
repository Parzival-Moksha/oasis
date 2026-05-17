// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// VIDEO BODY — Text-to-video generation panel body
// ─═̷─ POST /api/media/video → queue request → poll status until COMPLETED.
// fal.ai's LTX-2.3 family is wired today. Defaults to "LTX 2.3 fast" (image-to-
// video fast). Text-to-video always routes to the standard LTX-2.3 path because
// the fast endpoint requires an image_url; the toggle is exposed so callers can
// switch to the fast path once they paste an image URL. ─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CollapsibleSection, scrollIntoViewOnFocus } from '../SpellTabFrame'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

// "LTX 2.3 fast" is the headline option per spec — others left as the family.
const VIDEO_MODELS = [
  { key: 'ltx-2.3-fast', label: 'LTX 2.3 fast', fast: true, desc: 'fal.ai LTX-2.3 fast (image-to-video)' },
  { key: 'ltx-2.3', label: 'LTX 2.3', fast: false, desc: 'fal.ai LTX-2.3 (text-to-video / image-to-video)' },
] as const

const DURATIONS = [6, 8, 10, 12, 14, 16, 18, 20] as const
const RESOLUTIONS = ['720p', '1080p'] as const
const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const

interface InFlightVideo {
  id: string
  prompt: string
  model: string
  duration: number
  startedAt: number
  requestId?: string
  endpoint?: string
  error?: string
  pollTimer?: ReturnType<typeof setTimeout>
}

interface GeneratedVideo {
  id: string
  prompt: string
  url: string
  model: string
  duration: number
  createdAt: string
}

interface MediaListItem {
  name: string
  url: string
  type: 'image' | 'video' | 'audio'
  size: number
  createdAt: string
}

const STORAGE_KEY = 'oasis-video-spelltab-history'

function readHistory(): GeneratedVideo[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, 30) : []
  } catch { return [] }
}

function writeHistory(items: GeneratedVideo[]) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 30))) } catch {}
}

export interface VideoBodyProps {
  defaultExpandNew?: boolean
  defaultExpandGallery?: boolean
}

export function VideoBody({ defaultExpandNew = true, defaultExpandGallery = true }: VideoBodyProps) {
  const [prompt, setPrompt] = useState('')
  // Spec: default to "LTX 2.3 fast"
  const [model, setModel] = useState<string>('ltx-2.3-fast')
  const [duration, setDuration] = useState<number>(6)
  const [resolution, setResolution] = useState<string>('720p')
  const [aspectRatio, setAspectRatio] = useState<string>('16:9')
  const [imageUrl, setImageUrl] = useState('')
  const [inFlight, setInFlight] = useState<InFlightVideo[]>([])
  const [history, setHistory] = useState<GeneratedVideo[]>(() => readHistory())
  const [uploaded, setUploaded] = useState<MediaListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expandNew, setExpandNew] = useState(defaultExpandNew)
  const [expandGallery, setExpandGallery] = useState(defaultExpandGallery)

  const pollersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // ── Fetch uploaded videos for the gallery
  const fetchUploaded = useCallback(async () => {
    try {
      const res = await fetch(`${OASIS_BASE}/api/media/list`)
      if (!res.ok) return
      const data = await res.json()
      const items: MediaListItem[] = Array.isArray(data.items) ? data.items : []
      setUploaded(items.filter(it => it.type === 'video'))
    } catch {}
  }, [])

  useEffect(() => { fetchUploaded() }, [fetchUploaded])

  // ── Stop polling on unmount
  useEffect(() => {
    return () => {
      pollersRef.current.forEach(timer => clearTimeout(timer))
      pollersRef.current.clear()
    }
  }, [])

  const pollVideoStatus = useCallback((flightId: string, requestId: string, endpoint: string, prompt: string, modelKey: string, duration: number) => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${OASIS_BASE}/api/media/video?requestId=${encodeURIComponent(requestId)}&endpoint=${encodeURIComponent(endpoint)}`)
        const data = await res.json().catch(() => null)
        if (!data) {
          // retry
          pollVideoStatus(flightId, requestId, endpoint, prompt, modelKey, duration)
          return
        }
        if (data.status === 'completed' && data.url) {
          const entry: GeneratedVideo = {
            id: flightId,
            prompt,
            url: data.url,
            model: modelKey,
            duration,
            createdAt: new Date().toISOString(),
          }
          setHistory(prev => {
            const next = [entry, ...prev].slice(0, 30)
            writeHistory(next)
            return next
          })
          setInFlight(prev => prev.filter(f => f.id !== flightId))
          pollersRef.current.delete(flightId)
          return
        }
        if (data.status === 'failed') {
          setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: data.error || 'Provider failed' } : f))
          pollersRef.current.delete(flightId)
          return
        }
        // still processing — poll again
        pollVideoStatus(flightId, requestId, endpoint, prompt, modelKey, duration)
      } catch (err) {
        // best-effort retry once, then bail
        setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: (err as Error).message } : f))
        pollersRef.current.delete(flightId)
      }
    }, 5000)
    pollersRef.current.set(flightId, timer)
  }, [])

  const handleGenerate = useCallback(async () => {
    const text = prompt.trim()
    if (!text) return
    const flightId = `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const modelDef = VIDEO_MODELS.find(m => m.key === model) || VIDEO_MODELS[1]
    const wantsFast = modelDef.fast && imageUrl.trim().length > 0
    setInFlight(prev => [
      ...prev,
      {
        id: flightId,
        prompt: text,
        model: modelDef.key,
        duration,
        startedAt: Date.now(),
      },
    ])
    setPrompt('')
    setError(null)
    try {
      const res = await fetch(`${OASIS_BASE}/api/media/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          duration,
          fast: wantsFast,
          resolution,
          aspect_ratio: aspectRatio,
          image_url: imageUrl.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Video request failed' })) as { error?: string; detail?: string; hint?: string; cause?: string }
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
      if (data.status === 'completed' && data.url) {
        const entry: GeneratedVideo = {
          id: flightId,
          prompt: text,
          url: data.url,
          model: modelDef.key,
          duration,
          createdAt: new Date().toISOString(),
        }
        setHistory(prev => {
          const next = [entry, ...prev].slice(0, 30)
          writeHistory(next)
          return next
        })
        setInFlight(prev => prev.filter(f => f.id !== flightId))
      } else if (data.status === 'queued' && data.requestId) {
        setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, requestId: data.requestId, endpoint: data.endpoint } : f))
        pollVideoStatus(flightId, data.requestId, data.endpoint || '', text, modelDef.key, duration)
      } else {
        const msg = data.error || 'Unexpected response from video API'
        setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: msg } : f))
        setError(msg)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Video generation failed'
      setInFlight(prev => prev.map(f => f.id === flightId ? { ...f, error: msg } : f))
      setError(msg)
    }
  }, [prompt, model, duration, resolution, aspectRatio, imageUrl, pollVideoStatus])

  const handleDelete = useCallback((id: string) => {
    setHistory(prev => {
      const next = prev.filter(h => h.id !== id)
      writeHistory(next)
      return next
    })
  }, [])

  // Merge history + previously-uploaded videos (de-duplicated by URL).
  const galleryEntries = [
    ...history,
    ...uploaded
      .filter(u => !history.some(h => h.url === u.url))
      .map<GeneratedVideo>(u => ({
        id: u.url,
        prompt: u.name,
        url: u.url,
        model: 'uploaded',
        duration: 0,
        createdAt: u.createdAt,
      })),
  ]

  const modelDef = VIDEO_MODELS.find(m => m.key === model) || VIDEO_MODELS[1]
  const usesFast = modelDef.fast && imageUrl.trim().length > 0

  return (
    <div className="space-y-2">
      <CollapsibleSection
        label="New Video"
        accentColor="#FB7185"
        expanded={expandNew}
        onToggle={() => setExpandNew(e => !e)}
        rightSlot={`${modelDef.label} · ${duration}s`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="text-[10px] bg-black/60 border border-rose-500/30 rounded px-2 py-1 text-rose-200 font-mono focus:outline-none focus:border-rose-400/60 cursor-pointer"
          >
            {VIDEO_MODELS.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <select
            value={duration}
            onChange={e => setDuration(parseInt(e.target.value, 10))}
            className="text-[10px] bg-black/60 border border-rose-500/30 rounded px-2 py-1 text-rose-200 font-mono focus:outline-none focus:border-rose-400/60 cursor-pointer"
            title="Duration (seconds)"
          >
            {DURATIONS.map(d => (
              <option key={d} value={d}>{d}s</option>
            ))}
          </select>
          <select
            value={resolution}
            onChange={e => setResolution(e.target.value)}
            className="text-[10px] bg-black/60 border border-rose-500/30 rounded px-2 py-1 text-rose-200 font-mono focus:outline-none focus:border-rose-400/60 cursor-pointer"
            title="Resolution"
          >
            {RESOLUTIONS.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select
            value={aspectRatio}
            onChange={e => setAspectRatio(e.target.value)}
            className="text-[10px] bg-black/60 border border-rose-500/30 rounded px-2 py-1 text-rose-200 font-mono focus:outline-none focus:border-rose-400/60 cursor-pointer"
            title="Aspect ratio"
          >
            {ASPECT_RATIOS.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <input
          type="url"
          value={imageUrl}
          onChange={e => setImageUrl(e.target.value)}
          onFocus={scrollIntoViewOnFocus}
          placeholder="(optional) image URL for image-to-video..."
          className="w-full text-[11px] bg-black/60 border border-rose-500/30 rounded px-2 py-1 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-rose-400/60 font-mono"
        />

        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onFocus={scrollIntoViewOnFocus}
          rows={3}
          placeholder="describe the video... e.g. 'a phoenix rising from molten gold, cinematic, slow motion'"
          className="w-full text-xs bg-black/60 border border-rose-500/30 rounded-lg px-3 py-2 text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-rose-400/60 font-mono"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] text-rose-400/60 font-mono">
            {usesFast ? 'fal.ai LTX-2.3 fast (image-to-video)' : modelDef.desc}
          </span>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, rgba(251, 113, 133, 0.3), rgba(236, 72, 153, 0.3))',
              color: '#FECDD3',
              border: '1px solid rgba(251, 113, 133, 0.4)',
            }}
          >
            {inFlight.length > 0 ? `Generate (${inFlight.length})` : 'Generate \u{1F3AC}'}
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
                className="rounded-md border border-rose-500/20 bg-black/40 px-2.5 py-1.5 flex items-center gap-2"
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
                    <span className="text-base animate-pulse">{'\u{1F3AC}'}</span>
                    <span className="text-[10px] text-rose-300 font-mono flex-1 truncate">{f.prompt}</span>
                    <span className="text-[9px] text-rose-400/60 font-mono">
                      {f.requestId ? 'rendering…' : 'queued…'}
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
        accentColor="#FB7185"
        expanded={expandGallery}
        onToggle={() => setExpandGallery(e => !e)}
      >
        {galleryEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-gray-400">
            <div className="text-2xl mb-1">{'\u{1F3AC}'}</div>
            <div className="text-xs">No videos generated yet</div>
            <div className="text-[10px] mt-1 text-gray-500">Describe a scene and hit Generate</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {galleryEntries.map(clip => (
              <div
                key={clip.id}
                className="rounded-md border border-rose-500/20 bg-black/40 p-1.5"
              >
                <video
                  src={clip.url}
                  controls
                  preload="metadata"
                  className="w-full rounded"
                  style={{ aspectRatio: '16/9', background: '#000' }}
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-rose-200 font-mono truncate" title={clip.prompt}>
                    {clip.prompt}
                  </span>
                  {history.some(h => h.id === clip.id) && (
                    <button
                      onClick={() => handleDelete(clip.id)}
                      className="text-[10px] text-gray-500 hover:text-red-400 ml-2"
                      title="Forget from history"
                    >
                      &times;
                    </button>
                  )}
                </div>
                <div className="text-[9px] text-gray-500 font-mono">
                  {new Date(clip.createdAt).toLocaleString()}
                  {clip.duration > 0 && ` · ${clip.duration}s`}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}
