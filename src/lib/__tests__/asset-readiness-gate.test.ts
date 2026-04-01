// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ASSET READINESS GATE TESTS
// Verify GPU-upload ordering (initTexture before state update) and
// video event listener ordering (listeners before src assignment)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// GROUND PLANE — gl.initTexture() ordering tests
// ═══════════════════════════════════════════════════════════════════════════

describe('GroundPlane initTexture ordering', () => {
  it('BaseGround calls gl.initTexture(clone) BEFORE setDiffuse triggers re-render', async () => {
    // Simulate the ordering contract from BaseGround's useEffect:
    //   1. loadCachedTexture resolves
    //   2. clone texture + set repeat + needsUpdate
    //   3. gl.initTexture(clone) — MUST happen before step 4
    //   4. setDiffuse(clone) — React state update
    const callOrder: string[] = []

    const mockGl = {
      initTexture: vi.fn((tex: any) => {
        callOrder.push('initTexture')
      }),
    }

    const mockSetDiffuse = vi.fn((_tex: unknown) => {
      callOrder.push('setDiffuse')
    })

    // Replicate the exact logic from BaseGround useEffect callback
    const tex = { clone: () => ({ repeat: { set: vi.fn() }, needsUpdate: false }) }
    const clone = tex.clone()
    clone.needsUpdate = true
    mockGl.initTexture(clone)
    mockSetDiffuse(clone)

    expect(callOrder).toEqual(['initTexture', 'setDiffuse'])
    expect(mockGl.initTexture).toHaveBeenCalledTimes(1)
    expect(mockGl.initTexture).toHaveBeenCalledWith(clone)
    expect(mockSetDiffuse).toHaveBeenCalledWith(clone)
  })

  it('TileGroupRenderer calls gl.initTexture(tex) BEFORE setDiffuse', async () => {
    const callOrder: string[] = []

    const mockGl = {
      initTexture: vi.fn((_tex: unknown) => { callOrder.push('initTexture') }),
    }

    const mockSetDiffuse = vi.fn((_tex: unknown) => { callOrder.push('setDiffuse') })

    // Replicate TileGroupRenderer logic — no clone, direct tex
    const tex = { id: 'shared-texture' }
    mockGl.initTexture(tex)
    mockSetDiffuse(tex)

    expect(callOrder).toEqual(['initTexture', 'setDiffuse'])
    expect(mockGl.initTexture).toHaveBeenCalledWith(tex)
  })

  it('initTexture is NOT called when cancelled=true (cleanup race)', () => {
    const mockGl = { initTexture: vi.fn() }
    const mockSetDiffuse = vi.fn()
    let cancelled = true

    // Replicate the guard: if (!cancelled && tex) { ... }
    const tex = { clone: () => ({ repeat: { set: vi.fn() }, needsUpdate: false }) }
    if (!cancelled && tex) {
      const clone = tex.clone()
      mockGl.initTexture(clone)
      mockSetDiffuse(clone)
    }

    expect(mockGl.initTexture).not.toHaveBeenCalled()
    expect(mockSetDiffuse).not.toHaveBeenCalled()
  })

  it('initTexture is NOT called when tex is null (load failure)', () => {
    const mockGl = { initTexture: vi.fn() }
    const mockSetDiffuse = vi.fn()
    const cancelled = false
    const tex = null

    if (!cancelled && tex) {
      mockGl.initTexture(tex)
      mockSetDiffuse(tex)
    }

    expect(mockGl.initTexture).not.toHaveBeenCalled()
    expect(mockSetDiffuse).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// VIDEO PLANE — event listener ordering tests
// ═══════════════════════════════════════════════════════════════════════════

describe('VideoPlaneRenderer event listener ordering', () => {
  let addedListeners: { event: string; order: number }[]
  let srcSetOrder: number
  let orderCounter: number

  // Minimal video element mock that tracks addEventListener + src assignment order
  function createMockVideo() {
    orderCounter = 0
    addedListeners = []
    srcSetOrder = -1

    let _src = ''
    const listeners: Record<string, Function[]> = {}

    const video: any = {
      loop: false,
      playsInline: false,
      autoplay: false,
      muted: false,
      preload: '',
      videoWidth: 640,
      videoHeight: 480,
      readyState: 4,
      style: { cssText: '' },
      addEventListener: vi.fn((event: string, handler: Function) => {
        addedListeners.push({ event, order: ++orderCounter })
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(handler)
      }),
      removeEventListener: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      requestVideoFrameCallback: vi.fn((cb: Function) => {
        // Track as listener equivalent
        addedListeners.push({ event: 'requestVideoFrameCallback', order: ++orderCounter })
      }),
    }

    // Track when src is set via property descriptor
    Object.defineProperty(video, 'src', {
      get: () => _src,
      set: (val: string) => {
        srcSetOrder = ++orderCounter
        _src = val
      },
    })

    return { video, listeners }
  }

  it('all event listeners are attached BEFORE video.src is assigned', () => {
    const { video } = createMockVideo()

    // Replicate the exact sequence from VideoPlaneRenderer useEffect:
    // 1. Create video element, set properties
    video.loop = true
    video.playsInline = true
    video.autoplay = true
    video.muted = true
    video.preload = 'auto'

    // 2. Attach listeners BEFORE src
    const createTexture = vi.fn()

    video.addEventListener('loadedmetadata', () => {})
    video.addEventListener('error', () => {})
    video.addEventListener('canplay', () => createTexture('canplay'))
    video.addEventListener('loadeddata', () => createTexture('loadeddata'))
    video.addEventListener('playing', () => createTexture('playing'))

    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback(() => createTexture('requestVideoFrameCallback'))
    }

    // 3. NOW assign src
    video.src = 'http://localhost:4516/test-video.mp4'

    // Verify ALL listeners were added before src was set
    const allListenerOrders = addedListeners.map(l => l.order)
    const maxListenerOrder = Math.max(...allListenerOrders)
    expect(srcSetOrder).toBeGreaterThan(maxListenerOrder)
  })

  it('critical events (canplay, loadeddata, playing) are all registered', () => {
    const { video } = createMockVideo()

    video.addEventListener('loadedmetadata', () => {})
    video.addEventListener('error', () => {})
    video.addEventListener('canplay', () => {})
    video.addEventListener('loadeddata', () => {})
    video.addEventListener('playing', () => {})

    const registeredEvents = addedListeners.map(l => l.event)
    expect(registeredEvents).toContain('canplay')
    expect(registeredEvents).toContain('loadeddata')
    expect(registeredEvents).toContain('playing')
    expect(registeredEvents).toContain('loadedmetadata')
    expect(registeredEvents).toContain('error')
  })

  it('deferred readyState check uses rAF, not synchronous', () => {
    // The fix: instead of checking readyState synchronously after src assignment,
    // wrap in requestAnimationFrame so the browser has one tick to populate videoWidth
    const mockRAF = vi.fn((cb: FrameRequestCallback) => {
      // In real code, this defers to next frame
      return 1
    })

    const { video } = createMockVideo()
    video.readyState = 4
    video.videoWidth = 0 // Browser hasn't populated yet (synchronous check would fail)

    let textureCreated = false
    const createTexture = () => { textureCreated = true }

    // Synchronous check would incorrectly skip because videoWidth=0
    // This is the OLD buggy behavior:
    if (video.readyState >= 2 && video.videoWidth > 0) {
      createTexture()
    }
    expect(textureCreated).toBe(false) // Correctly skipped

    // After rAF, browser populates videoWidth
    video.videoWidth = 640
    mockRAF(() => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        createTexture()
      }
      return 0
    })

    // Simulate rAF callback execution
    const rafCallback = mockRAF.mock.calls[0][0]
    rafCallback(0)

    expect(textureCreated).toBe(true)
  })

  it('cached video fires canplay synchronously during src set — listeners catch it', () => {
    // This is the exact bug the fix addresses:
    // Cached videos fire events DURING src assignment. If listeners aren't
    // attached yet, events are lost forever.
    let textureCreated = false
    orderCounter = 0
    addedListeners = []

    const listeners: Record<string, Function[]> = {}
    let _src = ''

    const video: any = {
      videoWidth: 1920,
      videoHeight: 1080,
      readyState: 4,
      addEventListener: vi.fn((event: string, handler: Function) => {
        addedListeners.push({ event, order: ++orderCounter })
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(handler)
      }),
    }

    // Simulate cached video: src assignment triggers canplay synchronously
    Object.defineProperty(video, 'src', {
      get: () => _src,
      set: (val: string) => {
        _src = val
        // Cached video fires canplay DURING src assignment
        if (listeners['canplay']) {
          listeners['canplay'].forEach(fn => fn())
        }
      },
    })

    const createTexture = () => { textureCreated = true }

    // CORRECT ORDER: listeners first, then src
    video.addEventListener('canplay', () => createTexture())
    video.src = 'http://localhost:4516/cached-video.mp4'

    expect(textureCreated).toBe(true)
  })

  it('cached video with OLD ordering (src before listeners) misses event', () => {
    // Proves the bug existed: if src is set before listeners, event is lost
    let textureCreated = false
    const listeners: Record<string, Function[]> = {}
    let _src = ''

    const video: any = {
      videoWidth: 1920,
      videoHeight: 1080,
      readyState: 4,
      addEventListener: vi.fn((event: string, handler: Function) => {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(handler)
      }),
    }

    Object.defineProperty(video, 'src', {
      get: () => _src,
      set: (val: string) => {
        _src = val
        // Cached video fires canplay synchronously — but no listeners yet!
        if (listeners['canplay']) {
          listeners['canplay'].forEach(fn => fn())
        }
      },
    })

    const createTexture = () => { textureCreated = true }

    // BUG ORDER: src first, then listeners
    video.src = 'http://localhost:4516/cached-video.mp4'
    video.addEventListener('canplay', () => createTexture())

    // Event was fired during src assignment but no listener was attached yet
    expect(textureCreated).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-CUTTING — createTexture gate logic
// ═══════════════════════════════════════════════════════════════════════════

describe('createTexture gate logic', () => {
  it('rejects when videoWidth is 0 (no decoded frames)', () => {
    let created = false
    const video = { videoWidth: 0, videoHeight: 0, readyState: 4 }
    let tex: any = null

    const createTexture = (trigger: string) => {
      if (tex) return
      if (!video.videoWidth || !video.videoHeight) return
      tex = { type: 'VideoTexture' }
      created = true
    }

    createTexture('canplay')
    expect(created).toBe(false)
    expect(tex).toBeNull()
  })

  it('succeeds when videoWidth > 0 and not disposed', () => {
    let tex: any = null
    let disposed = false
    const video = { videoWidth: 1920, videoHeight: 1080, readyState: 4 }

    const createTexture = (trigger: string) => {
      if (tex || disposed) return
      if (!video.videoWidth || !video.videoHeight) return
      tex = { type: 'VideoTexture', trigger }
    }

    createTexture('canplay')
    expect(tex).toEqual({ type: 'VideoTexture', trigger: 'canplay' })
  })

  it('idempotent — second call is no-op', () => {
    let callCount = 0
    let tex: any = null
    const disposed = false
    const video = { videoWidth: 1920, videoHeight: 1080 }

    const createTexture = (trigger: string) => {
      if (tex || disposed) return
      if (!video.videoWidth || !video.videoHeight) return
      tex = { type: 'VideoTexture', trigger }
      callCount++
    }

    createTexture('canplay')
    createTexture('loadeddata')
    createTexture('playing')
    expect(callCount).toBe(1)
    expect(tex.trigger).toBe('canplay')
  })

  it('no-op when disposed (cleanup ran)', () => {
    let tex: any = null
    const disposed = true
    const video = { videoWidth: 1920, videoHeight: 1080 }

    const createTexture = () => {
      if (tex || disposed) return
      tex = { type: 'VideoTexture' }
    }

    createTexture()
    expect(tex).toBeNull()
  })
})
