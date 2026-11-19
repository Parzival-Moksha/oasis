'use client'

// ░▒▓ VILLAGE ACADEMY KEYCHAIN — every key an agent can hold, and which of them you hold ▓▒░
// The Character menu's Keys tab (CharacterMenu.tsx owns the frame, the keys and closing): a list of keys
// grouped by kind. Per key: held / missing / unknown, where it was found (a file and a variable's name, a login,
// a plugin: never a value), what it costs, the link to get it, and which skills it opens. A key you hold
// lights its gem on the skill map.
//
// Adding a key: a masked field that writes the value into this Oasis's local .env. The field is not a
// React-controlled input, it is read once when you press Save and emptied at once; the answer from the
// server carries no value, and nothing here sends it to an agent.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { ACADEMY_KEY_COLOR, type AcademyKeyKind } from '../../lib/village/village-academy'
import { KEY_KIND_ABOUT, KEY_KIND_WORD, type KeychainKeyView, type KeyState } from '../../lib/village/keychain'
import { showNotice } from '../forge/GlobalNotice'
import { changeKeychain, getKeychainState, refreshKeychain, subscribeKeychain } from './keychain-store'
import { KitButton, KitCard, KitTabs, useKitStyle } from '../ui-kit'

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

function Row({ item, focused = false }: { item: KeychainKeyView; focused?: boolean }) {
  // Shown because something needed it: its field is open at once, if it is a key you paste.
  const [adding, setAdding] = useState(focused && item.state !== 'have' && item.envNames.length > 0)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(item.envNames[0] || '')
  const input = useRef<HTMLInputElement>(null)
  const kitStyle = useKitStyle()
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
    showNotice(result.restart
      ? `${item.name} saved to this Oasis's ${result.file || '.env'}. Restart the Oasis (Settings) for the spells to see it.`
      : `${item.name} saved to this Oasis's ${result.file || '.env'}; the Oasis reads it again in a few seconds.`, 'info')
    if (result.warning) showNotice(result.warning, 'warn')
  }
  const mark = async (action: 'have' | 'unmark') => {
    setBusy(true)
    const result = await changeKeychain({ key: item.id, action })
    setBusy(false)
    if (!result.ok) showNotice(`Keychain: ${result.error}`, 'error')
  }

  return (
    <KitCard
      data-keychain-row={item.id}
      data-state={item.state}
      data-focused={focused ? '1' : undefined}
      className="transition-shadow"
      style={focused ? { boxShadow: `0 0 0 2px ${color}, 0 0 22px ${color}88` } : undefined}
    >
      {/* The kit's card is a block: the row's layout lives in here. */}
      <div className="flex gap-2.5">
      <Token kind={item.kind} state={item.state} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13.5px] font-bold">{item.name}</span>
          <span className="text-[9.5px] uppercase tracking-[0.14em]" style={{ color }}>{KEY_KIND_WORD[item.kind]}</span>
          <span className="rounded border px-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em]" style={{ color: style.color, borderColor: `${style.color}88` }}>{style.word}</span>
          {item.cost && <span className="text-[11px] opacity-70">{item.cost}</span>}
          {item.link && <a href={item.link} target="_blank" rel="noreferrer" className="text-[11px] font-bold underline underline-offset-2">get it ↗</a>}
        </div>
        {item.note && <div className="mt-0.5 text-[11px] leading-snug opacity-70">{item.note}</div>}
        {item.found.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5">
            {item.found.map((found, index) => (
              <div key={index} className="text-[11px]" title={found.file}>
                <span className="mr-1 font-bold" style={{ color: STATE_STYLE.have.color }}>✓ found:</span>
                {found.source === 'env-file' ? <><span className="font-mono font-bold">{found.name}</span><span className="opacity-70"> in {found.file}</span></> : found.label}
              </div>
            ))}
          </div>
        )}
        {item.spells.length > 0 && (
          <div className="mt-1 text-[11px] leading-snug opacity-80"><span className="mr-1 opacity-70">{item.state === 'have' ? 'spells it opens:' : 'spells waiting for it:'}</span>{item.spells.join(', ')}</div>
        )}
        {item.skills.length > 0 && (
          <div className="mt-1 text-[11px] leading-snug">
            {blocked.length > 0 && <div className="font-bold"><span className="mr-1" style={{ color: STATE_STYLE.missing.color }}>✕ blocks:</span>{blocked.map(skill => skill.name).join(', ')}</div>}
            {others.length > 0 && <div className="opacity-80"><span className="mr-1 opacity-70">{item.state === 'have' ? 'opens:' : 'also for:'}</span>{others.map(skill => skill.name).join(', ')}</div>}
          </div>
        )}
        {adding && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {item.envNames.length > 1 && (
              <span data-kit-style={kitStyle} className="kit-field"><select value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }} className="font-mono text-[11px]">
                {item.envNames.map(option => <option key={option} value={option}>{option}</option>)}
              </select></span>
            )}
            {item.envNames.length === 1 && <span className="font-mono text-[11px] opacity-70">{item.envNames[0]}=</span>}
            {/* A text field drawn as dots, not a password field: a password field outside a form that
                disappears after a request is what browsers take for a login, and they offer to save it. */}
            <span data-kit-style={kitStyle} className="kit-field min-w-[200px] flex-1"><input
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
              className="font-mono text-[12px]"
            /></span>
            <KitButton variant="primary" disabled={busy} onClick={() => { void save() }}>save</KitButton>
            <KitButton disabled={busy} onClick={() => { if (input.current) input.current.value = ''; setAdding(false) }}>cancel</KitButton>
            <div className="basis-full text-[10.5px] opacity-60">Written to this Oasis&rsquo;s local .env only (gitignored), never shown again, never put into a message to an agent.</div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {item.envNames.length > 0 && !adding && <KitButton variant={item.state === 'have' ? 'plain' : 'primary'} data-keychain-add disabled={busy} onClick={() => setAdding(true)}>{item.state === 'have' ? 'replace' : 'add key'}</KitButton>}
        {item.marked && <KitButton data-keychain-unmark disabled={busy} onClick={() => { void mark('unmark') }}>unmark</KitButton>}
        {item.canMark && !item.marked && item.state !== 'have' && <KitButton data-keychain-mark disabled={busy} onClick={() => { void mark('have') }}>mark as have</KitButton>}
      </div>
      </div>
    </KitCard>
  )
}

/** The keychain, filling the box it is put in (the Character menu's Keys tab). `focusKey`: a key to show. */
export function KeychainPanel({ focusKey, focusNonce }: { focusKey: string | null; focusNonce: number }) {
  const { keys, sources, loading, error, scannedAt } = useSyncExternalStore(subscribeKeychain, getKeychainState, getKeychainState)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [lit, setLit] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const kitStyle = useKitStyle()
  const held = keys.filter(key => key.state === 'have').length
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    return keys.filter(key => (filter === 'all' || key.state === filter) && (!words || `${key.name} ${key.short} ${key.id} ${key.kind}`.toLowerCase().includes(words)))
  }, [keys, filter, query])
  const counts = { all: keys.length, have: held, missing: keys.filter(key => key.state === 'missing').length, unknown: keys.filter(key => key.state === 'unknown').length }

  // "Needs a key" somewhere: show that key, lit, with its field open if it is one you paste.
  useEffect(() => {
    if (!focusKey) return
    setFilter('all')
    setQuery('')
    setLit(focusKey)
    const timer = window.setTimeout(() => setLit(current => (current === focusKey ? null : current)), 4000)
    return () => window.clearTimeout(timer)
  }, [focusKey, focusNonce])
  useEffect(() => {
    if (!lit || !keys.length) return
    const row = list.current?.querySelector(`[data-keychain-row="${CSS.escape(lit)}"]`)
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [lit, keys.length])

  return (
    <div data-ui-panel="village-academy-keychain" className="flex h-full min-h-0 flex-col gap-2.5">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="mr-1 text-[12px] opacity-75">{keys.length ? `${held} of ${keys.length} keys held` : loading ? 'Looking…' : 'No keys yet'}{scannedAt ? <span className="opacity-60"> · looked {new Date(scannedAt).toLocaleTimeString()}</span> : null}</div>
        <div className="min-w-[320px]" data-keychain-filters>
          <KitTabs tabs={(['all', 'have', 'missing', 'unknown'] as Filter[]).map(choice => ({ id: choice, label: `${choice} ${counts[choice]}` }))} active={filter} onChange={setFilter} />
        </div>
        <span data-kit-style={kitStyle} className="kit-field min-w-[140px] flex-1"><input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }}
          placeholder="find a key"
          data-voice-mic="off"
          className="text-[12px]"
        /></span>
        <KitButton data-keychain-rescan onClick={() => { void refreshKeychain(true) }} title="Look again on this machine">look again</KitButton>
      </div>

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto pr-1">
        {error && <KitCard className="mb-2 text-[12px] font-bold">{error}</KitCard>}
        {KINDS.map(kind => {
          const rows = shown.filter(key => key.kind === kind)
          if (!rows.length) return null
          return (
            <section key={kind} className="mb-3">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-[10.5px] font-black uppercase tracking-[0.2em]" style={{ color: ACADEMY_KEY_COLOR[kind] }}>{KIND_TITLE[kind]}</span>
                <span className="text-[11px] opacity-65">{KEY_KIND_ABOUT[kind]}</span>
              </div>
              <div className="flex flex-col gap-1.5">{rows.map(item => <Row key={`${item.id}:${lit === item.id ? focusNonce : 0}`} item={item} focused={lit === item.id} />)}</div>
            </section>
          )
        })}
        {!shown.length && !loading && <div className="py-8 text-center text-[12px] opacity-60">{keys.length ? 'No key matches.' : 'Nothing to show.'}</div>}
      </div>

      <div className="shrink-0 pt-2 text-[10.5px] leading-snug opacity-60">
        {sources
          ? `Looked in ${sources.envFiles} .env file${sources.envFiles === 1 ? '' : 's'} (this Oasis and ${Math.max(0, sources.folders - 1)} agent folder${sources.folders === 2 ? '' : 's'}) · Claude CLI: ${sources.claudeLogin} · Codex CLI: ${sources.codexLogin} · GitHub CLI: ${sources.ghLogin} · ${sources.plugins} Claude plugin${sources.plugins === 1 ? '' : 's'}. `
          : ''}
        Only names are read, never values. Nothing leaves this machine.
      </div>
    </div>
  )
}
