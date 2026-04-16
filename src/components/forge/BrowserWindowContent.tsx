'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import type { AgentWindow } from '../../store/oasisStore'
import { useOasisStore } from '../../store/oasisStore'
import { normalizeBrowserSurfaceUrl } from '../../lib/browser-surface'

const BROWSER_WELCOME_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", system-ui, sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(56, 189, 248, 0.18), transparent 46%),
          linear-gradient(180deg, #020617 0%, #08111f 55%, #030712 100%);
        color: #dbeafe;
      }
      main {
        max-width: 540px;
        padding: 24px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 18px;
        background: rgba(2, 6, 23, 0.78);
        box-shadow: 0 24px 60px rgba(2, 6, 23, 0.45);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 28px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.55;
        color: #cbd5e1;
      }
      code {
        color: #7dd3fc;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Browser Surface</h1>
      <p>Paste a URL into the bar above and hit Enter.</p>
      <p>Local Oasis routes like <code>/roadmap</code> also work.</p>
    </main>
  </body>
</html>
`

function stopBubble(event: SyntheticEvent) {
  event.stopPropagation()
}

export function BrowserWindowContent({ win }: { win: AgentWindow }) {
  const updateAgentWindow = useOasisStore(s => s.updateAgentWindow)
  const addressInputRef = useRef<HTMLInputElement | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [urlDraft, setUrlDraft] = useState(win.surfaceUrl ?? '')
  const [historyStack, setHistoryStack] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  const normalizedUrl = useMemo(() => normalizeBrowserSurfaceUrl(win.surfaceUrl), [win.surfaceUrl])

  useEffect(() => {
    setUrlDraft(win.surfaceUrl ?? '')
  }, [win.surfaceUrl])

  useEffect(() => {
    if (normalizedUrl || !addressInputRef.current) return
    addressInputRef.current.focus()
    addressInputRef.current.select()
  }, [normalizedUrl, win.id])

  useEffect(() => {
    if (!normalizedUrl) {
      setHistoryStack([])
      setHistoryIndex(-1)
      return
    }

    setHistoryStack(prev => {
      if (prev.length > 0 && prev[historyIndex] === normalizedUrl) return prev
      if (prev[prev.length - 1] === normalizedUrl) {
        setHistoryIndex(prev.length - 1)
        return prev
      }
      const next = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev.slice()
      next.push(normalizedUrl)
      setHistoryIndex(next.length - 1)
      return next
    })
  }, [historyIndex, normalizedUrl])

  const commitUrl = useCallback((nextRaw?: string) => {
    const nextNormalized = normalizeBrowserSurfaceUrl(nextRaw ?? urlDraft)
    updateAgentWindow(win.id, { surfaceUrl: nextNormalized || undefined })
    setUrlDraft(nextNormalized)
    if (nextNormalized) {
      setHistoryStack(prev => {
        const next = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev.slice()
        if (next[next.length - 1] !== nextNormalized) next.push(nextNormalized)
        setHistoryIndex(next.length - 1)
        return next
      })
    }
  }, [historyIndex, updateAgentWindow, urlDraft, win.id])

  const navigateHistory = useCallback((direction: -1 | 1) => {
    setHistoryIndex(currentIndex => {
      const nextIndex = currentIndex + direction
      if (nextIndex < 0 || nextIndex >= historyStack.length) return currentIndex
      const nextUrl = historyStack[nextIndex]
      updateAgentWindow(win.id, { surfaceUrl: nextUrl || undefined })
      setUrlDraft(nextUrl)
      return nextIndex
    })
  }, [historyStack, updateAgentWindow, win.id])

  const openHome = useCallback(() => {
    updateAgentWindow(win.id, { surfaceUrl: undefined })
    setUrlDraft('')
  }, [updateAgentWindow, win.id])

  const handleAddressFocus = useCallback((event: SyntheticEvent<HTMLInputElement>) => {
    stopBubble(event)
    const input = event.currentTarget
    requestAnimationFrame(() => {
      input.select()
    })
  }, [])

  const handleAddressKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key !== 'Enter') return
    event.preventDefault()
    commitUrl()
  }, [commitUrl])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div
        className="border-b border-white/10 bg-slate-900/95 px-3 py-2"
        onPointerDown={stopBubble}
        onPointerDownCapture={stopBubble}
        onPointerUp={stopBubble}
        onMouseDown={stopBubble}
        onClick={stopBubble}
        onDoubleClick={stopBubble}
        onWheel={stopBubble}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateHistory(-1)}
            disabled={historyIndex <= 0}
            className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-mono text-slate-300 transition-colors hover:border-sky-400/30 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-35"
            title="Back"
          >
            back
          </button>
          <button
            onClick={() => navigateHistory(1)}
            disabled={historyIndex < 0 || historyIndex >= historyStack.length - 1}
            className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-mono text-slate-300 transition-colors hover:border-sky-400/30 hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-35"
            title="Forward"
          >
            next
          </button>
          <button
            onClick={openHome}
            className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-mono text-slate-300 transition-colors hover:border-sky-400/30 hover:text-sky-200"
            title="Home"
          >
            home
          </button>
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={e => {
              e.preventDefault()
              e.stopPropagation()
              commitUrl()
            }}
          >
            <input
              ref={addressInputRef}
              value={urlDraft}
              onChange={e => setUrlDraft(e.target.value)}
              onFocus={handleAddressFocus}
              onClick={stopBubble}
              onPointerDown={stopBubble}
              onPointerDownCapture={stopBubble}
              onKeyDown={handleAddressKeyDown}
              onKeyUp={stopBubble}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              placeholder="https://example.com or /local-route"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
            />
            <button
              type="submit"
              className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-mono text-slate-300 transition-colors hover:border-sky-400/30 hover:text-sky-200"
            >
              go
            </button>
          </form>
          <button
            onClick={() => setReloadNonce(value => value + 1)}
            className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-mono text-slate-300 transition-colors hover:border-sky-400/30 hover:text-sky-200"
            title="Reload"
          >
            reload
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden" onPointerDown={stopBubble}>
        <iframe
          key={`${normalizedUrl || 'welcome'}-${reloadNonce}`}
          src={normalizedUrl || undefined}
          srcDoc={normalizedUrl ? undefined : BROWSER_WELCOME_HTML}
          title={win.label || 'Browser Surface'}
          allow="autoplay; fullscreen; clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
          className="h-full w-full border-0 bg-slate-950"
        />
      </div>
    </div>
  )
}
