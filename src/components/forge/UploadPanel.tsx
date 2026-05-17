'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useUILayer } from '@/lib/input-manager'
import { useAudioManager } from '@/lib/audio-manager'
import { useOasisStore } from '@/store/oasisStore'

export type UploadKind = 'audio' | 'video' | 'image'

type UploadPanelDetail = {
  kind?: UploadKind
}

const KIND_META: Record<UploadKind, { title: string; subtitle: string; accept: string; emoji: string }> = {
  audio: {
    title: 'Upload MP3',
    subtitle: 'Drop an audio file to add it to the world library.',
    accept: 'audio/*',
    emoji: '🎵',
  },
  video: {
    title: 'Upload MP4',
    subtitle: 'Drop a video file to place a video panel in the world.',
    accept: 'video/*',
    emoji: '🎬',
  },
  image: {
    title: 'Upload Image',
    subtitle: 'Drop an image to place a framed picture in the world.',
    accept: 'image/*',
    emoji: '🖼️',
  },
}

function fileMatchesKind(file: File, kind: UploadKind): boolean {
  if (kind === 'audio') return file.type.startsWith('audio/')
  if (kind === 'video') return file.type.startsWith('video/')
  return file.type.startsWith('image/')
}

export function UploadPanel() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<UploadKind>('image')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useUILayer('upload-panel', open)

  const meta = KIND_META[kind]

  const close = useCallback(() => {
    useAudioManager.getState().play('buttonClick')
    setOpen(false)
    setStatus(null)
    setError(null)
    setUploading(false)
    setDragging(false)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<UploadPanelDetail>).detail
      if (detail?.kind) setKind(detail.kind)
      setOpen(true)
      setStatus(null)
      setError(null)
      useAudioManager.getState().play('buttonClick')
    }
    window.addEventListener('oasis:open-upload-panel', onOpen)
    return () => window.removeEventListener('oasis:open-upload-panel', onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, open])

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(f => fileMatchesKind(f, kind))
    if (files.length === 0) {
      setError(`No matching ${kind} files`)
      return
    }
    const file = files[0]
    if (files.length > 1) {
      setStatus(`Uploading ${file.name} (extra files ignored — one at a time)…`)
    } else {
      setStatus(`Uploading ${file.name}…`)
    }
    setUploading(true)
    setError(null)

    let uploadedUrl: string | null = null
    let uploadedName: string | null = null
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/media/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        console.error('[UploadPanel] Upload failed:', await res.text())
        setUploading(false)
        setStatus(null)
        setError('Upload failed')
        return
      }
      const data = await res.json() as { url: string; name?: string; mediaType?: string }
      uploadedUrl = data.url
      uploadedName = data.name || file.name
    } catch (err) {
      console.error('[UploadPanel] Error uploading:', err)
      setUploading(false)
      setStatus(null)
      setError('Upload failed')
      return
    }

    setUploading(false)

    const store = useOasisStore.getState()
    if (kind === 'image') {
      store.enterPlacementMode({
        type: 'image',
        name: uploadedName,
        imageUrl: uploadedUrl,
        imageFrameStyle: 'baroque',
        imageFrameThickness: 7,
      })
    } else if (kind === 'video') {
      store.enterPlacementMode({
        type: 'video',
        name: uploadedName,
        videoUrl: uploadedUrl,
        imageFrameStyle: 'baroque',
        imageFrameThickness: 7,
      })
    } else {
      store.enterPlacementMode({
        type: 'catalog',
        catalogId: 'kf_speaker',
        name: uploadedName,
        path: '/models/kenney-furniture/speaker.glb',
        defaultScale: 2,
        audioUrl: uploadedUrl,
      })
    }

    // Close the panel — placement happens via tap/click in the world.
    setOpen(false)
    setStatus(null)
    setDragging(false)
  }, [kind])

  if (!open) return null

  return (
    <div
      data-ui-panel
      className="fixed right-4 top-4 z-[290] w-[min(420px,calc(100vw-2rem))] rounded-lg border border-amber-200/32 bg-[#0a0706]/95 font-mono text-white shadow-[0_0_60px_rgba(251,146,60,0.28),0_0_24px_rgba(0,0,0,0.78)] backdrop-blur-md max-[700px]:right-2 max-[700px]:top-[58px] max-[700px]:w-[min(320px,calc(100vw-1rem))]"
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-amber-100/16 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-100/70">
            {meta.emoji} Upload
          </div>
          <div className="mt-1 truncate text-lg font-black tracking-[0.02em] text-amber-50">
            {meta.title}
          </div>
        </div>
        <button
          type="button"
          className="rounded-md border border-white/15 bg-white/8 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/80 hover:bg-white/14"
          onClick={close}
        >
          Close
        </button>
      </div>

      <div className="p-4">
        <p className="mb-3 text-xs leading-5 text-white/60">{meta.subtitle}</p>

        <div
          className={[
            'flex aspect-[3/2] w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition',
            dragging
              ? 'border-amber-300/80 bg-amber-300/10 shadow-[0_0_30px_rgba(251,191,36,0.35)]'
              : 'border-white/22 bg-white/[0.035] hover:border-amber-200/40 hover:bg-white/[0.06]',
          ].join(' ')}
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={event => {
            event.preventDefault()
            event.stopPropagation()
            if (!dragging) setDragging(true)
          }}
          onDragEnter={event => {
            event.preventDefault()
            event.stopPropagation()
            setDragging(true)
          }}
          onDragLeave={event => {
            event.preventDefault()
            event.stopPropagation()
            setDragging(false)
          }}
          onDrop={event => {
            event.preventDefault()
            event.stopPropagation()
            setDragging(false)
            if (event.dataTransfer?.files?.length) {
              void handleFiles(event.dataTransfer.files)
            }
          }}
        >
          <div>
            <div className="text-3xl">{meta.emoji}</div>
            <div className="mt-2 text-[11px] font-black uppercase tracking-[0.16em] text-amber-50">
              {uploading ? 'Uploading…' : 'Drop file here'}
            </div>
            <div className="mt-1 text-[10px] text-white/45">
              {uploading ? 'Hang tight' : 'or tap to browse'}
            </div>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={meta.accept}
          multiple
          className="hidden"
          onChange={event => {
            const files = event.target.files
            if (files && files.length > 0) void handleFiles(files)
            event.target.value = ''
          }}
        />

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={uploading}
            className="rounded-md border border-amber-200/30 bg-amber-200/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-50 transition hover:border-amber-100/55 hover:bg-amber-200/18 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
          >
            Browse…
          </button>
          <button
            type="button"
            className="rounded-md border border-white/15 bg-white/8 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/70 hover:bg-white/14"
            onClick={close}
          >
            Cancel
          </button>
        </div>

        {status && (
          <p className="mt-3 text-[11px] leading-5 text-emerald-200/85">{status}</p>
        )}
        {error && (
          <p className="mt-3 text-[11px] leading-5 text-rose-200/85">{error}</p>
        )}
      </div>
    </div>
  )
}
