'use client'

// Settings > Misc > App window: install the local Oasis as its own window (no tabs, no address bar).

import { useEffect, useState } from 'react'
import { INSTALL_STATE_EVENT, isLocalHost } from '@/components/LocalServiceWorkerGuard'

function inAppWindow(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches)
}

export function AppWindowSection() {
  const [, setTick] = useState(0)
  const [result, setResult] = useState<string | null>(null)
  useEffect(() => {
    const bump = () => setTick(n => n + 1)
    window.addEventListener(INSTALL_STATE_EVENT, bump)
    return () => window.removeEventListener(INSTALL_STATE_EVENT, bump)
  }, [])
  if (typeof window === 'undefined' || !isLocalHost(window.location.hostname)) return null
  const prompt = window.__oasisInstallPrompt
  const installed = inAppWindow()

  return (
    <section data-settings-section="app-window">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">App window</div>
      {installed ? (
        <div className="text-[11px] leading-snug text-white/70">You are in the Oasis window. F11 makes it full screen; F11 again comes back.</div>
      ) : (
        <>
          <button
            type="button"
            disabled={!prompt}
            onClick={async () => {
              if (!prompt) return
              await prompt.prompt()
              const choice = await prompt.userChoice.catch(() => null)
              window.__oasisInstallPrompt = null
              setResult(choice?.outcome === 'accepted' ? 'Installed: the Oasis opens in its own window now.' : 'Not installed.')
            }}
            className="w-full rounded border border-fuchsia-300/40 bg-fuchsia-300/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-fuchsia-100 transition hover:bg-fuchsia-300/20 disabled:cursor-default disabled:opacity-45"
          >
            Install the Oasis as an app window
          </button>
          <div className="mt-1 text-[10px] leading-snug text-gray-500">
            {result ?? (prompt
              ? 'Its own window: no tabs, no address bar, an icon on the taskbar. It opens on the village.'
              : 'Already installed, or this browser did not offer it on this page. In Chrome, Brave or Edge: the install icon at the right end of the address bar, or the menu (⋮ or ≡) › Cast, save and share › Install page as app.')}
          </div>
        </>
      )}
    </section>
  )
}
