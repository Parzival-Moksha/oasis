'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CHAT PANEL — Per-world messaging
// Toggle from top-left button bar. Polls for new messages.
// Messages persist in Supabase world_messages table.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useOasisStore } from '@/store/oasisStore'
import { SettingsContext } from '../scene-lib'

interface ChatMessage {
  id: number
  user_id: string
  user_name: string
  user_avatar: string | null
  content: string
  created_at: string
}

const POLL_INTERVAL = 5000
const DEFAULT_POS = { x: 16, y: 220 }

const LOCAL_USER_ID = 'local-admin'

export function ChatPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { settings } = useContext(SettingsContext)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const lastMessageId = useRef(0)

  // Dragging
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try {
      const saved = localStorage.getItem('oasis-chat-pos')
      return saved ? JSON.parse(saved) : DEFAULT_POS
    } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if ((e.target as HTMLElement).closest('input')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }, [position])

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const newPos = { x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }
    setPosition(newPos)
    localStorage.setItem('oasis-chat-pos', JSON.stringify(newPos))
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

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    const worldId = useOasisStore.getState().activeWorldId
    if (!worldId) return
    try {
      const res = await fetch(`/api/chat?world_id=${encodeURIComponent(worldId)}`)
      const data = await res.json()
      if (data.messages) {
        setMessages(data.messages)
        const lastId = data.messages[data.messages.length - 1]?.id || 0
        if (lastId > lastMessageId.current) {
          lastMessageId.current = lastId
          // Auto-scroll on new messages
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
        }
      }
    } catch {}
  }, [])

  // Poll for messages when open
  useEffect(() => {
    if (!isOpen) return
    fetchMessages()
    const interval = setInterval(fetchMessages, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [isOpen, fetchMessages])

  // Re-fetch when world changes
  useEffect(() => {
    if (!isOpen) return
    let prevWorldId = useOasisStore.getState().activeWorldId
    const unsub = useOasisStore.subscribe((state) => {
      if (state.activeWorldId !== prevWorldId) {
        prevWorldId = state.activeWorldId
        setMessages([])
        fetchMessages()
      }
    })
    return unsub
  }, [isOpen, fetchMessages])

  const sendMessage = async () => {
    const worldId = useOasisStore.getState().activeWorldId
    if (!input.trim() || !worldId || sending) return
    setSending(true)
    const content = input.trim()
    setInput('')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ world_id: worldId, content }),
      })
      const data = await res.json()
      if (data.message) {
        setMessages(prev => [...prev, data.message])
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      }
    } catch (err) {
      console.error('[Chat] Send failed:', err)
      setInput(content) // Restore on failure
    } finally {
      setSending(false)
    }
  }

  if (!isOpen || typeof document === 'undefined') return null

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch { return '' }
  }

  return createPortal(
    <div
      data-menu-portal="chat-panel"
      className="fixed z-[9997] rounded-xl flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: 320,
        height: 400,
        backgroundColor: `rgba(0, 0, 0, ${settings.uiOpacity})`,
        border: '1px solid rgba(56, 189, 248, 0.3)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}
    >
      {/* Header */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
      >
        <span className="text-xs font-medium text-sky-400">
          💬 World Chat
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-xs cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 scrollbar-thin">
        {messages.length === 0 && (
          <p className="text-center text-gray-400 text-xs mt-8">
            No messages yet. Say something!
          </p>
        )}
        {messages.map(msg => {
          const isOwn = msg.user_id === LOCAL_USER_ID
          return (
            <div key={msg.id} className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
              {/* Avatar */}
              <div className="flex-shrink-0">
                {msg.user_avatar ? (
                  <img
                    src={msg.user_avatar}
                    alt=""
                    className="w-6 h-6 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-sky-900 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-sky-300">
                      {(msg.user_name[0] || '?').toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              {/* Bubble */}
              <div className={`max-w-[75%] ${isOwn ? 'text-right' : ''}`}>
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className={`text-[10px] font-medium ${isOwn ? 'text-sky-400' : 'text-purple-400'}`}>
                    {msg.user_name}
                  </span>
                  <span className="text-[9px] text-gray-500">{formatTime(msg.created_at)}</span>
                </div>
                <p
                  className="text-xs text-gray-200 px-2.5 py-1.5 rounded-lg inline-block text-left"
                  style={{
                    background: isOwn ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.06)',
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.content}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-white/10">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            maxLength={500}
            placeholder="Type a message..."
            className="flex-1 px-3 py-1.5 rounded-lg text-white text-xs outline-none placeholder-gray-600"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(56,189,248,0.2)',
            }}
            disabled={sending}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            style={{ background: 'rgba(56,189,248,0.3)' }}
          >
            ▸
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
