'use client'

// ░▒▓ PERF HEARTBEAT — a small health sample every 5 minutes, so slowdowns in a long session leave a trail ▓▒░
// Owner feedback (2026-11-09): "if I'm in the Oasis long enough, FPS drops." Synthetic runs did not
// reproduce it, so the real tab reports what could grow: FPS, JS heap, GPU resources, scene size,
// frame-loop callbacks, DOM size, long tasks. Rows land in OasisAnalyticsEvent as eventType
// 'perf_sample' (local mode only; Scene mounts this outside hosted mode).

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

import { getInputState } from '@/lib/input-manager'
import { getWLipSyncNodeStats } from '@/lib/wlipsync-driver'
import { FrameCallbackTimer, type FrameSubscriberLike } from '@/lib/frame-callback-timing'
import { summarizeLongFrames, type LongFrameEntry } from '@/lib/perf-long-frames'
import { useOasisStore } from '@/store/oasisStore'

const SAMPLE_EVERY_MS = 5 * 60 * 1000
/** Long frames kept between samples (at 10 a second, 5 minutes would be 3000: enough to see the shape). */
const LONG_FRAME_KEEP = 3000

export function PerfHeartbeat({ readFps }: { readFps: () => number | null }) {
  const get = useThree(state => state.get)
  const longTaskMs = useRef(0)
  const longTasks = useRef(0)

  const longFrames = useRef<LongFrameEntry[]>([])
  const visibleMs = useRef(0)
  const visibleSince = useRef<number | null>(null)
  // Which useFrame callbacks the frames go to (long-frame attribution stops at the fiber loop).
  const frameTimer = useMemo(() => new FrameCallbackTimer(), [])
  const frameCount = useRef(0)
  useFrame(() => {
    frameTimer.tick()
    // New subscribers appear as the scene changes: pick them up now and then, not every frame.
    frameCount.current += 1
    if (frameCount.current % 120 === 1) frameTimer.instrument(get().internal.subscribers as unknown as FrameSubscriberLike[])
  }, -1000)

  // Dev handle for before/after measurements (the perf harness reads the same numbers the samples carry).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const host = window as unknown as { __oasisFrameLoop?: { flush: (topN?: number) => unknown; subscribers: () => number } }
    host.__oasisFrameLoop = { flush: topN => frameTimer.flush(topN), subscribers: () => get().internal.subscribers.length }
    return () => { delete host.__oasisFrameLoop }
  }, [frameTimer, get])

  useEffect(() => {
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          longTaskMs.current += entry.duration
          longTasks.current += 1
        }
      })
      observer.observe({ type: 'longtask', buffered: false })
    } catch {
      observer = null
    }
    // Long animation frames (Chromium 123+): which scripts a slow frame ran, and how much of it
    // was style and layout. Kept as a bounded list, summarized per sample.
    let frameObserver: PerformanceObserver | null = null
    try {
      frameObserver = new PerformanceObserver(list => {
        const bucket = longFrames.current
        for (const entry of list.getEntries() as unknown as LongFrameEntry[]) {
          if (bucket.length >= LONG_FRAME_KEEP) break
          bucket.push({
            startTime: entry.startTime,
            duration: entry.duration,
            blockingDuration: entry.blockingDuration,
            renderStart: entry.renderStart,
            styleAndLayoutStart: entry.styleAndLayoutStart,
            scripts: (entry.scripts || []).map(script => ({
              invoker: script.invoker,
              invokerType: script.invokerType,
              sourceURL: script.sourceURL,
              sourceFunctionName: script.sourceFunctionName,
              sourceCharPosition: script.sourceCharPosition,
              duration: script.duration,
              forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
            })),
          })
        }
      })
      frameObserver.observe({ type: 'long-animation-frame', buffered: false })
    } catch {
      frameObserver = null
    }
    // Visible time, so "decays after N minutes on screen" can be read off the samples.
    const onVisibility = () => {
      const now = performance.now()
      if (document.visibilityState === 'visible') {
        if (visibleSince.current === null) visibleSince.current = now
      } else if (visibleSince.current !== null) {
        visibleMs.current += now - visibleSince.current
        visibleSince.current = null
      }
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)

    const sample = () => {
      const { gl, scene, internal } = get()
      let sceneObjects = 0
      scene.traverse(() => { sceneObjects += 1 })
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
      const store = useOasisStore.getState()
      const engine = store.agentEngine
      const agents = Object.values(engine.agents)
      const now = performance.now()
      const visibleNow = visibleMs.current + (visibleSince.current === null ? 0 : now - visibleSince.current)
      const frames = summarizeLongFrames(longFrames.current)
      longFrames.current = []
      const metadata = {
        uptimeMin: Math.round(now / 60000),
        visibleMin: Math.round(visibleNow / 60000),
        visible: document.visibilityState === 'visible',
        longFrames: frames,
        frameLoop: frameTimer.flush(),
        fps: readFps(),
        heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? null,
        sceneObjects,
        frameCallbacks: internal.subscribers.length,
        domNodes: document.getElementsByTagName('*').length,
        longTasks: longTasks.current,
        longTaskMs: Math.round(longTaskMs.current),
        lipSyncNodes: getWLipSyncNodeStats().created,
        agents: agents.length,
        agentLogEntries: agents.reduce((sum, agent) => sum + agent.log.length, 0),
        inputState: getInputState(),
        dpr: gl.getPixelRatio(),
        canvas: [gl.domElement.width, gl.domElement.height],
      }
      longTaskMs.current = 0
      longTasks.current = 0
      void fetch('/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'perf_sample', worldId: store.activeWorldId, source: 'perf_heartbeat', metadata }),
        keepalive: true,
      }).catch(() => {})
    }

    const timer = window.setInterval(sample, SAMPLE_EVERY_MS)
    return () => {
      window.clearInterval(timer)
      observer?.disconnect()
      frameObserver?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [get, readFps, frameTimer])

  return null
}
