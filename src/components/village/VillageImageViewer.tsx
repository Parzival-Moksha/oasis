'use client'

// ░▒▓ VILLAGE IMAGE VIEWER — a picture opens full-screen inside the Oasis, not in a new browser tab ▓▒░
// Fits 90% of whichever side limits it, on a dark backdrop. ← / → (buttons or arrow keys) step through the
// pictures of the thread; Esc or a click on the backdrop closes it. Rendered into <body> on top of everything:
// the agent panels (z ~9400) and the drei Html desk screens (z <= 80).

import { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { closeVillageImages, getVillageImageViewer, stepVillageImages, subscribeVillageImageViewer } from './village-actions'

const VIEWER_Z = 2147483000

export function VillageImageViewer() {
  const viewer = useSyncExternalStore(subscribeVillageImageViewer, getVillageImageViewer, () => null)

  useEffect(() => {
    if (!viewer) return
    // Window capture: the village keys step aside while the viewer is open (village-actions), and nothing
    // after this sees Esc or the arrows (no leaving the agent, no walking).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeVillageImages()
      else if (event.key === 'ArrowLeft') stepVillageImages(-1)
      else if (event.key === 'ArrowRight') stepVillageImages(1)
      else return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [viewer])

  if (!viewer || typeof document === 'undefined') return null
  const image = viewer.images[viewer.index]
  const many = viewer.images.length > 1
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()
  const arrow = 'absolute top-1/2 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/55 text-[26px] text-white/90 transition hover:bg-white/15'

  return createPortal(
    <div
      data-ui-panel="village-image-viewer"
      role="dialog"
      aria-label={image.name}
      className="fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      style={{ zIndex: VIEWER_Z }}
      onPointerDown={stop}
      onClick={() => closeVillageImages()}
    >
      {image.kind === 'video' ? (
        <video
          key={image.url}
          src={image.url}
          controls
          autoPlay
          playsInline
          onClick={stop}
          className="block rounded-md bg-black shadow-[0_30px_90px_rgba(0,0,0,0.7)]"
          style={{ maxWidth: '90vw', maxHeight: '90vh' }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- served by the local engine, not optimizable
        <img
          key={image.url}
          src={image.url}
          alt={image.name}
          onClick={stop}
          className="block rounded-md object-contain shadow-[0_30px_90px_rgba(0,0,0,0.7)]"
          style={{ maxWidth: '90vw', maxHeight: '90vh' }}
        />
      )}
      {many && (
        <>
          <button type="button" aria-label="Previous picture" className={`${arrow} left-5`} onClick={event => { stop(event); stepVillageImages(-1) }}>←</button>
          <button type="button" aria-label="Next picture" className={`${arrow} right-5`} onClick={event => { stop(event); stepVillageImages(1) }}>→</button>
        </>
      )}
      <button
        type="button"
        aria-label="Close"
        className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/55 text-[18px] text-white/90 transition hover:bg-white/15"
        onClick={event => { stop(event); closeVillageImages() }}
      >
        ✕
      </button>
      <div className="pointer-events-none absolute bottom-4 left-1/2 max-w-[80vw] -translate-x-1/2 truncate rounded-full bg-black/60 px-3 py-1 text-[12px] text-white/85">
        {many ? `${viewer.index + 1} / ${viewer.images.length} · ` : ''}{image.name}
        <span className="ml-2 text-white/50">{many ? '← → step · ' : ''}Esc closes</span>
      </div>
    </div>,
    document.body,
  )
}
