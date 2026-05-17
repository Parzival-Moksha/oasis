'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// EXPERIMENTS TAB — try-before-shipping toggles. First experiment: splash screen.
// Lets us flip between 8 designs × 2 image-gen models without redeploy.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import {
  SPLASH_DESIGNS,
  SPLASH_MODELS,
  splashImageCandidates,
  type SplashDesignId,
  type SplashModelSlug,
} from '@/components/forge/splash/splash-designs'
import { useSplashPreference } from '@/components/forge/splash/splash-preference'

function SplashCard({
  designId,
  modelSlug,
  active,
  onPick,
  onPreview,
}: {
  designId: SplashDesignId
  modelSlug: SplashModelSlug
  active: boolean
  onPick: () => void
  onPreview: () => void
}) {
  const design = SPLASH_DESIGNS.find(d => d.id === designId)!
  const [imgUrl, setImgUrl] = useState<string | null>(splashImageCandidates(designId, modelSlug)[0] ?? null)
  const [idx, setIdx] = useState(0)

  const onError = () => {
    const next = splashImageCandidates(designId, modelSlug)[idx + 1]
    if (next) {
      setIdx(idx + 1)
      setImgUrl(next)
    } else {
      setImgUrl(null)
    }
  }

  return (
    <div
      className={`group relative overflow-hidden rounded-lg border transition-all cursor-pointer ${
        active
          ? 'border-fuchsia-300/70 shadow-[0_0_18px_rgba(240,171,252,0.35)]'
          : 'border-white/12 hover:border-white/30'
      }`}
      onClick={onPick}
      title={design.blurb}
    >
      <div className="aspect-[16/9] w-full bg-black relative">
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={design.label}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ mixBlendMode: design.screenBlend ? 'screen' : 'normal' }}
            loading="lazy"
            onError={onError}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: design.fallbackGradient }} />
        )}
        <div
          className="absolute inset-x-0 bottom-0 h-1/3"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }}
        />
        {active && (
          <div
            className="absolute top-1.5 right-1.5 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em]"
            style={{ borderColor: design.accent, color: design.accent, background: 'rgba(0,0,0,0.6)' }}
          >
            Active
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <div className="text-[11px] font-black uppercase tracking-[0.12em] text-white truncate">
          {design.label}
        </div>
        <div className="text-[9.5px] text-white/55 truncate">{design.blurb}</div>
      </div>
      <button
        type="button"
        className="absolute bottom-1.5 right-1.5 rounded border border-white/30 bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white/90 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/85"
        onClick={e => {
          e.stopPropagation()
          onPreview()
        }}
      >
        Test ⤓
      </button>
    </div>
  )
}

export function ExperimentsTab() {
  const splash = useSplashPreference()

  const handlePreview = (designId: SplashDesignId, modelSlug: SplashModelSlug) => {
    // Reload with the splash param so the user actually sees the splash again.
    // Use replaceState so we don't push history; full reload is required because
    // the splash only renders on initial mount.
    const url = new URL(window.location.href)
    url.searchParams.set('splash', `${designId}.${modelSlug}`)
    if (splash.holdMs > 0) url.searchParams.set('splash-hold', String(splash.holdMs))
    window.location.assign(url.toString())
  }

  return (
    <div className="space-y-4 text-white">
      <section>
        <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">
          🧪 Splash screen
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-white/60">
          The first thing every visitor sees. Pick a design and the image model that baked it.
          Click <span className="text-white">Test ⤓</span> to reload with that splash forced —
          useful when the page is fully cached.
        </p>

        {/* ─── Model picker ─── */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-white/50">Model</span>
          <div className="flex gap-1.5">
            {SPLASH_MODELS.map(m => {
              const active = splash.model === m.slug
              return (
                <button
                  key={m.slug}
                  type="button"
                  onClick={() => splash.setModel(m.slug)}
                  className={`rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-all ${
                    active
                      ? 'border-fuchsia-300/65 bg-fuchsia-300/15 text-fuchsia-100 shadow-[0_0_10px_rgba(240,171,252,0.25)]'
                      : 'border-white/10 bg-black/30 text-white/55 hover:border-white/25 hover:text-white/85'
                  }`}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ─── Design grid ─── */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {SPLASH_DESIGNS.map(design => (
            <SplashCard
              key={design.id}
              designId={design.id}
              modelSlug={splash.model}
              active={splash.design === design.id}
              onPick={() => splash.setDesign(design.id)}
              onPreview={() => handlePreview(design.id, splash.model)}
            />
          ))}
        </div>

        {/* ─── Hold slider + reload button ─── */}
        <div className="mt-4 rounded-md border border-white/10 bg-black/30 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/65">
              Hold splash for
            </span>
            <span className="text-[10.5px] font-mono text-fuchsia-200">
              {splash.holdMs === 0 ? 'until ready' : `${(splash.holdMs / 1000).toFixed(1)}s min`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={8000}
            step={250}
            value={splash.holdMs}
            onChange={e => splash.setHoldMs(parseInt(e.target.value, 10))}
            className="mt-2 w-full accent-fuchsia-400"
          />
          <p className="mt-1 text-[10px] leading-snug text-white/45">
            Visit-2 onwards everything is cached and the splash blinks past too fast to read.
            Crank this up to force it to linger so you can actually look at it.
          </p>
          <button
            type="button"
            onClick={() => handlePreview(splash.design, splash.model)}
            className="mt-2.5 w-full rounded border border-fuchsia-300/40 bg-fuchsia-300/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-fuchsia-100 transition hover:bg-fuchsia-300/20"
          >
            ↻  Reload to preview current pick
          </button>
        </div>

        {/* ─── Hint ─── */}
        <div className="mt-3 rounded border border-white/8 bg-black/25 px-2.5 py-2 text-[10px] leading-relaxed text-white/55">
          <div>
            <span className="text-white/80">URL override:</span>{' '}
            <code className="text-fuchsia-200">?splash=design-id.model</code> beats localStorage —
            handy for sharing a link to a specific look.
          </div>
          <div className="mt-1">
            <span className="text-white/80">Force cold load:</span> hard-refresh (Ctrl+Shift+R),
            DevTools → Network → Disable cache, or open in incognito.
          </div>
        </div>
      </section>
    </div>
  )
}
