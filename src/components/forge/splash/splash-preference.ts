// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SPLASH PREFERENCE — tiny localStorage hook, plus URL-param override.
// Lives outside the central oasisStore so it can be read SYNCHRONOUSLY at
// boot, before any of the heavier Zustand slices hydrate.
// URL: /?splash=retrowave-rp1.gpt2  (designId.modelSlug — model optional)
// localStorage keys: oasis-splash-design, oasis-splash-model, oasis-splash-hold-ms
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useState, useCallback } from 'react'
import {
  DEFAULT_SPLASH_DESIGN,
  DEFAULT_SPLASH_MODEL,
  SPLASH_DESIGNS,
  SPLASH_MODELS,
  type SplashDesignId,
  type SplashModelSlug,
} from './splash-designs'

const KEY_DESIGN = 'oasis-splash-design'
const KEY_MODEL = 'oasis-splash-model'
const KEY_HOLD_MS = 'oasis-splash-hold-ms'

const DESIGN_IDS = new Set<string>(SPLASH_DESIGNS.map(d => d.id))
const MODEL_SLUGS = new Set<string>(SPLASH_MODELS.map(m => m.slug))

export interface SplashPreference {
  design: SplashDesignId
  model: SplashModelSlug
  /** Force the splash to remain visible for at least N ms after ready. Useful
   *  for previewing on already-cached visits where load completes instantly. */
  holdMs: number
}

function isDesignId(v: unknown): v is SplashDesignId {
  return typeof v === 'string' && DESIGN_IDS.has(v)
}
function isModelSlug(v: unknown): v is SplashModelSlug {
  return typeof v === 'string' && MODEL_SLUGS.has(v)
}

function readUrlParams(): Partial<SplashPreference> {
  if (typeof window === 'undefined') return {}
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('splash')
  const out: Partial<SplashPreference> = {}
  if (raw) {
    const [d, m] = raw.split('.')
    if (isDesignId(d)) out.design = d
    if (isModelSlug(m)) out.model = m
  }
  const hold = params.get('splash-hold')
  if (hold) {
    const n = Number(hold)
    if (Number.isFinite(n) && n >= 0 && n <= 60000) out.holdMs = n
  }
  return out
}

function readStorage(): Partial<SplashPreference> {
  if (typeof window === 'undefined') return {}
  try {
    const d = window.localStorage.getItem(KEY_DESIGN)
    const m = window.localStorage.getItem(KEY_MODEL)
    const h = window.localStorage.getItem(KEY_HOLD_MS)
    const out: Partial<SplashPreference> = {}
    if (isDesignId(d)) out.design = d
    if (isModelSlug(m)) out.model = m
    if (h) {
      const n = Number(h)
      if (Number.isFinite(n) && n >= 0 && n <= 60000) out.holdMs = n
    }
    return out
  } catch {
    return {}
  }
}

/** Resolve once, synchronously. URL params win, then localStorage, then defaults. */
export function resolveSplashPreference(): SplashPreference {
  const url = readUrlParams()
  const ls = readStorage()
  return {
    design: url.design ?? ls.design ?? DEFAULT_SPLASH_DESIGN,
    model: url.model ?? ls.model ?? DEFAULT_SPLASH_MODEL,
    holdMs: url.holdMs ?? ls.holdMs ?? 0,
  }
}

/** React hook with setters that persist to localStorage. */
export function useSplashPreference(): SplashPreference & {
  setDesign: (id: SplashDesignId) => void
  setModel: (slug: SplashModelSlug) => void
  setHoldMs: (ms: number) => void
} {
  const [pref, setPref] = useState<SplashPreference>(() => resolveSplashPreference())

  // Keep in sync across tabs of the same browser.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_DESIGN && isDesignId(e.newValue)) setPref(p => ({ ...p, design: e.newValue as SplashDesignId }))
      if (e.key === KEY_MODEL && isModelSlug(e.newValue)) setPref(p => ({ ...p, model: e.newValue as SplashModelSlug }))
      if (e.key === KEY_HOLD_MS && e.newValue) {
        const n = Number(e.newValue)
        if (Number.isFinite(n)) setPref(p => ({ ...p, holdMs: n }))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setDesign = useCallback((id: SplashDesignId) => {
    try { window.localStorage.setItem(KEY_DESIGN, id) } catch {}
    setPref(p => ({ ...p, design: id }))
  }, [])
  const setModel = useCallback((slug: SplashModelSlug) => {
    try { window.localStorage.setItem(KEY_MODEL, slug) } catch {}
    setPref(p => ({ ...p, model: slug }))
  }, [])
  const setHoldMs = useCallback((ms: number) => {
    try { window.localStorage.setItem(KEY_HOLD_MS, String(ms)) } catch {}
    setPref(p => ({ ...p, holdMs: ms }))
  }, [])

  return { ...pref, setDesign, setModel, setHoldMs }
}
