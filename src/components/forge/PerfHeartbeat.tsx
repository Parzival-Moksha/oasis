'use client'

// ░▒▓ PERF HEARTBEAT — a small health sample every 5 minutes, so slowdowns in a long session leave a trail ▓▒░
// Owner feedback (2026-11-09): "if I'm in the Oasis long enough, FPS drops." Synthetic runs did not
// reproduce it, so the real tab reports what could grow: FPS, JS heap, GPU resources, scene size,
// frame-loop callbacks, DOM size, long tasks. Rows land in OasisAnalyticsEvent as eventType
// 'perf_sample' (local mode only; Scene mounts this outside hosted mode).

import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'

import { getInputState } from '@/lib/input-manager'
import { getWLipSyncNodeStats } from '@/lib/wlipsync-driver'
import { useOasisStore } from '@/store/oasisStore'

const SAMPLE_EVERY_MS = 5 * 60 * 1000

export function PerfHeartbeat({ readFps }: { readFps: () => number | null }) {
  const get = useThree(state => state.get)
  const longTaskMs = useRef(0)
  const longTasks = useRef(0)

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

    const sample = () => {
      const { gl, scene, internal } = get()
      let sceneObjects = 0
      scene.traverse(() => { sceneObjects += 1 })
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
      const store = useOasisStore.getState()
      const engine = store.agentEngine
      const agents = Object.values(engine.agents)
      const metadata = {
        uptimeMin: Math.round(performance.now() / 60000),
        visible: document.visibilityState === 'visible',
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
    }
  }, [get, readFps])

  return null
}
