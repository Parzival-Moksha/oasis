'use client'

// ░▒▓ SUMMON MENU — summon an agent: a new session, or continue one ▓▒░
// The owner (2026-11-19): "Summon an agent should be like one of the main things in the Oasis", "more like a game",
// "left and right: new session or continue session", "three big input fields", the working folder "not a text
// input field", "a default … you can change if you're advanced". One menu for every kind of agent:
//   Claude Code and Hermes run in the agent engine; Codex and phone call are shown greyed with what is missing.
// Drawn with the Oasis UI kit (components/ui-kit, Hipster's): Settings switches every menu between Glass, Forged, Parchment, Rune.
// The engine lists session metadata only (title, cwd, size, live badge); transcripts are replayed only on spawn.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useUILayer } from '../../lib/input-manager'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import type { EngineAgentSnapshot, EngineSessionMeta, SpawnAgentArgs } from '../../lib/agent-engine-types'
import { filterSessions, pickSuggestions } from '../../lib/village/village-sessions'
import { useVillageSettings } from '../../lib/village/village-settings-client'
import { accountChoices, shownAccounts } from '../../lib/village/village-accounts'
import { FOLDER_SOURCE_WORD, pickDefaultFolder, type HermesProfile } from '../../lib/village/summon-defaults'
import { VILLAGE_PICKER_LAYER, focusVillageAgent, openVillagePicker } from './village-actions'
import { takeSummonKind, type SummonKind } from './summon-request'
import { cwdLabel, formatAgo, formatBytes } from './village-status'
import { FolderBrowser } from './FolderBrowser'
import { getKeychainState, keyStates, openKeychain, refreshKeychain, subscribeKeychain } from './keychain-store'
import { showNotice } from '../forge/GlobalNotice'
import { KitButton, KitPanel, KitSelectField, KitTabs, KitTextField, KitTileButton, kitConfirm } from '@/components/ui-kit'
import { CUSTOM_MODEL_VALUE, cleanModelId, mergeModelLists, type ModelOption } from '../../lib/village/village-models'

const PAGE = 40
const FETCH_STEP = 300
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
/** What the menu remembers between summons: the last folder, half, kind and choices. */
const SUMMON_KEY = 'oasis.village.summon'
/** The Hermes form's last values (older key, kept so Og's ssh host survives). */
const HERMES_FORM_KEY = 'oasis.village.hermesSpawn'

/** Claude Code's permission modes, in words. '' = the agent's settings decide. */
const CLAUDE_MODES: Array<[string, string]> = [
  ['', 'From settings'],
  ['default', 'Ask before acting'],
  ['acceptEdits', 'Accept edits'],
  ['auto', 'Auto'],
  ['plan', 'Plan only'],
  ['bypassPermissions', 'Full access'],
]
/** A Hermes agent's modes (engine hermes.js, ACP session/set_mode). */
const HERMES_MODES: Array<[string, string]> = [
  ['', 'Hermes default'],
  ['default', 'Ask before acting'],
  ['accept_edits', 'Accept edits'],
  ['dont_ask', "Don't ask"],
]

// ─── the look: Hipster's UI kit (components/ui-kit) draws every part; Settings picks Glass / Forged / Parchment / Rune.
// Only layout lives here; the New-session fields use the kit's large size (the owner: "big input fields").
const ACCENT = '#a78bfa'
const TILE = '/ui/spellbook/tiles'
/** A hairline in the panel's own text colour, so it suits every kit style. */
const HAIRLINE = '1px solid color-mix(in srgb, currentColor 14%, transparent)'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface PickerError {
  message: string
  action?: { label: string; run: () => void }
}
type ErrorSink = (error: PickerError | null) => void

interface Remembered {
  lastCwd?: string
  half?: 'new' | 'continue'
  kind?: SummonKind
  model?: string
  claudeMode?: string
  hermesMode?: string
  account?: string
}

function readRemembered(): Remembered {
  try { return JSON.parse(window.localStorage.getItem(SUMMON_KEY) || '{}') as Remembered } catch { return {} }
}
function remember(patch: Remembered): void {
  try { window.localStorage.setItem(SUMMON_KEY, JSON.stringify({ ...readRemembered(), ...patch })) } catch { /* private mode */ }
}

interface HermesRemote { where: 'here' | 'ssh'; host: string; address: string; profile: string }
function readHermesForm(): HermesRemote {
  try {
    const saved = JSON.parse(window.localStorage.getItem(HERMES_FORM_KEY) || '{}') as Partial<HermesRemote>
    return { where: saved.where === 'ssh' ? 'ssh' : 'here', host: saved.host || '', address: saved.address || '', profile: saved.profile || '' }
  } catch {
    return { where: 'here', host: '', address: '', profile: '' }
  }
}

interface SummonDefaults { home: string; workspace: string; hermes: { home: string; profiles: HermesProfile[] } }
let defaultsCache: SummonDefaults | null = null

function useSummonDefaults(open: boolean): SummonDefaults | null {
  const [value, setValue] = useState<SummonDefaults | null>(defaultsCache)
  useEffect(() => {
    if (!open) return
    let live = true
    fetch(`${BASE}/api/local/summon-defaults`, { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then((data: SummonDefaults | null) => { if (data && live) { defaultsCache = data; setValue(data) } })
      .catch(() => { /* the folder line falls back to sessions */ })
    return () => { live = false }
  }, [open])
  return value
}

function useSessionLoader(open: boolean) {
  const dispatch = useOasisStore(s => s.agentEngineDispatch)
  const connected = useOasisStore(s => s.agentEngine.connection.status === 'open')
  const [limit, setLimit] = useState(FETCH_STEP)
  const load = useCallback((nextLimit: number) => {
    dispatch({ type: 'sessions/loading' })
    getAgentEngineClient()
      .listSessions(nextLimit)
      .then(items => dispatch({ type: 'sessions/loaded', items, at: Date.now() }))
      .catch(error => dispatch({ type: 'sessions/error', error: describeError(error) }))
  }, [dispatch])
  useEffect(() => {
    if (!open || !connected) return
    const loadedAt = useOasisStore.getState().agentEngine.sessions.loadedAt
    if (loadedAt && Date.now() - loadedAt < 20000) return
    load(limit)
  }, [open, connected, load, limit])
  return {
    reload: () => load(limit),
    loadOlder: () => {
      const next = limit + FETCH_STEP
      setLimit(next)
      load(next)
    },
    limit,
  }
}

/** What every summon carries: the model, permissions and Claude account picked in the menu. */
interface SpawnChoices {
  model: string
  permissionMode: string
  /** 'auto' or an account id (engine accounts.js); set on the new agent right after it is created. */
  account: string
}

/** Spawn, then pin the account when one was picked (a new agent is idle, so it moves at once). */
function spawnWith(args: SpawnAgentArgs, choices: SpawnChoices): Promise<EngineAgentSnapshot> {
  const client = getAgentEngineClient()
  return client.spawnAgent(args).then(agent => {
    if (args.runtime !== 'hermes' && choices.account && choices.account !== 'auto') {
      client.setAccount(agent.id, choices.account).catch(error => showNotice(`It started, but the account could not be set: ${describeError(error)}`, 'error'))
    }
    return agent
  })
}

// ─── the frame ──────────────────────────────────────────────────────────────

function SummonFrame({ onClose, tall, children }: { onClose: () => void; tall: boolean; children: ReactNode }) {
  return (
    <div
      data-ui-panel="village-picker"
      data-summon-menu
      className="kit-dialog-backdrop max-[700px]:!p-0"
      style={{ zIndex: 9600, padding: 16 }}
      onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <KitPanel
        title="Summon an agent"
        icon={<span aria-hidden style={{ color: ACCENT, fontSize: 18 }}>✦</span>}
        onClose={onClose}
        className={`${tall ? 'h-[min(760px,88vh)]' : 'max-h-[88vh]'} w-[min(900px,100%)] max-[700px]:h-full max-[700px]:w-full`}
      >
        <div className="flex h-full min-h-0 flex-col gap-3">{children}</div>
      </KitPanel>
    </div>
  )
}

const KINDS: Array<{ id: SummonKind; name: string; line: string; icon: string; picture: string; ready: boolean }> = [
  { id: 'claude', name: 'Claude Code', line: 'Codes in a folder, on your Claude plan', icon: '✦', picture: `${TILE}/summon-claude-code.gpt2.webp`, ready: true },
  { id: 'hermes', name: 'Hermes', line: 'Its own model, soul and memory', icon: '☿', picture: `${TILE}/summon-hermes.gpt2.webp`, ready: true },
  { id: 'codex', name: 'Codex', line: 'Not in the engine yet', icon: '◈', picture: `${TILE}/summon-codex.gpt2.webp`, ready: false },
  { id: 'phone', name: 'Phone call', line: 'Live voice: not in the engine yet', icon: '☏', picture: `${TILE}/summon-djinn.gpt2.webp`, ready: false },
]

function KindTabs({ kind, onPick }: { kind: SummonKind; onPick: (kind: SummonKind) => void }) {
  return (
    <div className="grid shrink-0 grid-cols-4 gap-2 max-[700px]:grid-cols-2" role="tablist" aria-label="Kind of agent">
      {KINDS.map(item => {
        const on = item.id === kind
        return (
          <KitTileButton
            key={item.id}
            role="tab"
            aria-selected={on}
            data-summon-kind={item.id}
            onClick={() => onPick(item.id)}
            picture={item.picture}
            icon={item.icon}
            label={item.name}
            sub={item.line}
            selected={on}
            badge={item.ready ? undefined : 'not yet'}
            accent={ACCENT}
            title={item.ready ? `Summon a ${item.name} agent` : `${item.name}: what is missing, and the keys it would use`}
            className="!min-h-[104px]"
            style={item.ready || on ? undefined : { opacity: 0.6 }}
          />
        )
      })}
    </div>
  )
}

function HalfTabs({ half, onPick }: { half: 'new' | 'continue'; onPick: (half: 'new' | 'continue') => void }) {
  return (
    <div className="shrink-0" data-summon-half={half}>
      <KitTabs
        tabs={[
          { id: 'new' as const, label: '＋ New session', title: 'A fresh agent' },
          { id: 'continue' as const, label: '↻ Continue session', title: 'Pick up a session you had' },
        ]}
        active={half}
        onChange={onPick}
      />
    </div>
  )
}

/** The working folder, shown quietly: a line, not a field. "change" opens the folder browser. */
function FolderLine({ folder, note, onChange }: { folder: string; note: string; onChange: () => void }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" data-summon-folder>
      <span className="opacity-70">Works in</span>
      <span className="max-w-[420px] truncate font-mono opacity-80" title={folder}>{folder || '…'}</span>
      {note && <span className="opacity-60">({note})</span>}
      <button type="button" onClick={onChange} title="Pick another folder on this machine" className="rounded px-1.5 py-0.5 underline decoration-dotted underline-offset-2 opacity-70 hover:opacity-100">change</button>
    </div>
  )
}

function ErrorBox({ error, onClear }: { error: PickerError | null; onClear: () => void }) {
  if (!error) return null
  return (
    <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ border: '1px solid rgba(248,113,113,0.6)', background: 'rgba(239,68,68,0.14)' }}>
      <span className="min-w-0 flex-1 break-words">{error.message}</span>
      {error.action && <KitButton variant="danger" onClick={() => { const run = error.action?.run; onClear(); run?.() }}>{error.action.label}</KitButton>}
      <button type="button" aria-label="dismiss" title="Dismiss" onClick={onClear} className="rounded-md px-1.5 py-0.5 text-[12px] font-bold opacity-70 hover:opacity-100">✕</button>
    </div>
  )
}

const stopKeys = (event: React.KeyboardEvent) => { if (event.key !== 'Escape') event.stopPropagation() }

// ─── new session ────────────────────────────────────────────────────────────

function ModelSelect({ value, models, onChange }: { value: string; models: ModelOption[]; onChange: (model: string) => void }) {
  return (
    <KitSelectField
      size="large"
      label="Model"
      title="The Claude model it runs on. From settings: the village's default."
      value={value}
      onChange={event => {
        let model: string | null = event.target.value
        if (model === CUSTOM_MODEL_VALUE) {
          model = cleanModelId(window.prompt('Model id (any the Claude Code CLI takes, e.g. claude-fable-5-2)', ''))
          if (!model) return
        }
        onChange(model || '')
      }}
      onKeyDown={stopKeys}
    >
      <option value="">From settings</option>
      {models.map(model => <option key={model.value} value={model.value}>{model.displayName || model.value}</option>)}
      {value && !models.some(model => model.value === value) && <option value={value}>{value}</option>}
      <option value={CUSTOM_MODEL_VALUE}>Other model id…</option>
    </KitSelectField>
  )
}

function ModeSelect({ value, modes, onChange }: { value: string; modes: Array<[string, string]>; onChange: (mode: string) => void }) {
  return (
    <KitSelectField size="large" label="Permissions" title="What it may do without asking you first." value={value} onChange={event => onChange(event.target.value)} onKeyDown={stopKeys}>
      {modes.map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
    </KitSelectField>
  )
}

function AccountField({ value, onChange }: { value: string; onChange: (account: string) => void }) {
  const view = useOasisStore(s => s.agentEngine.connection.server?.accounts || null)
  if (!view || shownAccounts(view).length < 2) return null
  return (
    <KitSelectField size="large" label="Account" value={value || 'auto'} onChange={event => onChange(event.target.value)} onKeyDown={stopKeys} title="The Claude account its process runs on. Auto: the one whose week ends first.">
      {accountChoices(view).map(choice => <option key={choice.value} value={choice.value}>{choice.value === 'auto' ? 'Auto (the one whose week ends first)' : choice.label}</option>)}
    </KitSelectField>
  )
}

/** Every Claude account out of usage: a new agent would only wait. Said big and plain before you summon one. */
function OutOfUsage() {
  const view = useOasisStore(s => s.agentEngine.connection.server?.accounts || null)
  if (!view?.allExhausted) return null
  const until = view.firstReset ? new Date(view.firstReset) : null
  const when = until ? `${until.toTimeString().slice(0, 5)}${until.toDateString() !== new Date().toDateString() ? ` on ${until.toDateString().slice(0, 10)}` : ''}` : 'its reset'
  return (
    <div role="status" data-summon-out-of-usage className="rounded-lg px-4 py-3 text-[15px] font-bold leading-snug" style={{ border: '1px solid rgba(251,191,36,0.65)', background: 'rgba(251,191,36,0.14)' }}>
      Your Claude usage is used up until {when}.
      <span className="mt-1 block text-[12.5px] font-normal opacity-75">A Claude Code agent summoned now waits until then, and goes on by itself. A Hermes agent runs on its own model.</span>
    </div>
  )
}

function NewClaude({ folder, folderNote, onBrowse, choices, setChoices, models, onDone, onError }: {
  folder: { path: string; create: boolean }
  folderNote: string
  onBrowse: () => void
  choices: SpawnChoices
  setChoices: (patch: Partial<SpawnChoices>) => void
  models: ModelOption[]
  onDone: (agentId: string, cwd: string) => void
  onError: ErrorSink
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = (createCwd = folder.create) => {
    const cwd = folder.path.trim()
    if (!cwd) return
    const args: SpawnAgentArgs = { name: name.trim() || cwdLabel(cwd), cwd }
    if (createCwd) args.createCwd = true
    if (choices.model) args.model = choices.model
    if (choices.permissionMode) args.permissionMode = choices.permissionMode
    setBusy(true)
    onError(null)
    spawnWith(args, choices)
      .then(agent => onDone(agent.id, cwd))
      .catch(error => {
        const message = describeError(error)
        if (!createCwd && message.startsWith('cwd does not exist')) {
          onError({ message: `The folder ${cwd} does not exist yet.`, action: { label: 'Create it and summon', run: () => submit(true) } })
        } else {
          onError({ message: `Summoning failed: ${message}` })
        }
      })
      .finally(() => setBusy(false))
  }
  return (
    <form className="flex flex-col gap-4" data-summon-new="claude" onSubmit={event => { event.preventDefault(); submit() }}>
      <KitTextField size="large" label="Name" value={name} autoFocus onChange={event => setName(event.target.value)} onKeyDown={stopKeys} placeholder={folder.path ? cwdLabel(folder.path) : 'a name'} />
      <div className="grid grid-cols-2 gap-4 max-[700px]:grid-cols-1">
        <ModelSelect value={choices.model} models={models} onChange={model => setChoices({ model })} />
        <ModeSelect value={choices.permissionMode} modes={CLAUDE_MODES} onChange={permissionMode => setChoices({ permissionMode })} />
      </div>
      <AccountField value={choices.account} onChange={account => setChoices({ account })} />
      <OutOfUsage />
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <FolderLine folder={folder.path} note={folderNote} onChange={onBrowse} />
        <KitButton type="submit" variant="primary" disabled={busy || !folder.path.trim()} className="min-w-[160px] !py-3 !text-[14px]">{busy ? 'Summoning…' : 'Summon'}</KitButton>
      </div>
    </form>
  )
}

function NewHermes({ folder, folderNote, onBrowse, profiles, hermesHome, choices, setChoices, onDone, onError }: {
  folder: { path: string; create: boolean }
  folderNote: string
  onBrowse: () => void
  profiles: HermesProfile[] | null
  hermesHome: string
  choices: SpawnChoices
  setChoices: (patch: Partial<SpawnChoices>) => void
  onDone: (agentId: string, cwd: string) => void
  onError: ErrorSink
}) {
  const [name, setName] = useState('')
  const [form, setForm] = useState<HermesRemote>(readHermesForm)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<HermesRemote>) => setForm(current => ({ ...current, ...patch }))
  const ssh = form.where === 'ssh'
  // A profile is only ever a real Hermes home from the list (engine refuses anything else since 8bc9518).
  const known = (profiles || []).some(profile => profile.path === form.profile)
  const profile = known ? form.profile : ''
  const ready = ssh ? Boolean(form.host.trim()) : Boolean(folder.path.trim())
  const submit = (createCwd = folder.create) => {
    if (!ready) return
    const cwd = ssh ? '' : folder.path.trim()
    const host = form.host.trim()
    const args: SpawnAgentArgs = ssh
      ? { runtime: 'hermes', name: name.trim() || host, cwd, remote: { host, ...(form.address.trim() ? { address: form.address.trim() } : {}) } }
      : { runtime: 'hermes', name: name.trim() || (profile ? (profiles || []).find(p => p.path === profile)?.name : '') || 'Hermes', cwd, ...(profile ? { hermesHome: profile } : {}) }
    if (createCwd && !ssh) args.createCwd = true
    if (choices.permissionMode) args.permissionMode = choices.permissionMode
    try { window.localStorage.setItem(HERMES_FORM_KEY, JSON.stringify({ ...form, profile })) } catch { /* private mode */ }
    setBusy(true)
    onError(null)
    spawnWith(args, choices)
      .then(agent => onDone(agent.id, cwd))
      .catch(error => {
        const message = describeError(error)
        if (!createCwd && message.startsWith('cwd does not exist')) {
          onError({ message: `The folder ${cwd} does not exist yet.`, action: { label: 'Create it and summon', run: () => submit(true) } })
        } else {
          onError({ message: `Summoning failed: ${message}` })
        }
      })
      .finally(() => setBusy(false))
  }
  return (
    <form className="flex flex-col gap-4" data-summon-new="hermes" onSubmit={event => { event.preventDefault(); submit() }}>
      <KitTextField size="large" label="Name" value={name} autoFocus onChange={event => setName(event.target.value)} onKeyDown={stopKeys} placeholder="e.g. Jerry" />
      <div className="grid grid-cols-2 gap-4 max-[700px]:grid-cols-1">
          <KitSelectField
            size="large"
            label="Profile"
            value={ssh ? '__ssh' : profile}
            onChange={event => {
              const value = event.target.value
              if (value === '__ssh') set({ where: 'ssh' })
              else set({ where: 'here', profile: value })
            }}
            onKeyDown={stopKeys}
            title="A Hermes profile: its model, its SOUL.md and its memory. Only real Hermes homes on this machine are listed."
          >
            <option value="">{profiles === null ? 'Hermes (its own home)' : `main${(profiles.find(p => p.name === 'main')?.model) ? ` · ${profiles.find(p => p.name === 'main')?.model}` : ''}`}</option>
            {(profiles || []).filter(p => p.name !== 'main' && p.path !== hermesHome).map(p => <option key={p.path} value={p.path}>{p.name}{p.model ? ` · ${p.model}` : ''}</option>)}
            <option value="__ssh">On another machine (ssh)…</option>
          </KitSelectField>
        <ModeSelect value={choices.permissionMode} modes={HERMES_MODES} onChange={permissionMode => setChoices({ permissionMode })} />
      </div>
      {ssh && (
        <div className="grid grid-cols-2 gap-4 max-[700px]:grid-cols-1">
          <KitTextField size="large" label="ssh host" value={form.host} onChange={event => set({ host: event.target.value })} onKeyDown={stopKeys} placeholder="e.g. og" />
          <KitTextField size="large" label="Address (if its name does not resolve)" value={form.address} onChange={event => set({ address: event.target.value })} onKeyDown={stopKeys} placeholder="e.g. 192.168.1.149" />
        </div>
      )}
      <div className="text-[12px] opacity-55">
        {ssh
          ? 'Needs `ssh <host>` to work from this PC with a key, and Hermes installed there. It works in its home folder there; world tools: free ones only.'
          : `Hermes runs here in ${profile || hermesHome || 'its own home'}: that profile's model, SOUL.md and memory. World tools: free ones only. Its shell runs most commands without asking.`}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {ssh ? <span /> : <FolderLine folder={folder.path} note={folderNote} onChange={onBrowse} />}
        <KitButton type="submit" variant="primary" disabled={busy || !ready} className="min-w-[160px] !py-3 !text-[14px]">{busy ? 'Summoning…' : 'Summon'}</KitButton>
      </div>
    </form>
  )
}

// ─── continue session ───────────────────────────────────────────────────────

function SessionRow({ session, choices, onDone, onError }: { session: EngineSessionMeta; choices: SpawnChoices; onDone: (agentId: string) => void; onError: ErrorSink }) {
  const [busy, setBusy] = useState<'spawn' | 'observe' | null>(null)
  // The whole title: the agents menu shows names in full (it only caps runaway ones).
  const name = (session.title || cwdLabel(session.cwd) || 'agent').slice(0, 120)

  const spawn = async () => {
    if (!session.cwd) return
    let fork = false
    if (session.live) {
      const ok = await kitConfirm({
        title: 'It is open somewhere else',
        body: `"${session.title}" is open right now (${session.live.entrypoint || session.live.kind || 'claude'}, ${session.live.status || 'live'}). Driving one session from two places splits its history, so this summons a copy of it; the original stays where it is.`,
        confirm: 'Summon a copy',
      })
      if (!ok) return
      fork = true
    }
    const args: SpawnAgentArgs = { name, cwd: session.cwd, sessionId: session.sessionId, fork }
    if (choices.model) args.model = choices.model
    if (choices.permissionMode) args.permissionMode = choices.permissionMode
    setBusy('spawn')
    onError(null)
    spawnWith(args, choices)
      .then(agent => onDone(agent.id))
      .catch(error => onError({ message: `Summoning failed: ${describeError(error)}` }))
      .finally(() => setBusy(null))
  }

  const observe = () => {
    setBusy('observe')
    onError(null)
    getAgentEngineClient().observe(session.path, name)
      .then(agent => onDone(agent.id))
      .catch(error => onError({ message: `Watching failed: ${describeError(error)}` }))
      .finally(() => setBusy(null))
  }

  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2.5" style={{ borderBottom: HAIRLINE }} data-summon-session>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13.5px] font-bold" title={session.firstPrompt || session.title}>{session.title}</span>
          {session.live && (
            <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-amber-100" title={`open in pid ${session.live.pid} (${session.live.entrypoint || session.live.kind || ''})`}>
              open · {session.live.status || 'live'}
            </span>
          )}
          {!session.live && session.recentlyActive && <span className="rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-100">active</span>}
        </div>
        <div className="mt-0.5 truncate text-[11px] opacity-50" title={session.cwd || session.projectDir}>
          {cwdLabel(session.cwd) || session.projectDir || 'unknown folder'} · {formatAgo(session.mtime)} · {formatBytes(session.size)}
          {session.gitBranch ? ` · ${session.gitBranch}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {session.ownedBy || session.observedBy ? (
          <KitButton onClick={() => onDone((session.ownedBy || session.observedBy) as string)} title="Walk to it">
            {session.ownedBy ? 'In the village' : 'Watching'} · go
          </KitButton>
        ) : (
          <>
            <KitButton disabled={busy !== null} onClick={observe} title="Watch it read-only. Nothing is written to the session.">
              {busy === 'observe' ? '…' : 'Watch'}
            </KitButton>
            <KitButton
              variant="primary"
              disabled={busy !== null || !session.cwd}
              onClick={spawn}
              title={session.live ? 'Open elsewhere: summons a forked copy' : 'Resume it as an agent you can talk to'}
            >
              {busy === 'spawn' ? '…' : session.live ? 'Fork' : 'Continue'}
            </KitButton>
          </>
        )}
      </div>
    </div>
  )
}

function ContinueClaude({ choices, onDone, onError, loader }: { choices: SpawnChoices; onDone: (agentId: string) => void; onError: ErrorSink; loader: ReturnType<typeof useSessionLoader> }) {
  const sessions = useOasisStore(s => s.agentEngine.sessions)
  const anorakCwd = useVillageSettings().anorakProCwd
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  useEffect(() => { setShown(PAGE) }, [query])
  const filtered = useMemo(() => filterSessions(sessions.items, query), [sessions.items, query])
  const anorak = useMemo(() => (query ? null : pickSuggestions(sessions.items, anorakCwd).anorak), [sessions.items, anorakCwd, query])
  const list = anorak ? filtered.filter(session => session.path !== anorak.path) : filtered
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const moreHere = list.length > shown
  const moreThere = sessions.status === 'ready' && sessions.items.length >= loader.limit
  // Scrolling to the end shows more: the next page of the list, then older sessions from the engine.
  useEffect(() => {
    const end = endRef.current
    if (!end || (!moreHere && !moreThere)) return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      if (moreHere) setShown(n => n + PAGE)
      else if (moreThere && sessions.status === 'ready') loader.loadOlder()
    }, { root: scrollRef.current, rootMargin: '200px' })
    observer.observe(end)
    return () => observer.disconnect()
  }, [moreHere, moreThere, sessions.status, loader])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <KitTextField value={query} autoFocus onChange={event => setQuery(event.target.value)} onKeyDown={stopKeys} placeholder="Find a session: title, folder, prompt, branch…" />
        </div>
        <KitButton onClick={loader.reload} title="Read the sessions again">↻</KitButton>
      </div>
      <div className="text-[11px] opacity-45">
        {sessions.status === 'loading' ? 'Reading your sessions…' : sessions.status === 'error' ? `Could not list sessions: ${sessions.error}` : `${filtered.length} sessions${query ? ' found' : ''}, newest first`}
        <span className="opacity-70"> · continues with the model and permissions set under New session</span>
      </div>
      <div ref={scrollRef} className="flex min-h-[220px] flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
        {anorak && <SessionRow session={{ ...anorak, title: `Anorak Pro: ${anorak.title}` }} choices={choices} onDone={onDone} onError={onError} />}
        {list.slice(0, shown).map(session => <SessionRow key={session.path} session={session} choices={choices} onDone={onDone} onError={onError} />)}
        <div ref={endRef} className="py-2 text-center text-[11px] opacity-35">
          {moreHere || moreThere ? (sessions.status === 'loading' ? 'Loading older sessions…' : 'Scroll for more') : list.length ? 'That is all of them' : ''}
        </div>
      </div>
    </div>
  )
}

function ContinueHermes() {
  const hermesAgents = useOasisStore(s => s.agentEngine.order.map(id => s.agentEngine.agents[id]).filter(a => a && (a as { runtime?: string }).runtime === 'hermes').map(a => ({ id: a!.id, name: a!.name })))
  return (
    <div className="flex flex-col gap-3 text-[13px] opacity-85">
      <div>A Hermes agent keeps its own history in Hermes: after a restart it picks its last session up again by itself. There is no list of old Hermes sessions to continue yet.</div>
      {hermesAgents.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="kit-label">Hermes agents in the village</span>
          {hermesAgents.map(agent => (
            <KitButton key={agent.id} onClick={() => { openVillagePicker(false); window.setTimeout(() => focusVillageAgent(agent.id), 0) }} title="Walk to it" className="self-start">
              {agent.name} · go
            </KitButton>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── not in the engine yet ──────────────────────────────────────────────────

function useKeychain() {
  const state = useSyncExternalStore(subscribeKeychain, getKeychainState, getKeychainState)
  useEffect(() => { void refreshKeychain() }, [])
  return state
}

function KeyChip({ id, label, have, onAdd }: { id: string; label: string; have: boolean | null; onAdd: (id: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2.5" style={{ borderBottom: HAIRLINE }} data-summon-key={id}>
      <div>
        <div className="text-[13.5px] font-bold">{label}</div>
        <div className="text-[11px] opacity-50">{have === null ? 'checking your keys…' : have ? 'key found' : 'no key yet'}</div>
      </div>
      {have === false && <KitButton variant="primary" onClick={() => onAdd(id)} title="Opens the Keychain, where a key is stored safely">Add key</KitButton>}
      {have && <span className="text-[11px] font-bold uppercase tracking-[0.1em] opacity-60">ready when it is</span>}
    </div>
  )
}

function NotYet({ kind, onAddKey }: { kind: 'codex' | 'phone'; onAddKey: (id: string) => void }) {
  const keychain = useKeychain()
  const states = keyStates(keychain)
  const have = (id: string): boolean | null => (keychain.scannedAt ? states.get(id) === 'have' : null)
  if (kind === 'codex') {
    const login = keychain.sources?.codexLogin || ''
    return (
      <div className="flex flex-col gap-3" data-summon-not-yet="codex">
        <div className="px-1 py-1 text-[13px] leading-relaxed opacity-85">
          <div className="mb-1 text-[14px] font-black uppercase tracking-[0.12em]">Coming: Codex agents</div>
          A Codex agent cannot be summoned into the village yet. What is missing: a Codex runtime in the agent engine, which today runs only Claude Code and Hermes (it would drive the Codex CLI the way it drives Claude: a session, its messages, permissions and the world tools).
        </div>
        <KeyChip id="chatgpt" label={`ChatGPT login for Codex${login ? ` · ${login}` : ''}`} have={keychain.scannedAt ? Boolean(login) || have('chatgpt') === true : null} onAdd={onAddKey} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3" data-summon-not-yet="phone">
      <div className="px-1 py-1 text-[13px] leading-relaxed opacity-85">
        <div className="mb-1 text-[14px] font-black uppercase tracking-[0.12em]">Coming: phone-call agents</div>
        An agent you talk with live, like a phone call. Not in the engine yet: nothing there holds a live voice line to a provider yet. Which providers you can pick depends on the keys you have:
      </div>
      <KeyChip id="openai" label="OpenAI Realtime" have={have('openai')} onAdd={onAddKey} />
      <KeyChip id="google" label="Gemini Live" have={have('google')} onAdd={onAddKey} />
      <KeyChip id="xai" label="Grok Voice" have={have('xai')} onAdd={onAddKey} />
    </div>
  )
}

// ─── the menu ───────────────────────────────────────────────────────────────

export function SessionPicker() {
  const open = useOasisStore(s => s.agentEngine.pickerOpen)
  const sessions = useOasisStore(s => s.agentEngine.sessions)
  const connected = useOasisStore(s => s.agentEngine.connection.status === 'open')
  // The models the running agents know, merged (a newer agent brings new models to the menu).
  const spawnModelsKey = useOasisStore(s => JSON.stringify(mergeModelLists(Object.values(s.agentEngine.agents).map(a => a.models)).filter(model => model.value !== 'default')))
  const spawnModels = useMemo(() => JSON.parse(spawnModelsKey) as ModelOption[], [spawnModelsKey])
  // Folders your sessions ran in, newest first: the default folder and one tap away in the folder browser.
  const recentFolders = useMemo(() => {
    const seen = new Set<string>()
    return [...sessions.items]
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
      .map(session => session.cwd || '')
      .filter(dir => Boolean(dir) && !seen.has(dir) && Boolean(seen.add(dir)))
      .slice(0, 8)
  }, [sessions.items])
  const summonDefaults = useSummonDefaults(open)
  const [kind, setKind] = useState<SummonKind>('claude')
  const [half, setHalf] = useState<'new' | 'continue'>('new')
  const [claude, setClaude] = useState<SpawnChoices>({ model: '', permissionMode: '', account: 'auto' })
  const [hermesMode, setHermesMode] = useState('')
  const [lastCwd, setLastCwd] = useState('')
  const [pickedCwd, setPickedCwd] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState<PickerError | null>(null)
  useUILayer(VILLAGE_PICKER_LAYER, open)
  const loader = useSessionLoader(open)
  const close = useCallback(() => openVillagePicker(false), [])

  // On open: the remembered choices, and the kind a spell asked for.
  useEffect(() => {
    if (!open) { setError(null); setPickedCwd(''); return }
    const saved = readRemembered()
    setLastCwd(saved.lastCwd || '')
    setHalf(saved.half === 'continue' ? 'continue' : 'new')
    setClaude({ model: saved.model || '', permissionMode: saved.claudeMode || '', account: saved.account || 'auto' })
    setHermesMode(saved.hermesMode || '')
    setKind(takeSummonKind() || (saved.kind === 'hermes' ? 'hermes' : 'claude'))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || browsing) return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [open, close, browsing])

  if (!open) return null

  const fallback = pickDefaultFolder(lastCwd, recentFolders, summonDefaults?.workspace || '')
  const folder = pickedCwd ? { path: pickedCwd, create: false } : fallback
  const folderNote = pickedCwd ? '' : fallback.path ? FOLDER_SOURCE_WORD[fallback.source] : ''
  const hermes = kind === 'hermes'
  const choices: SpawnChoices = hermes ? { model: '', permissionMode: hermesMode, account: 'auto' } : claude

  const pickKind = (next: SummonKind) => {
    setKind(next)
    setError(null)
    if (next === 'claude' || next === 'hermes') remember({ kind: next })
  }
  const pickHalf = (next: 'new' | 'continue') => { setHalf(next); remember({ half: next }) }
  const setChoices = (patch: Partial<SpawnChoices>) => {
    if (hermes) {
      if (patch.permissionMode !== undefined) { setHermesMode(patch.permissionMode); remember({ hermesMode: patch.permissionMode }) }
      return
    }
    setClaude(current => ({ ...current, ...patch }))
    remember({
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.permissionMode !== undefined ? { claudeMode: patch.permissionMode } : {}),
      ...(patch.account !== undefined ? { account: patch.account } : {}),
    })
  }
  const onDone = (agentId: string, cwd?: string) => {
    if (cwd) remember({ lastCwd: cwd })
    close()
    window.setTimeout(() => focusVillageAgent(agentId), 0)
  }
  const onAddKey = (id: string) => {
    close()
    openKeychain(id)
  }

  return (
    <SummonFrame onClose={close} tall={half === 'continue' && kind === 'claude'}>
      {!connected ? (
        <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-[13px] text-amber-100">
          The agent engine is offline. Start it next to the Oasis with <code className="rounded bg-black/40 px-1">pnpm dev:engine</code>.
        </div>
      ) : (
        <>
          <KindTabs kind={kind} onPick={pickKind} />
          {kind === 'codex' || kind === 'phone' ? (
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]"><NotYet kind={kind} onAddKey={onAddKey} /></div>
          ) : (
            <>
              <HalfTabs half={half} onPick={pickHalf} />
              <ErrorBox error={error} onClear={() => setError(null)} />
              <div className="flex min-h-0 flex-1 flex-col pt-1">
                {half === 'new' ? (
                  hermes ? (
                    <NewHermes
                      folder={folder}
                      folderNote={folderNote}
                      onBrowse={() => setBrowsing(true)}
                      profiles={summonDefaults ? summonDefaults.hermes.profiles : null}
                      hermesHome={summonDefaults?.hermes.home || ''}
                      choices={choices}
                      setChoices={setChoices}
                      onDone={onDone}
                      onError={setError}
                    />
                  ) : (
                    <NewClaude folder={folder} folderNote={folderNote} onBrowse={() => setBrowsing(true)} choices={choices} setChoices={setChoices} models={spawnModels} onDone={onDone} onError={setError} />
                  )
                ) : hermes ? <ContinueHermes /> : (
                  <ContinueClaude choices={choices} onDone={id => onDone(id)} onError={setError} loader={loader} />
                )}
              </div>
            </>
          )}
        </>
      )}
      {browsing && (
        <FolderBrowser
          initialPath={folder.path}
          recent={recentFolders}
          onPick={dir => { setPickedCwd(dir); setBrowsing(false) }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </SummonFrame>
  )
}
