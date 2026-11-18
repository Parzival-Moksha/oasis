import type { MetadataRoute } from 'next'
import { isHostedOasis } from '@/lib/oasis-profile'

// The web app manifest (served at /manifest.webmanifest; Next adds the <link> itself).
//
// Local: "Install" in Chrome, Brave or Edge turns the Oasis into its own window, no tabs and no
// address bar (the owner, 2026-11-18: "the top of my screen is taken by the browser"). It opens on
// the village. There is no service worker: the code changes all day and a cached copy would go
// stale (LocalServiceWorkerGuard removes any that an older build left behind).
// Hosted (04515.xyz): the public Oasis, opening on Portal Zero, as before.
export default function manifest(): MetadataRoute.Manifest {
  if (isHostedOasis()) {
    return {
      name: 'Oasis',
      short_name: 'Oasis',
      description: 'Text-to-3D world builder',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#000000',
      theme_color: '#05070c',
      orientation: 'any',
      icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    }
  }
  return {
    id: '/?app=oasis-local',
    name: 'Oasis',
    short_name: 'Oasis',
    description: 'Your Oasis: the village of your agents, on this computer.',
    start_url: '/?profile=village',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#1a0b2c',
    orientation: 'any',
    icons: [
      { src: '/icons/oasis-local-48.png', sizes: '48x48', type: 'image/png', purpose: 'any' },
      { src: '/icons/oasis-local-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/oasis-local-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/oasis-local-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
