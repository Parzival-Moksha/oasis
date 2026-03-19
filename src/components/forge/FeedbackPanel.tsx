'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK 0.1 — Feedback Portal + Vibecode Chat
// Bug reports + feature requests + LLM-assisted deep reporting.
// +10 XP for quick submit, +100 XP for vibecode reports.
// "The community shapes the engine."
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useSession } from 'next-auth/react'
import { SettingsContext } from '../scene-lib'
import { awardXp } from '@/hooks/useXp'
import { useAnorakAgent } from '@/hooks/useAnorakAgent'
import { ThoughtStreamPopup } from '../stashed/ThoughtStream'

interface FeedbackItem {
  id: number
  user_id: string
  user_name: string
  user_avatar: string | null
  type: 'bug' | 'feature'
  title: string
  body: string | null
  status: 'open' | 'shipped' | 'wontfix'
  upvotes: number
  created_at: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

type Tab = 'list' | 'submit' | 'vibecode'
type FilterType = 'all' | 'bug' | 'feature'

const DEFAULT_POS = { x: 16, y: 220 }
const ADMIN_ID = process.env.NEXT_PUBLIC_ADMIN_USER_ID || ''
const STATUS_CYCLE: ('open' | 'shipped' | 'wontfix')[] = ['open', 'shipped', 'wontfix']

const MODEL_OPTIONS = [
  { value: 'anthropic/claude-haiku-4-5', label: 'Haiku 4.5' },
  { value: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
  { value: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'z-ai/glm-5', label: 'GLM-5' },
]

// Extract vibecode_report from Anorak's response
function extractReport(text: string): { carbon: string; silicon: string } | null {
  const reportMatch = text.match(/<vibecode_report>([\s\S]*?)<\/vibecode_report>/)
  if (!reportMatch) return null
  const carbonMatch = reportMatch[1].match(/<carbon>([\s\S]*?)<\/carbon>/)
  const siliconMatch = reportMatch[1].match(/<silicon>([\s\S]*?)<\/silicon>/)
  if (!carbonMatch || !siliconMatch) return null
  return { carbon: carbonMatch[1].trim(), silicon: siliconMatch[1].trim() }
}

// Parse silicon section for title and type
function parseSilicon(silicon: string): { title: string; type: 'bug' | 'feature' } {
  const titleMatch = silicon.match(/TITLE:\s*(.+)/i)
  const typeMatch = silicon.match(/TYPE:\s*(bug|feature)/i)
  return {
    title: titleMatch?.[1]?.trim() || 'Vibecode Report',
    type: (typeMatch?.[1]?.toLowerCase() as 'bug' | 'feature') || 'bug',
  }
}

// Extract Carbon + Silicon from stored feedback body format
function extractCarbonSilicon(body: string | null): { carbon: string; silicon: string } | null {
  if (!body) return null
  const carbonMatch = body.match(/--- CARBON ---\s*([\s\S]*?)(?=\n\n--- SILICON ---|$)/)
  const siliconMatch = body.match(/--- SILICON ---\s*([\s\S]*)$/)
  if (!carbonMatch || !siliconMatch) return null
  return { carbon: carbonMatch[1].trim(), silicon: siliconMatch[1].trim() }
}

export function FeedbackPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { data: session } = useSession()
  const isAdmin = session?.user?.id === ADMIN_ID
  const { settings } = useContext(SettingsContext)
  const [tab, setTab] = useState<Tab>('list')
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [loading, setLoading] = useState(false)

  // Anorak coding agent
  const agent = useAnorakAgent()
  const [agentStreamOpen, setAgentStreamOpen] = useState(false)
  const [agentOpacity, setAgentOpacity] = useState(0.92)
  const [codingItemId, setCodingItemId] = useState<number | null>(null)

  // Submit form state
  const [submitType, setSubmitType] = useState<'bug' | 'feature'>('bug')
  const [submitTitle, setSubmitTitle] = useState('')
  const [submitBody, setSubmitBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // Vibecode chat state
  const [vcMessages, setVcMessages] = useState<ChatMessage[]>([])
  const [vcInput, setVcInput] = useState('')
  const [vcStreaming, setVcStreaming] = useState(false)
  const [vcModel, setVcModel] = useState('anthropic/claude-haiku-4-5')
  const [vcReport, setVcReport] = useState<{ carbon: string; silicon: string } | null>(null)
  const [vcSubmitted, setVcSubmitted] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Dragging
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try {
      const saved = localStorage.getItem('oasis-feedback-pos')
      return saved ? JSON.parse(saved) : DEFAULT_POS
    } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if ((e.target as HTMLElement).closest('input')) return
    if ((e.target as HTMLElement).closest('textarea')) return
    if ((e.target as HTMLElement).closest('select')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }, [position])

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const newPos = { x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }
    setPosition(newPos)
    localStorage.setItem('oasis-feedback-pos', JSON.stringify(newPos))
  }, [isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', handleDragEnd)
    }
    return () => {
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', handleDragEnd)
    }
  }, [isDragging, handleDrag, handleDragEnd])

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [vcMessages])

  // Fetch feedback
  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('type', filter)
      const res = await fetch(`/api/feedback?${params}`)
      const data = await res.json()
      setItems(data.items || [])
    } catch {} finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    if (isOpen) fetchItems()
  }, [isOpen, fetchItems])

  // ── Quick Submit ──────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!submitTitle.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: submitType,
          title: submitTitle.trim(),
          body: submitBody.trim() || null,
        }),
      })
      if (res.ok) {
        setSubmitSuccess(true)
        setSubmitTitle('')
        setSubmitBody('')
        awardXp('SUBMIT_FEEDBACK')
        setTimeout(() => {
          setTab('list')
          setSubmitSuccess(false)
          fetchItems()
        }, 1500)
      }
    } catch (err) {
      console.error('[Anorak] Submit failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Vibecode Chat ─────────────────────────────────────────────
  const sendVibecodeMessage = async () => {
    const text = vcInput.trim()
    if (!text || vcStreaming) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    const newMessages = [...vcMessages, userMsg]
    setVcMessages(newMessages)
    setVcInput('')
    setVcStreaming(true)

    // Start with empty assistant message that we'll stream into
    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setVcMessages([...newMessages, assistantMsg])

    try {
      abortRef.current = new AbortController()
      const res = await fetch('/api/anorak/vibecode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, model: vcModel }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        assistantMsg.content = `*${err.error || 'Something went wrong. Try again.'}*`
        setVcMessages([...newMessages, { ...assistantMsg }])
        setVcStreaming(false)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setVcStreaming(false)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.content) {
              fullContent += parsed.content
              setVcMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: fullContent }
                return updated
              })
            }
          } catch {}
        }
      }

      // Check if Anorak produced a final report
      const report = extractReport(fullContent)
      if (report) {
        setVcReport(report)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[Anorak] Vibecode stream error:', err)
      }
    } finally {
      setVcStreaming(false)
    }
  }

  const handleVcKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendVibecodeMessage()
    }
  }

  const submitVibecodeReport = async () => {
    if (!vcReport || vcSubmitted) return
    const { title, type } = parseSilicon(vcReport.silicon)
    const body = `--- CARBON ---\n${vcReport.carbon}\n\n--- SILICON ---\n${vcReport.silicon}`

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title, body }),
      })
      if (res.ok) {
        setVcSubmitted(true)
        awardXp('VIBECODE_REPORT')
        setTimeout(() => {
          setTab('list')
          resetVibecode()
          fetchItems()
        }, 2000)
      }
    } catch (err) {
      console.error('[Anorak] Vibecode submit failed:', err)
    }
  }

  const resetVibecode = () => {
    setVcMessages([])
    setVcInput('')
    setVcReport(null)
    setVcSubmitted(false)
    abortRef.current?.abort()
  }

  // Admin status cycling
  const handleSetStatus = async (itemId: number, currentStatus: string) => {
    if (!isAdmin) return
    const nextIdx = (STATUS_CYCLE.indexOf(currentStatus as typeof STATUS_CYCLE[number]) + 1) % STATUS_CYCLE.length
    const nextStatus = STATUS_CYCLE[nextIdx]
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: itemId, status: nextStatus }),
      })
      if (res.ok) {
        setItems(prev => prev.map(it => it.id === itemId ? { ...it, status: nextStatus } : it))
      }
    } catch {}
  }

  // ── Code This — launch Anorak agent on a feedback item ────
  const handleCodeThis = (item: FeedbackItem) => {
    const extracted = extractCarbonSilicon(item.body)
    const carbon = extracted?.carbon || item.body || ''
    const silicon = extracted?.silicon || `TYPE: ${item.type}\nTITLE: ${item.title}\nDESCRIPTION: ${item.body || 'No details provided'}`

    setCodingItemId(item.id)
    setAgentStreamOpen(true)
    agent.startAgent({
      title: item.title,
      description: item.body || '',
      carbon,
      silicon,
      model: 'opus',
    })
  }

  if (!isOpen || typeof document === 'undefined') return null

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    } catch { return '' }
  }

  const statusColors: Record<string, string> = {
    open: 'text-yellow-400',
    shipped: 'text-green-400',
    wontfix: 'text-gray-500',
  }

  // Render assistant messages: strip XML tags for display, format report nicely
  const renderMessage = (msg: ChatMessage) => {
    if (msg.role === 'user') {
      return <span className="text-gray-200">{msg.content}</span>
    }

    // Strip <vibecode_report> tags for cleaner display
    let display = msg.content
    const reportMatch = display.match(/<vibecode_report>[\s\S]*?<\/vibecode_report>/)
    if (reportMatch) {
      display = display.replace(reportMatch[0], '').trim()
    }

    // Format carbon/silicon if report was extracted
    if (vcReport && reportMatch) {
      return (
        <>
          {display && <span className="text-purple-200">{display}</span>}
          <div className="mt-2 rounded-lg overflow-hidden border border-purple-500/30">
            <div className="bg-purple-900/30 px-3 py-1.5 text-[9px] uppercase tracking-wider text-purple-400 font-bold">
              Carbon — human vibes
            </div>
            <div className="px-3 py-2 text-[11px] text-gray-200 leading-relaxed">
              {vcReport.carbon}
            </div>
            <div className="bg-cyan-900/30 px-3 py-1.5 text-[9px] uppercase tracking-wider text-cyan-400 font-bold border-t border-purple-500/20">
              Silicon — tech spec
            </div>
            <div className="px-3 py-2 text-[10px] text-cyan-200 font-mono whitespace-pre-wrap leading-relaxed">
              {vcReport.silicon}
            </div>
          </div>
        </>
      )
    }

    return <span className="text-purple-200">{display}</span>
  }

  const panelHeight = tab === 'vibecode' ? 560 : 480

  return (<>
    {createPortal(
    <div
      data-menu-portal="feedback-panel"
      className="fixed z-[9996] rounded-xl flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: 380,
        height: panelHeight,
        backgroundColor: `rgba(0, 0, 0, ${settings.uiOpacity})`,
        border: `1px solid ${tab === 'vibecode' ? 'rgba(168,85,247,0.3)' : 'rgba(249,115,22,0.3)'}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        transition: 'height 0.2s, border-color 0.3s',
      }}
    >
      {/* Header */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-orange-400">
            Anorak
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setTab('list')}
              className={`px-2 py-0.5 rounded text-[10px] cursor-pointer ${tab === 'list' ? 'bg-orange-500/20 text-orange-300' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Feed
            </button>
            <button
              onClick={() => { setTab('submit'); setSubmitSuccess(false) }}
              className={`px-2 py-0.5 rounded text-[10px] cursor-pointer ${tab === 'submit' ? 'bg-orange-500/20 text-orange-300' : 'text-gray-400 hover:text-gray-200'}`}
            >
              + Submit
            </button>
            <button
              onClick={() => setTab('vibecode')}
              className={`px-2 py-0.5 rounded text-[10px] cursor-pointer ${tab === 'vibecode' ? 'bg-purple-500/20 text-purple-300' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Vibecode
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isAdmin && agent.isRunning && (
            <button
              onClick={() => setAgentStreamOpen(true)}
              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 animate-pulse cursor-pointer hover:bg-purple-500/30"
              title="Open Anorak's thought stream"
            >
              Stream
            </button>
          )}
          {isAdmin && agent.status === 'done' && (
            <button
              onClick={() => setAgentStreamOpen(true)}
              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30 cursor-pointer hover:bg-green-500/30"
              title="View completed agent stream"
            >
              Done
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xs cursor-pointer">
            X
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* ── FEED TAB ────────────────────────────────────────── */}
        {tab === 'list' && (
          <>
            {/* Filter row */}
            <div className="flex gap-1 px-3 py-2 border-b border-white/5">
              {(['all', 'bug', 'feature'] as FilterType[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2 py-0.5 rounded text-[10px] cursor-pointer ${filter === f ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                >
                  {f === 'all' ? 'All' : f === 'bug' ? 'Bugs' : 'Features'}
                </button>
              ))}
            </div>

            {/* Items */}
            <div className="px-3 py-2 space-y-2">
              {loading && items.length === 0 && (
                <p className="text-center text-gray-400 text-xs mt-4">Loading...</p>
              )}
              {!loading && items.length === 0 && (
                <p className="text-center text-gray-400 text-xs mt-4">
                  No feedback yet. Be the first!
                </p>
              )}
              {items.map(item => (
                <div
                  key={item.id}
                  className="rounded-lg p-2.5"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs mt-0.5">
                      {item.type === 'bug' ? '\u{1F41B}' : '\u2728'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white font-medium leading-tight">{item.title}</p>
                      {item.body && (
                        <p className="text-[10px] text-gray-300 mt-1 line-clamp-2">{item.body}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[9px] text-gray-400">{item.user_name}</span>
                        <span className="text-[9px] text-gray-500">{formatDate(item.created_at)}</span>
                        {isAdmin ? (
                          <>
                            <button
                              onClick={() => handleSetStatus(item.id, item.status)}
                              className={`text-[9px] font-medium cursor-pointer hover:underline ${statusColors[item.status] || 'text-gray-500'}`}
                              title="Click to cycle: open -> shipped -> wontfix"
                            >
                              {item.status}
                            </button>
                            <button
                              onClick={() => handleCodeThis(item)}
                              disabled={agent.isRunning}
                              className={`text-[9px] font-bold cursor-pointer px-1.5 py-0.5 rounded transition-all ${
                                codingItemId === item.id && agent.isRunning
                                  ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40 animate-pulse'
                                  : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-500/40'
                              } disabled:opacity-40 disabled:cursor-not-allowed`}
                              title="Launch Anorak coding agent on this item"
                            >
                              {codingItemId === item.id && agent.isRunning ? 'Coding...' : 'Code This'}
                            </button>
                          </>
                        ) : (
                          <span className={`text-[9px] font-medium ${statusColors[item.status] || 'text-gray-500'}`}>
                            {item.status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── SUBMIT TAB ──────────────────────────────────────── */}
        {tab === 'submit' && (
          <div className="px-4 py-4 space-y-3">
            {submitSuccess ? (
              <div className="text-center py-8">
                <p className="text-green-400 font-medium text-sm">Submitted! +10 XP</p>
                <p className="text-gray-400 text-xs mt-1">Thanks for shaping the Oasis.</p>
              </div>
            ) : (
              <>
                {/* Type selector */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setSubmitType('bug')}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                      submitType === 'bug'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                        : 'bg-white/5 text-gray-400 border border-white/10 hover:text-gray-200'
                    }`}
                  >
                    Bug Report
                  </button>
                  <button
                    onClick={() => setSubmitType('feature')}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                      submitType === 'feature'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-white/5 text-gray-400 border border-white/10 hover:text-gray-200'
                    }`}
                  >
                    Feature Request
                  </button>
                </div>

                {/* Title */}
                <div>
                  <label className="block text-[10px] text-gray-300 uppercase tracking-wider mb-1">
                    {submitType === 'bug' ? 'What broke?' : 'What would you love?'}
                  </label>
                  <input
                    value={submitTitle}
                    onChange={e => setSubmitTitle(e.target.value)}
                    maxLength={100}
                    placeholder={submitType === 'bug' ? 'Describe the bug...' : 'Describe the feature...'}
                    className="w-full px-3 py-2 rounded-lg text-white text-xs outline-none placeholder-gray-600"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(249,115,22,0.2)' }}
                    autoFocus
                  />
                </div>

                {/* Body */}
                <div>
                  <label className="block text-[10px] text-gray-300 uppercase tracking-wider mb-1">
                    Details <span className="text-gray-500">(optional)</span>
                  </label>
                  <textarea
                    value={submitBody}
                    onChange={e => setSubmitBody(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    placeholder="Steps to reproduce, context, ideas..."
                    className="w-full px-3 py-2 rounded-lg text-white text-xs outline-none resize-none placeholder-gray-600"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(249,115,22,0.2)' }}
                  />
                </div>

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={!submitTitle.trim() || submitting}
                  className="w-full py-2.5 rounded-lg text-white text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  style={{ background: submitTitle.trim() ? 'linear-gradient(135deg, #EA580C, #C2410C)' : 'rgba(255,255,255,0.1)' }}
                >
                  {submitting ? 'Submitting...' : `Submit ${submitType === 'bug' ? 'Bug Report' : 'Feature Request'} (+10 XP)`}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── VIBECODE TAB ────────────────────────────────────── */}
        {tab === 'vibecode' && (
          <div className="flex flex-col h-full">
            {/* Model selector bar */}
            <div className="px-3 py-1.5 border-b border-purple-500/10 flex items-center justify-between flex-shrink-0"
              style={{ background: 'rgba(88, 28, 135, 0.15)' }}
            >
              <span className="text-[9px] text-purple-400 font-mono">
                {vcMessages.length === 0 ? 'talk to the mage' : `${Math.ceil(vcMessages.length / 2)} exchanges`}
              </span>
              <div className="flex items-center gap-2">
                {vcMessages.length > 0 && (
                  <button
                    onClick={resetVibecode}
                    className="text-[9px] text-gray-500 hover:text-gray-300 cursor-pointer font-mono"
                    title="Start over"
                  >
                    reset
                  </button>
                )}
                <select
                  value={vcModel}
                  onChange={(e) => setVcModel(e.target.value)}
                  className="text-[10px] bg-black/60 border border-purple-700/30 rounded px-1.5 py-0.5 text-purple-300 font-mono cursor-pointer focus:outline-none focus:border-purple-500/50 appearance-none"
                  style={{ backgroundImage: 'none' }}
                  title="LLM model for vibecode chat"
                >
                  {MODEL_OPTIONS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
              {vcMessages.length === 0 && !vcSubmitted && (
                <div className="text-center py-6">
                  <div className="text-2xl mb-2">&#x1F9D9;</div>
                  <p className="text-purple-300 text-xs font-medium">Anorak awaits your words.</p>
                  <p className="text-gray-500 text-[10px] mt-1">
                    Describe a bug or feature idea. The mage will ask<br/>
                    clarifying questions, then forge a detailed report.
                  </p>
                  <p className="text-purple-400/60 text-[9px] mt-3 font-mono">+100 XP per vibecode report</p>
                </div>
              )}
              {vcMessages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-5 h-5 rounded-full bg-purple-900/60 border border-purple-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[9px]">&#x1F9D9;</span>
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-900/40 border border-blue-500/20 text-gray-200'
                        : 'bg-purple-900/20 border border-purple-500/15'
                    }`}
                  >
                    {renderMessage(msg)}
                    {msg.role === 'assistant' && i === vcMessages.length - 1 && vcStreaming && (
                      <span className="inline-block w-1.5 h-3 bg-purple-400 ml-0.5 animate-pulse" />
                    )}
                  </div>
                </div>
              ))}
              {vcSubmitted && (
                <div className="text-center py-4">
                  <p className="text-green-400 font-medium text-sm">Vibecode report submitted! +100 XP</p>
                  <p className="text-gray-400 text-xs mt-1">The mage is pleased.</p>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Report action bar */}
            {vcReport && !vcSubmitted && (
              <div className="px-3 py-2 border-t border-purple-500/20 flex-shrink-0"
                style={{ background: 'rgba(88, 28, 135, 0.2)' }}
              >
                <button
                  onClick={submitVibecodeReport}
                  className="w-full py-2 rounded-lg text-white text-xs font-medium cursor-pointer transition-all"
                  style={{ background: 'linear-gradient(135deg, #7C3AED, #A855F7)' }}
                >
                  Submit Vibecode Report (+100 XP)
                </button>
              </div>
            )}

            {/* Input */}
            {!vcSubmitted && (
              <div className="px-3 py-2 border-t border-purple-500/10 flex gap-2 flex-shrink-0">
                <input
                  value={vcInput}
                  onChange={(e) => setVcInput(e.target.value)}
                  onKeyDown={handleVcKeyDown}
                  placeholder={vcMessages.length === 0 ? "What's on your mind, vibecoder?" : 'Reply to Anorak...'}
                  disabled={vcStreaming}
                  className="flex-1 px-3 py-1.5 rounded-lg text-white text-xs outline-none placeholder-gray-600 disabled:opacity-50"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(168,85,247,0.2)' }}
                  autoFocus={tab === 'vibecode'}
                />
                <button
                  onClick={sendVibecodeMessage}
                  disabled={!vcInput.trim() || vcStreaming}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  style={{ background: 'rgba(168,85,247,0.2)', color: '#A855F7', border: '1px solid rgba(168,85,247,0.3)' }}
                >
                  {vcStreaming ? '...' : 'Send'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )}
  {/* Anorak ThoughtStream — admin-only agent consciousness terminal */}
  {isAdmin && agentStreamOpen && typeof document !== 'undefined' && createPortal(
    <ThoughtStreamPopup
      thoughtEvents={agent.events}
      activeLobe={agent.activeTool}
      loopRunning={agent.isRunning}
      isOpen={agentStreamOpen}
      onClose={() => setAgentStreamOpen(false)}
      opacity={agentOpacity}
      onOpacityChange={setAgentOpacity}
      isGlobalLive={agent.isRunning}
    />,
    document.body
  )}
  </>)
}
