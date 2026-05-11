// ░▒▓ World Load Progress ▓▒░
//
// Singleton wrapper around THREE.DefaultLoadingManager. The default manager
// fires onStart / onProgress / onLoad whenever ANY asset loaded through a
// Three.js loader (GLTFLoader, TextureLoader, FileLoader, etc.) starts or
// finishes. We forward those events to React subscribers so components can
// show a load bar and the portal transition system can extend its tunnel
// phase until target-world assets are fully on the GPU.
//
// Why this is the right hook: every world-load asset (GLBs, HDRIs, VRMs,
// textures) flows through GLTFLoader/TextureLoader, which by default share
// the same THREE.DefaultLoadingManager. Hooking it once gives us aggregate
// progress for free, no per-asset bookkeeping.
//
// Caveats:
// - The manager's "total" only counts URLs it has SEEN since reset. If a
//   load starts before subscribe, we still pick it up. If 100% completes
//   before the next subscribe, the bar might miss it (instant-cache case).
// - We debounce the "isLoading=false" flip by 120 ms so flicker between
//   chained loads doesn't dismiss the bar prematurely.
import * as THREE from 'three'

export interface WorldLoadState {
  loaded: number
  total: number
  /** 0..1 progress; 1 when nothing is in flight. */
  progress: number
  /** True while at least one URL is mid-flight. */
  isLoading: boolean
  /** Most recent URL that started loading (best-effort label). */
  currentUrl: string | null
}

type Listener = (state: WorldLoadState) => void

const listeners = new Set<Listener>()

let state: WorldLoadState = {
  loaded: 0,
  total: 0,
  progress: 1,
  isLoading: false,
  currentUrl: null,
}

let pendingIdleTimer: ReturnType<typeof setTimeout> | null = null
let installed = false

function emit() {
  for (const listener of listeners) listener(state)
}

function setLoadingTrue(url: string | null) {
  if (pendingIdleTimer) {
    clearTimeout(pendingIdleTimer)
    pendingIdleTimer = null
  }
  state = { ...state, isLoading: true, currentUrl: url }
  emit()
}

function setLoadingFalseDebounced() {
  if (pendingIdleTimer) clearTimeout(pendingIdleTimer)
  pendingIdleTimer = setTimeout(() => {
    state = {
      loaded: 0,
      total: 0,
      progress: 1,
      isLoading: false,
      currentUrl: null,
    }
    emit()
  }, 120)
}

export function installWorldLoadProgress() {
  if (installed) return
  installed = true
  const mgr = THREE.DefaultLoadingManager
  // Compose with whatever existing handlers are attached so we don't kill
  // url-modifier or other consumers.
  const prevOnStart = mgr.onStart
  const prevOnProgress = mgr.onProgress
  const prevOnLoad = mgr.onLoad
  const prevOnError = mgr.onError

  mgr.onStart = (url: string, loaded: number, total: number) => {
    state = {
      loaded,
      total,
      progress: total > 0 ? loaded / total : 0,
      isLoading: true,
      currentUrl: url,
    }
    emit()
    if (prevOnStart) prevOnStart(url, loaded, total)
  }

  mgr.onProgress = (url: string, loaded: number, total: number) => {
    state = {
      loaded,
      total,
      progress: total > 0 ? loaded / total : 0,
      isLoading: loaded < total,
      currentUrl: url,
    }
    emit()
    if (prevOnProgress) prevOnProgress(url, loaded, total)
  }

  mgr.onLoad = () => {
    state = {
      ...state,
      progress: 1,
    }
    emit()
    setLoadingFalseDebounced()
    if (prevOnLoad) prevOnLoad()
  }

  mgr.onError = (url: string) => {
    // Treat error as "this URL is no longer pending" — without this, total >
    // loaded forever and the bar never closes. The comment was right; the
    // implementation wasn't doing it. THREE.LoadingManager's internal
    // bookkeeping doesn't auto-clear errored URLs from the pending set,
    // so we bump `loaded` ourselves to keep loaded === total reachable.
    const bumpedLoaded = Math.min(state.total, state.loaded + 1)
    state = {
      ...state,
      loaded: bumpedLoaded,
      progress: state.total > 0 ? bumpedLoaded / state.total : 1,
      isLoading: bumpedLoaded < state.total,
      currentUrl: url,
    }
    emit()
    if (state.loaded >= state.total) setLoadingFalseDebounced()
    if (prevOnError) prevOnError(url)
  }
  // Mark used to satisfy TS noUnusedLocals — these are bound to closures.
  void setLoadingTrue
}

export function getWorldLoadState(): WorldLoadState {
  return state
}

export function subscribeWorldLoad(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
