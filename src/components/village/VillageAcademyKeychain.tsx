'use client'

// ░▒▓ VILLAGE ACADEMY KEYCHAIN — every key an agent can hold, and which of them you hold ▓▒░
// A plain overlay (the Hipster skins it): the world behind it dimmed and blurred, a list of keys grouped
// by kind. Per key: held / missing / unknown, where it was found (a file and a variable's name, a login,
// a plugin: never a value), what it costs, the link to get it, and which skills it opens. A key you hold
// lights its gem on the skill map.
//
// Adding a key: a masked field that writes the value into this Oasis's local .env. The field is not a
// React-controlled input, it is read once when you press Save and emptied at once; the answer from the
// server carries no value, and nothing here sends it to an agent.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager, useUILayer } from '../../lib/input-manager'
import { ACADEMY_KEY_COLOR, type AcademyKeyKind } from '../../lib/village/village-academy'
import { KEY_KIND_ABOUT, KEY_KIND_WORD, type KeychainKeyView, type KeyState } from '../../lib/village/keychain'
import { showNotice } from '../forge/GlobalNotice'
import { isTypingTarget } from './village-actions'
import { useAcademyEnabled } from './academy-store'
import {
  VILLAGE_ACADEMY_KEYCHAIN_LAYER,
  changeKeychain,
  closeKeychain,
  getKeychainState,
  openKeychain,
  refreshKeychain,
  subscribeKeychain,
} from './keychain-store'
import { VILLAGE_FONT_BODY, VILLAGE_FONT_DISPLAY, VILLAGE_TYPE_CLASS } from './village-status'

const BUTTON = 'rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-bold text-white/85 transition hover:bg-white/15 disabled:opacity-40'
const KINDS: AcademyKeyKind[] = ['subscription', 'api', 'account', 'hardware']
const KIND_TITLE: Record<AcademyKeyKind, string> = { subscription: 'Subscriptions', api: 'API keys', account: 'Accounts', hardware: 'Hardware' }
const STATE_STYLE: Record<KeyState, { word: string; color: string }> = {
  have: { word: 'have', color: '#34d399' },
  missing: { word: 'missing', color: '#fb7185' },
  unknown: { word: 'unknown', color: '#94a3b8' },
}
type Filter = 'all' | KeyState

/** The gem: lit and glowing when held, an outline when not. */
function Token({ kind, state }: { kind: AcademyKeyKind; state: KeyState }) {
  const color = ACADEMY_KEY_COLOR[kind]
  const lit = state === 'have'
  return (
    <span
      data-key-token={state}
      className="mt-1 block h-3.5 w-3.5 shrink-0 rounded-full"
      style={{
        background: lit ? color : 'transparent',
        border: `2px solid ${lit ? '#ffffff' : `${color}${state === 'missing' ? '66' : 'aa'}`}`,
        boxShadow: lit ? `0 0 10px ${color}` : 'none',
      }}
    />
  )
}

function Row({ item }: { item: KeychainKeyView }) {
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(item.envNames[0] || '')
  const input = useRef<HTMLInputElement>(null)
  const color = ACADEMY_KEY_COLOR[item.kind]
  const style = STATE_STYLE[item.state]
  const blocked = item.state !== 'have' ? item.skills.filter(skill => !skill.open) : []
  const others = item.skills.filter(skill => !blocked.includes(skill))

  const save = async () => {
    const field = input.current
    if (!field) return
    const value = field.value
    // Emptied before anything is awaited: it lives in the field and in this one call, nowhere else.
    field.value = ''
    if (!value.trim()) return
    setBusy(true)
    const result = await changeKeychain({ key: item.id, action: 'store', value, name })
    setBusy(false)
    if (!result.ok) {
      showNotice(`Keychain: ${result.error}`, 'error')
      return
    }
    setAdding(false)
    showNotice(`${item.name} saved to this Oasis's ${result.file || '.env'}; the Oasis reads it again in a few seconds.`, 'info')
    if (result.warning) showNotice(result.warning, 'warn')
  }
  const mark = async (action: 'have' | 'unmark') => {
    setBusy(true)
    const result = await changeKeychain({ key: item.id, action })
    setBusy(false)
    if (!result.ok) showNotice(`Keychain: ${result.error}`, 'error')
  }

  return (
    <div data-keychain-row={item.id} data-state={item.state} className="flex gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
      <Token kind={item.kind} state={item.state} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13.5px] font-bold text-white">{item.name}</span>
          <span className="text-[9.5px] uppercase tracking-[0.14em]" style={{ color }}>{KEY_KIND_WORD[item.kind]}</span>
          <span className="rounded border px-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em]" style={{ color: style.color, borderColor: `${style.color}88` }}>{style.word}</span>
          {item.cost && <span className="text-[11px] text-white/55">{item.cost}</span>}
          {item.link && <a href={item.link} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-sky-300 hover:underline">get it ↗</a>}
        </div>
        {item.note && <div className="mt-0.5 text-[11px] leading-snug text-white/55">{item.note}</div>}
        {item.found.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5">
            {item.found.map((found, index) => (
              <div key={index} className="text-[11px] text-emerald-200/90" title={found.file}>
                <span className="mr-1 text-white/40">found:</span>
                {found.source === 'env-file' ? <><span className="font-mono font-bold">{found.name}</span><span className="text-white/50"> in {found.file}</span></> : found.label}
              </div>
            ))}
          </div>
        )}
        {item.skills.length > 0 && (
          <div className="mt-1 text-[11px] leading-snug">
            {blocked.length > 0 && <div className="text-rose-200/90"><span className="mr-1 text-white/40">blocks:</span>{blocked.map(skill => skill.name).join(', ')}</div>}
            {others.length > 0 && <div className="text-white/60"><span className="mr-1 text-white/40">{item.state === 'have' ? 'opens:' : 'also for:'}</span>{others.map(skill => skill.name).join(', ')}</div>}
          </div>
        )}
        {adding && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {item.envNames.length > 1 && (
              <select value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }} className="rounded border border-white/15 bg-black/50 px-1 py-1 font-mono text-[11px] text-white outline-none">
                {item.envNames.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            )}
            {item.envNames.length === 1 && <span className="font-mono text-[11px] text-white/60">{item.envNames[0]}=</span>}
            {/* A text field drawn as dots, not a password field: a password field outside a form that
                disappears after a request is what browsers take for a login, and they offer to save it. */}
            <input
              ref={input}
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              autoFocus
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              // No voice-typing mic on a key (VoiceTypeMic offers one on every text field).
              data-voice-mic="off"
              placeholder="paste the key"
              disabled={busy}
              style={{ WebkitTextSecurity: 'disc' } as CSSProperties}
              onKeyDown={event => {
                if (event.key === 'Escape') { if (input.current) input.current.value = ''; setAdding(false); return }
                event.stopPropagation()
                if (event.key === 'Enter') void save()
              }}
              className="min-w-[200px] flex-1 rounded border border-white/15 bg-black/60 px-2 py-1 font-mono text-[12px] text-white outline-none placeholder:text-white/30 focus:border-amber-300/70"
            />
            <button type="button" className={`${BUTTON} border-emerald-300/45 bg-emerald-400/20 text-emerald-50`} disabled={busy} onClick={() => { void save() }}>save</button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => { if (input.current) input.current.value = ''; setAdding(false) }}>cancel</button>
            <div className="basis-full text-[10.5px] text-white/45">Written to this Oasis&rsquo;s local .env only (gitignored), never shown again, never put into a message to an agent.</div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {item.envNames.length > 0 && !adding && <button type="button" data-keychain-add className={BUTTON} disabled={busy} onClick={() => setAdding(true)}>{item.state === 'have' ? 'replace' : 'add key'}</button>}
        {item.marked && <button type="button" data-keychain-unmark className={BUTTON} disabled={busy} onClick={() => { void mark('unmark') }}>unmark</button>}
        {item.canMark && !item.marked && item.state !== 'have' && <button type="button" data-keychain-mark className={BUTTON} disabled={busy} onClick={() => { void mark('have') }}>mark as have</button>}
      </div>
    </div>
  )
}

function Panel() {
  const { keys, sources, loading, error, scannedAt } = useSyncExternalStore(subscribeKeychain, getKeychainState, getKeychainState)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const held = keys.filter(key => key.state === 'have').length
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    return keys.filter(key => (filter === 'all' || key.state === filter) && (!words || `${key.name} ${key.short} ${key.id} ${key.kind}`.toLowerCase().includes(words)))
  }, [keys, filter, query])
  const counts = { all: keys.length, have: held, missing: keys.filter(key => key.state === 'missing').length, unknown: keys.filter(key => key.state === 'unknown').length }

  return (
    <div
      data-ui-panel="village-academy-keychain"
      className={`fixed inset-0 flex items-center justify-center p-4 text-white ${VILLAGE_TYPE_CLASS}`}
      style={{ zIndex: 9350, fontFamily: VILLAGE_FONT_BODY, background: 'radial-gradient(ellipse at center, rgba(5,8,18,0.62) 0%, rgba(2,4,10,0.85) 100%)', backdropFilter: 'blur(9px) saturate(0.8)', WebkitBackdropFilter: 'blur(9px) saturate(0.8)' }}
      onMouseDown={event => { if (event.target === event.currentTarget) closeKeychain() }}
      onContextMenu={event => event.preventDefault()}
    >
      <div className="flex max-h-full w-full max-w-[940px] flex-col gap-2.5 rounded-xl border border-amber-300/30 bg-slate-950/95 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.55)]">
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div>
            <div className="text-[9.5px] uppercase tracking-[0.26em] text-amber-200/90">Oasis Academy</div>
            <div className="text-[20px] font-bold leading-tight tracking-wide" style={{ fontFamily: VILLAGE_FONT_DISPLAY }}>Keychain</div>
            <div className="mt-0.5 text-[12px] text-white/65">{keys.length ? `${held} of ${keys.length} keys held` : loading ? 'Looking…' : 'No keys yet'}{scannedAt ? <span className="text-white/35"> · looked {new Date(scannedAt).toLocaleTimeString()}</span> : null}</div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" data-keychain-rescan className={BUTTON} onClick={() => { void refreshKeychain(true) }} title="Look again on this machine">look again</button>
            <button type="button" data-keychain-close className={`${BUTTON} text-[12px]`} onClick={closeKeychain} title="Back (Esc)">✕</button>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-white/15" role="radiogroup" aria-label="Show">
            {(['all', 'have', 'missing', 'unknown'] as Filter[]).map(choice => (
              <button key={choice} type="button" role="radio" aria-checked={filter === choice} data-keychain-filter={choice} onClick={() => setFilter(choice)}
                className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${filter === choice ? 'bg-amber-500 text-black' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}>
                {choice} <span className="opacity-60">{counts[choice]}</span>
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }}
            placeholder="find a key"
            className="min-w-[140px] flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[12px] text-white outline-none placeholder:text-white/30 focus:border-sky-300/60"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error && <div className="mb-2 rounded-md border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-[12px] text-rose-100">{error}</div>}
          {KINDS.map(kind => {
            const rows = shown.filter(key => key.kind === kind)
            if (!rows.length) return null
            return (
              <section key={kind} className="mb-3">
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[10.5px] font-black uppercase tracking-[0.2em]" style={{ color: ACADEMY_KEY_COLOR[kind] }}>{KIND_TITLE[kind]}</span>
                  <span className="text-[11px] text-white/45">{KEY_KIND_ABOUT[kind]}</span>
                </div>
                <div className="flex flex-col gap-1.5">{rows.map(item => <Row key={item.id} item={item} />)}</div>
              </section>
            )
          })}
          {!shown.length && !loading && <div className="py-8 text-center text-[12px] text-white/45">{keys.length ? 'No key matches.' : 'Nothing to show.'}</div>}
        </div>

        <div className="shrink-0 border-t border-white/10 pt-2 text-[10.5px] leading-snug text-white/45">
          {sources
            ? `Looked in ${sources.envFiles} .env file${sources.envFiles === 1 ? '' : 's'} (this Oasis and ${Math.max(0, sources.folders - 1)} agent folder${sources.folders === 2 ? '' : 's'}) · Claude CLI: ${sources.claudeLogin} · Codex CLI: ${sources.codexLogin} · GitHub CLI: ${sources.ghLogin} · ${sources.plugins} Claude plugin${sources.plugins === 1 ? '' : 's'}. `
            : ''}
          Only names are read, never values. Nothing leaves this machine.
        </div>
      </div>
    </div>
  )
}

/** Mounted once with the village: the overlay while it is open, and its keys. */
export function VillageAcademyKeychain() {
  const enabled = useAcademyEnabled()
  const open = useSyncExternalStore(subscribeKeychain, () => getKeychainState().open, () => false) && enabled
  const focusedAgentId = useOasisStore(s => s.agentEngine.focusedAgentId)
  useUILayer(VILLAGE_ACADEMY_KEYCHAIN_LAYER, open)

  useEffect(() => {
    if (!enabled) closeKeychain()
  }, [enabled])
  useEffect(() => {
    if (open) useInputManager.getState().releasePointerLock()
  }, [open])
  useEffect(() => {
    if (focusedAgentId) closeKeychain()
  }, [focusedAgentId])
  useEffect(() => useInputManager.subscribe((state, prev) => {
    if (prev._uiLayerStack.includes(VILLAGE_ACADEMY_KEYCHAIN_LAYER) && !state._uiLayerStack.includes(VILLAGE_ACADEMY_KEYCHAIN_LAYER)) closeKeychain()
  }), [])

  // Esc closes it, unless a text field has the keyboard: that field's own Esc (cancel adding a key) goes first.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
      if (isTypingTarget(event.target)) return
      closeKeychain()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [open])

  return open ? <Panel /> : null
}

export { openKeychain }
