'use client'

// Two small jobs for the installable Oasis window, both on this computer only.
//   1. No service worker may serve the local Oasis: the code changes all day and a cached copy would go stale.
//      Any worker an older build (or another app on this port) registered is removed, with its caches.
//   2. Chrome and Brave announce "you can install this" once per page load: keep that event, so the
//      Install button in Settings > Misc can open the browser's own install dialog.

import { useEffect } from 'react'

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

declare global {
  interface Window {
    __oasisInstallPrompt?: InstallPrompt | null
  }
}

export const INSTALL_STATE_EVENT = 'oasis:install-state'

export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname.endsWith('.localhost')
}

export function LocalServiceWorkerGuard() {
  useEffect(() => {
    if (!isLocalHost(window.location.hostname)) return
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const registration of registrations) void registration.unregister()
      }).catch(() => {})
    }
    if ('caches' in window) {
      void caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))).catch(() => {})
    }
    const onPrompt = (event: Event) => {
      event.preventDefault() // no mini-infobar; the address bar's install icon and our button remain
      window.__oasisInstallPrompt = event as InstallPrompt
      window.dispatchEvent(new CustomEvent(INSTALL_STATE_EVENT))
    }
    const onInstalled = () => {
      window.__oasisInstallPrompt = null
      window.dispatchEvent(new CustomEvent(INSTALL_STATE_EVENT))
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  return null
}
