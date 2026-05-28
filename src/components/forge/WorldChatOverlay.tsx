'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'

import { useAudioManager } from '@/lib/audio-manager'
import { useUILayer } from '@/lib/input-manager'
import { sendWorldChatMessage, useWorldChat } from '@/lib/world-chat'

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT'
    || tag === 'TEXTAREA'
    || tag === 'SELECT'
    || el.isContentEditable
    || Boolean(el.closest('[data-ui-panel]'))
}

export function WorldChatOverlay({ visible = true }: { visible?: boolean }) {
  const messages = useWorldChat(state => state.messages)
  const connected = useWorldChat(state => state.connected)
  const open = useWorldChat(state => state.open)
  const setOpen = useWorldChat(state => state.setOpen)
  const localSessionId = useWorldChat(state => state.localSessionId)
  const [draft, setDraft] = useState('')
  const [now, setNow] = useState(Date.now())
  const inputRef = useRef<HTMLInputElement | null>(null)
  const lastSoundIdRef = useRef<string | null>(null)

  useUILayer('world-chat', visible && open)

  useEffect(() => {
    if (visible || !open) return
    setOpen(false)
    setDraft('')
  }, [open, setOpen, visible])

  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target)) {
        event.preventDefault()
        setOpen(true)
        window.setTimeout(() => inputRef.current?.focus(), 0)
      } else if (event.key === 'Escape' && open) {
        event.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen, visible])

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    const latest = messages[messages.length - 1]
    if (!latest || latest.id === lastSoundIdRef.current) return
    lastSoundIdRef.current = latest.id
    if (latest.sessionId && latest.sessionId !== localSessionId) {
      useAudioManager.getState().play('notification')
    }
  }, [localSessionId, messages])

  const visibleMessages = useMemo(() => {
    const recent = messages.filter(message => open || now - message.createdAt < 18_000)
    return recent.slice(-10)
  }, [messages, now, open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const sent = sendWorldChatMessage(draft)
    if (sent) {
      setDraft('')
      useAudioManager.getState().play('buttonClick')
    } else {
      useAudioManager.getState().play('error')
    }
  }

  if (!visible) return null

  return (
    <>
      <div className="pointer-events-none fixed right-4 top-20 z-[185] flex w-[min(360px,calc(100vw-2rem))] flex-col items-end gap-1 font-mono max-[700px]:left-2 max-[700px]:right-2 max-[700px]:top-[226px] max-[700px]:w-auto">
        {visibleMessages.map(message => {
          const own = message.sessionId === localSessionId
          return (
            <div
              key={message.id}
              className={`max-w-full rounded-md border px-2 py-1 text-[11px] leading-snug shadow-lg backdrop-blur-md ${own ? 'border-cyan-200/30 bg-cyan-950/70 text-cyan-50' : 'border-white/10 bg-black/70 text-white'}`}
            >
              <span className="font-black" style={{ color: message.color || '#67e8f9' }}>
                {own ? 'You' : message.displayName || 'Wizard'}
              </span>
              <span className="ml-2 whitespace-pre-wrap break-words">{message.text}</span>
            </div>
          )
        })}
      </div>

      {open ? (
        <form
          data-ui-panel
          onSubmit={submit}
          className="fixed bottom-4 right-4 z-[320] flex w-[min(420px,calc(100vw-2rem))] items-center gap-2 rounded-lg border border-cyan-200/25 bg-black/90 p-2 font-mono text-white shadow-[0_0_40px_rgba(34,211,238,0.18)] backdrop-blur-md max-[700px]:bottom-[178px] max-[700px]:left-2 max-[700px]:right-2 max-[700px]:w-auto"
        >
          <button
            type="button"
            aria-label="Close chat"
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.08] text-sm font-black text-white/80 transition hover:bg-white/[0.14]"
          >
            x
          </button>
          <div className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-emerald-300' : 'bg-red-300'}`} />
          <input
            ref={inputRef}
            value={draft}
            maxLength={280}
            onChange={event => setDraft(event.target.value)}
            placeholder={connected ? 'Message this world' : 'Connecting chat...'}
            disabled={!connected}
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-200/60 disabled:opacity-45"
          />
          <button
            type="submit"
            disabled={!connected || !draft.trim()}
            className="rounded-md border border-cyan-200/30 bg-cyan-300/[0.12] px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-300/[0.22] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-[220] rounded-md border border-cyan-200/25 bg-black/75 px-3 py-2 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-cyan-50 shadow-lg backdrop-blur-md transition hover:bg-cyan-300/15 max-[700px]:bottom-[178px] max-[700px]:right-3"
        >
          Chat
        </button>
      )}
    </>
  )
}
