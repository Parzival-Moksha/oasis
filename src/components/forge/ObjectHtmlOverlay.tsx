'use client'

import { useEffect, useMemo, useState } from 'react'

import { useUILayer } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

function resolveOverlayUrl(url?: string): string | undefined {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  if (!url.startsWith('/')) return url
  if (!OASIS_BASE || url.startsWith(OASIS_BASE)) return url
  return `${OASIS_BASE}${url}`
}

function isSameOriginUrl(url: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URL(url, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

function injectBaseHref(html: string, url: string): string {
  if (typeof window === 'undefined') return html
  const href = new URL(url, window.location.href).href
  const base = `<base href="${href}">`
  if (/<base\s/i.test(html)) return html
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, match => `${match}${base}`)
  }
  return `${base}${html}`
}

export function ObjectHtmlOverlay() {
  const overlay = useOasisStore(state => state.activeObjectOverlay)
  const closeObjectOverlay = useOasisStore(state => state.closeObjectOverlay)
  const [sameOriginSrcDoc, setSameOriginSrcDoc] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useUILayer('object-html-overlay', Boolean(overlay))

  const url = useMemo(() => resolveOverlayUrl(overlay?.url), [overlay?.url])
  const externalUrl = url && !isSameOriginUrl(url) ? url : undefined

  useEffect(() => {
    if (!overlay) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      closeObjectOverlay()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeObjectOverlay, overlay])

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    setLoading(false)

    if (!overlay) {
      setSameOriginSrcDoc(null)
      return
    }

    if (!url) {
      setSameOriginSrcDoc(overlay.html || '')
      return
    }

    if (!isSameOriginUrl(url)) {
      setSameOriginSrcDoc(null)
      return
    }

    setLoading(true)
    fetch(url, { cache: 'no-store', credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const html = await response.text()
        if (!cancelled) setSameOriginSrcDoc(injectBaseHref(html, url))
      })
      .catch(error => {
        if (!cancelled) {
          setSameOriginSrcDoc('')
          setLoadError(error instanceof Error ? error.message : 'Failed to load overlay')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [overlay, overlay?.html, url])

  if (!overlay) return null

  return (
    <div
      className="fixed inset-0 z-[420] flex items-center justify-center bg-black/40 p-4 font-mono text-white backdrop-blur-[2px] max-[700px]:p-2"
      onMouseDown={event => {
        if (event.target === event.currentTarget) closeObjectOverlay()
      }}
    >
      <section
        data-ui-panel
        className="flex h-[82vh] w-[82vw] max-w-6xl flex-col overflow-hidden rounded-lg border border-white/18 shadow-[0_0_70px_rgba(0,0,0,0.72)] max-[700px]:h-[86vh] max-[700px]:w-[96vw]"
        style={{ background: `rgba(5, 9, 14, ${overlay.opacity})` }}
      >
        <header className="flex min-h-12 items-center gap-3 border-b border-white/12 bg-black/35 px-4">
          <div className="min-w-0 flex-1 truncate text-[12px] font-black uppercase tracking-[0.16em] text-cyan-50/90">
            {overlay.title}
          </div>
          <button
            type="button"
            onClick={closeObjectOverlay}
            className="rounded border border-white/15 bg-white/8 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-white/70 transition hover:bg-white/14 hover:text-white"
          >
            Close
          </button>
        </header>
        <div className="relative min-h-0 flex-1 bg-white/90">
          {loading && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-slate-950/75 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100">
              Loading
            </div>
          )}
          {loadError ? (
            <div className="grid h-full place-items-center bg-slate-950 text-center text-slate-100">
              <div>
                <div className="text-sm font-black uppercase tracking-[0.18em] text-rose-200">Overlay failed</div>
                <div className="mt-2 text-xs text-slate-400">{loadError}</div>
              </div>
            </div>
          ) : externalUrl ? (
            <iframe
              title={overlay.title}
              src={externalUrl}
              className="h-full w-full border-0"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          ) : (
            <iframe
              title={overlay.title}
              srcDoc={sameOriginSrcDoc || ''}
              className="h-full w-full border-0"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          )}
        </div>
      </section>
    </div>
  )
}
