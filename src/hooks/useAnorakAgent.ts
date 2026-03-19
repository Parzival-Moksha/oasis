// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// useAnorakAgent — SSE consumer for the Anorak coding agent
// Connects to POST /api/anorak/agent, parses thought events,
// produces ThoughtStreamEvent[] for the ThoughtStream UI.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useCallback } from 'react'
import type { ThoughtStreamEvent } from '@/components/stashed/ThoughtStream'

export type AgentStatus = 'idle' | 'running' | 'done' | 'error'

interface AgentTask {
  title: string
  description: string
  carbon: string    // full vibecode conversation
  silicon: string   // tech spec
  extra?: string    // optional dev notes
  model?: string    // opus | sonnet | haiku
}

interface AgentResult {
  success: boolean
  exitCode?: number
  contentLength?: number
  cost_usd?: number
  duration_ms?: number
}

export function useAnorakAgent() {
  const [events, setEvents] = useState<ThoughtStreamEvent[]>([])
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [result, setResult] = useState<AgentResult | null>(null)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const startAgent = useCallback(async (task: AgentTask) => {
    // Reset state
    setEvents([])
    setStatus('running')
    setResult(null)
    setActiveTool(null)
    abortRef.current?.abort()

    const controller = new AbortController()
    abortRef.current = controller

    function addEvent(source: 'llm' | 'stderr' | 'stdout', lobe: string, chunk: string) {
      setEvents(prev => [...prev, {
        source,
        lobe,
        chunk,
        timestamp: Date.now(),
      }])
    }

    try {
      const res = await fetch('/api/anorak/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
        signal: controller.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        addEvent('stderr', 'system', `Error: ${err.error || res.statusText}`)
        setStatus('error')
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setStatus('error')
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':')) continue // skip keepalive comments
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue

          try {
            const event = JSON.parse(data)
            const type = event.type

            if (type === 'text') {
              addEvent('llm', 'coder', event.content)
            }
            else if (type === 'thinking') {
              addEvent('llm', 'prefrontal', event.content)
            }
            else if (type === 'tool_start') {
              setActiveTool(event.name)
              addEvent('stderr', 'coder', `Starting: ${event.name}`)
            }
            else if (type === 'tool') {
              setActiveTool(event.name)
              addEvent('stderr', 'coder', event.display || `${event.name}`)
            }
            else if (type === 'tool_result') {
              setActiveTool(null)
              const prefix = event.isError ? 'ERROR' : 'Result'
              addEvent('stderr', 'coder', `${prefix} (${event.name}): ${event.preview}`)
            }
            else if (type === 'status') {
              addEvent('stderr', 'system', event.content)
            }
            else if (type === 'stderr') {
              addEvent('stderr', 'system', event.content)
            }
            else if (type === 'error') {
              addEvent('stderr', 'system', `Error: ${event.content}`)
            }
            else if (type === 'result') {
              const costStr = event.cost_usd ? `$${event.cost_usd.toFixed(4)}` : '?'
              const durStr = event.duration_ms ? `${(event.duration_ms / 1000).toFixed(1)}s` : '?'
              addEvent('stderr', 'system', `Complete: ${costStr} | ${durStr}`)
            }
            else if (type === 'done') {
              setResult({
                success: event.success,
                exitCode: event.exitCode,
                contentLength: event.contentLength,
              })
              setStatus(event.success ? 'done' : 'error')
              setActiveTool(null)
            }
          } catch {}
        }
      }

      // Stream ended without explicit done event
      if (status === 'running') {
        setStatus('done')
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[Anorak Agent] Stream error:', err)
        addEvent('stderr', 'system', `Connection lost: ${(err as Error).message}`)
        setStatus('error')
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopAgent = useCallback(() => {
    abortRef.current?.abort()
    setStatus('idle')
    setActiveTool(null)
  }, [])

  const clearEvents = useCallback(() => {
    setEvents([])
    setResult(null)
    setStatus('idle')
  }, [])

  return {
    events,
    status,
    result,
    activeTool,
    startAgent,
    stopAgent,
    clearEvents,
    isRunning: status === 'running',
  }
}
