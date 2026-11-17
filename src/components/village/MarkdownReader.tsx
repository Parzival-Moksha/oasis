'use client'

// ░▒▓ MARKDOWN READER — a file an agent sent, read in the Oasis ▓▒░
// Opens full size over everything. Read (the default) shows the markdown rendered; Edit shows the raw text with a
// Save button (Ctrl+S too). Saving writes the file back through the engine, to the path the agent sent it from and
// nowhere else. Leaving with unsaved edits (switching to Read, closing, Esc) asks first: Save / Discard / Keep editing.
// If the file changed on disk meanwhile (the agent rewrote it), Save says so and offers to overwrite.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { closeMdReader, getMdReaderTarget, subscribeMdReader } from '../../lib/village/md-reader'
import { useInputManager } from '../../lib/input-manager'

const READER_Z = 2147483100

type Mode = 'read' | 'edit'
type Ask = null | 'leave' | 'overwrite'

const prose = [
  'text-[14.5px] leading-relaxed text-slate-100',
  '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-[26px] [&_h1]:font-black [&_h1]:text-white',
  '[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:border-b [&_h2]:border-white/10 [&_h2]:pb-1 [&_h2]:text-[20px] [&_h2]:font-bold [&_h2]:text-white',
  '[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-[16px] [&_h3]:font-bold [&_h3]:text-cyan-100',
  '[&_p]:my-2.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5',
  '[&_a]:text-cyan-300 [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-cyan-400/50 [&_blockquote]:pl-3 [&_blockquote]:text-slate-300',
  '[&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-amber-100',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/50 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:my-3 [&_table]:border-collapse [&_th]:border [&_th]:border-white/20 [&_th]:bg-white/10 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-white/15 [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:my-5 [&_hr]:border-white/15 [&_img]:max-w-full',
].join(' ')

export function MarkdownReader() {
  const target = useSyncExternalStore(subscribeMdReader, getMdReaderTarget, () => null)
  if (!target || typeof document === 'undefined') return null
  return createPortal(<Reader key={target.fileId} fileId={target.fileId} name={target.name} />, document.body)
}

function Reader({ fileId, name }: { fileId: string; name: string }) {
  const [mode, setMode] = useState<Mode>('read')
  const [saved, setSaved] = useState<string | null>(null) // what is on disk, as far as we know
  const [draft, setDraft] = useState('')
  const [mtime, setMtime] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask>(null)
  // What the owner was doing when the question came up: closing the reader, or going back to Read.
  const [after, setAfter] = useState<'read' | 'close'>('close')
  const dirty = saved !== null && draft !== saved

  useEffect(() => {
    let live = true
    getAgentEngineClient().readFile(fileId).then(file => {
      if (!live) return
      setSaved(file.text)
      setDraft(file.text)
      setMtime(file.mtimeMs)
    }).catch(error => { if (live) setLoadError(error instanceof Error ? error.message : String(error)) })
    return () => { live = false }
  }, [fileId])

  // The reader needs a free mouse.
  useEffect(() => { useInputManager.getState().releasePointerLock() }, [])

  const save = useCallback(async (force = false): Promise<boolean> => {
    if (saved === null || saving) return false
    setSaving(true)
    setMessage(null)
    try {
      const result = await getAgentEngineClient().writeFile(fileId, draft, mtime, force)
      setSaved(draft)
      setMtime(result.mtimeMs)
      setAsk(null)
      setMessage('Saved.')
      return true
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      if (/changed on disk/.test(text)) setAsk('overwrite')
      else setMessage(`Not saved: ${text}`)
      return false
    } finally {
      setSaving(false)
    }
  }, [draft, fileId, mtime, saved, saving])

  const latest = useRef({ dirty, mode, save, ask })
  latest.current = { dirty, mode, save, ask }

  /** Close, or ask first when there are unsaved edits. */
  const requestClose = useCallback(() => {
    if (latest.current.dirty) { setAfter('close'); setAsk('leave') }
    else closeMdReader()
  }, [])
  const requestMode = (next: Mode) => {
    if (next === mode) return
    if (mode === 'edit' && dirty) { setAfter('read'); setAsk('leave'); return }
    setMode(next)
  }
  const proceed = () => { setAsk(null); if (after === 'read') setMode('read'); else closeMdReader() }

  useEffect(() => {
    // Window capture, like the image viewer: the village keys step aside while the reader is open.
    const onKeyDown = (event: KeyboardEvent) => {
      const { ask: asking, dirty: isDirty, mode: current, save: doSave } = latest.current
      if (event.key === 'Escape') {
        event.preventDefault()
        if (asking) setAsk(null)
        else if (current === 'edit' && isDirty) { setAfter('close'); setAsk('leave') }
        else closeMdReader()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && current === 'edit') {
        event.preventDefault()
        if (isDirty) void doSave()
      }
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  // Leaving the page with unsaved edits: the browser asks.
  useEffect(() => {
    if (!dirty) return
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()
  const tab = (id: Mode, label: string) => (
    <button
      type="button"
      data-reader-mode={id}
      aria-pressed={mode === id}
      onClick={() => requestMode(id)}
      className={`px-3 py-1 text-[12px] font-bold transition-colors ${mode === id ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-white/10'}`}
    >
      {label}
    </button>
  )
  const choice = 'rounded-md border px-3 py-1.5 text-[12px] font-bold transition'

  return (
    <div
      data-ui-panel="md-reader"
      role="dialog"
      aria-label={name}
      className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      style={{ zIndex: READER_Z }}
      onPointerDown={stop}
      onClick={requestClose}
    >
      <div className="relative flex h-[92vh] w-[min(980px,94vw)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950 text-white shadow-[0_30px_90px_rgba(0,0,0,0.7)]" onClick={stop}>
        <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
          <span aria-hidden>📄</span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-bold" title={name}>{name}{dirty ? ' •' : ''}</span>
          {message && <span data-reader-message className="text-[11px] text-emerald-200/90">{message}</span>}
          <div className="flex overflow-hidden rounded-md border border-white/15" role="group" aria-label="Reader mode">
            {tab('read', 'Read')}
            {tab('edit', 'Edit')}
          </div>
          {mode === 'edit' && (
            <button
              type="button"
              data-reader-save
              disabled={!dirty || saving}
              onClick={() => void save()}
              className="rounded-md border border-emerald-300/50 bg-emerald-400/20 px-3 py-1 text-[12px] font-bold text-emerald-50 transition hover:bg-emerald-400/35 disabled:opacity-40"
              title="Write it back to the file (Ctrl+S)"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          <button type="button" aria-label="Close" onClick={requestClose} className="rounded-md px-2 py-1 text-[16px] text-slate-300 hover:bg-white/10">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadError ? (
            <div className="p-6 text-[13px] text-red-200">Could not open this file: {loadError}</div>
          ) : saved === null ? (
            <div className="p-6 text-[13px] text-slate-400">Opening…</div>
          ) : mode === 'read' ? (
            <div data-reader-rendered className={`mx-auto max-w-[760px] px-6 py-5 ${prose}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
            </div>
          ) : (
            <textarea
              data-reader-text
              value={draft}
              spellCheck={false}
              onChange={event => { setDraft(event.target.value); setMessage(null) }}
              className="block h-full w-full resize-none bg-slate-950 p-5 font-mono text-[13px] leading-relaxed text-slate-100 outline-none"
            />
          )}
        </div>

        {ask && (
          <div data-reader-ask={ask} className="absolute inset-0 z-10 flex items-center justify-center bg-black/60" onClick={stop}>
            <div className="w-[min(420px,88vw)] rounded-xl border border-white/20 bg-slate-900 p-4 shadow-2xl">
              {ask === 'leave' ? (
                <>
                  <div className="text-[14px] font-bold">Do you want to save your changes to {name}?</div>
                  <div className="mt-1 text-[12px] text-slate-400">They are only in this window until you save.</div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button type="button" data-reader-keep className={`${choice} border-white/20 bg-white/5 text-white/85 hover:bg-white/15`} onClick={() => setAsk(null)}>Keep editing</button>
                    <button type="button" data-reader-discard className={`${choice} border-red-300/40 bg-red-400/15 text-red-50 hover:bg-red-400/30`} onClick={() => { setDraft(saved ?? ''); proceed() }}>Discard</button>
                    <button type="button" data-reader-savefirst className={`${choice} border-emerald-300/50 bg-emerald-400/20 text-emerald-50 hover:bg-emerald-400/35`} onClick={() => { void save().then(ok => { if (ok) proceed() }) }}>Save</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[14px] font-bold">{name} changed on disk</div>
                  <div className="mt-1 text-[12px] text-slate-400">The agent may have rewritten it since you opened it. Overwrite it with your version?</div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" className={`${choice} border-white/20 bg-white/5 text-white/85 hover:bg-white/15`} onClick={() => setAsk(null)}>Cancel</button>
                    <button type="button" data-reader-overwrite className={`${choice} border-red-300/40 bg-red-400/15 text-red-50 hover:bg-red-400/30`} onClick={() => void save(true)}>Overwrite</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
