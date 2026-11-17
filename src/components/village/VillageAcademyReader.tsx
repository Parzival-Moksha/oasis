'use client'

// ░▒▓ VILLAGE ACADEMY READER — "E open" at a node of the skill tree, and the node's sheet ▓▒░
// Plain DOM over the canvas (mounted by VillageHud), in the mission reader's look: what the skill is,
// the prompt with a Copy button, the proof, the keys with cost and link, XP and minutes, and two
// buttons: "I did it" (claim) and "Ask Anorak to check" (he looks and marks it through /api/academy).
// It also keeps the academy's data fresh and tells the tree which trainee you last picked.

import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager, useUILayer } from '../../lib/input-manager'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import {
  ACADEMY_KEY_COLOR,
  academyCheckMessage,
  academyKeyAction,
  academyLaneColor,
  nodeLook,
  type AcademyContent,
  type AcademyNodeLook,
  type AcademySkill,
  type AcademyTraineeView,
} from '../../lib/village/village-academy'
import { showNotice } from '../forge/GlobalNotice'
import { addVillageProximityRival, getNearbyVillageMini, getSessionPanelGeometry, isTypingTarget, subscribeNearbyVillageMini } from './village-actions'
import {
  VILLAGE_ACADEMY_LAYER,
  academyKeyOf,
  closeAcademyReader,
  getAcademyState,
  openAcademyReader,
  postAcademy,
  readerContent,
  readerTrainee,
  selectAcademyTrainee,
  selectedTrainee,
  startAcademyRefresh,
  subscribeAcademy,
  updateAcademyProximity,
  useAcademyEnabled,
} from './academy-store'
import { KeyPrompt, PromptBanner } from './VillageHud'
import { VillageAcademyMap } from './VillageAcademyMap'
import { VillageAcademyKeychain } from './VillageAcademyKeychain'
import { getKeychainState, openKeychain, refreshKeychain, subscribeKeychain } from './keychain-store'
import { VILLAGE_FONT_BODY, VILLAGE_FONT_DISPLAY, VILLAGE_TYPE_CLASS, canTalkTo } from './village-status'

const LOOK_WORD: Record<AcademyNodeLook, string> = { locked: 'locked', available: 'ready', claimed: 'claimed', verified: 'verified' }
const KIND_WORD = { subscription: 'subscription', api: 'API key', account: 'account', hardware: 'hardware' } as const

function keepKeys(event: ReactKeyboardEvent) {
  // Typing never reaches the world; Esc is the reader's.
  if (event.key !== 'Escape') event.stopPropagation()
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

function when(at: number | undefined): string {
  if (!at) return ''
  const date = new Date(at)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

function Label({ children }: { children: string }) {
  return <div className="mb-1 text-[9.5px] uppercase tracking-[0.2em] text-white/45">{children}</div>
}

function AcademySheet({ skill, content, trainee, trainees }: { skill: AcademySkill; content: AcademyContent; trainee: AcademyTraineeView | null; trainees: AcademyTraineeView[] }) {
  const zIndex = useOasisStore(s => s.getPanelZIndex('village-academy', 9400))
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  // Which of its keys you hold (the keychain looks once per skill opened; the server reuses a look for 45 s).
  const keychainKeys = useSyncExternalStore(subscribeKeychain, () => getKeychainState().keys, () => getKeychainState().keys)
  const held = useMemo(() => new Map(keychainKeys.map(item => [item.id, item.state])), [keychainKeys])
  useEffect(() => { void refreshKeychain() }, [skill.id])
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => { setCopied(false) }, [skill.id])

  const color = academyLaneColor(skill.lane)
  const look = nodeLook(trainee, skill)
  const progress = trainee?.skills[skill.id]
  const geometry = getSessionPanelGeometry(viewport.width, viewport.height)
  const style = geometry.side === 'right'
    ? { right: geometry.margin, top: geometry.margin, width: geometry.width, height: geometry.height }
    : { left: geometry.margin, right: geometry.margin, bottom: geometry.margin, height: geometry.height }
  const button = 'rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10.5px] font-bold text-white/85 transition hover:bg-white/15 disabled:opacity-40'
  const keys = skill.keys.map(id => content.keys.find(key => key.id === id) || { id, name: id, short: id, kind: 'account' as const, cost: '', link: '' })
  const needs = skill.needs.map(id => content.skills.find(item => item.id === id)).filter((item): item is AcademySkill => Boolean(item))

  const mark = async (state: 'none' | 'claimed', by = 'owner'): Promise<boolean> => {
    if (!trainee) return false
    setBusy(true)
    const result = await postAcademy({ trainee: trainee.key, skill: skill.id, state, by })
    setBusy(false)
    if (!result.ok) showNotice(`Academy: ${result.error}`, 'error')
    return result.ok
  }

  const askAnorak = async () => {
    if (!trainee) return
    const engine = useOasisStore.getState().agentEngine
    const agents = engine.order.map(id => engine.agents[id]).filter(Boolean)
    const anorak = agents.filter(agent => /anorak/i.test(agent.name) && canTalkTo(agent) && academyKeyOf(agent) !== trainee.key).sort((a, b) => Number(b.owned) - Number(a.owned))[0]
    if (!anorak) {
      showNotice('No Anorak in the village to ask. Summon one (an agent named Anorak) first.', 'error')
      return
    }
    // Asking for a check is a claim: the node goes half lit while he looks.
    if (look !== 'claimed' && look !== 'verified' && !(await mark('claimed'))) return
    const body = agents.find(agent => academyKeyOf(agent) === trainee.key)
    const text = academyCheckMessage({ name: trainee.name, key: trainee.key, cwd: body?.cwd || null, skill, origin: window.location.origin })
    setBusy(true)
    try {
      await getAgentEngineClient().send(anorak.id, text)
      showNotice(`Asked ${anorak.name} to check "${skill.name}" for ${trainee.name}.`, 'info')
    } catch (error) {
      showNotice(`Could not reach ${anorak.name}: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-ui-panel="village-academy"
      className={`fixed flex flex-col gap-2.5 rounded-xl border bg-slate-950/95 p-3.5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl ${VILLAGE_TYPE_CLASS}`}
      style={{ ...style, zIndex, borderColor: `${color}88`, fontFamily: VILLAGE_FONT_BODY }}
    >
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9.5px] uppercase tracking-[0.26em]" style={{ color }}>Oasis Academy · skill {skill.order} · tier {skill.tier} · {skill.lane}</div>
          <div className="break-words text-[20px] font-bold leading-tight tracking-wide" style={{ fontFamily: VILLAGE_FONT_DISPLAY }}>{skill.name}</div>
        </div>
        <button type="button" className={`${button} text-[12px]`} onClick={closeAcademyReader} title="Back to the world (Esc)">✕</button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11.5px]">
        <label className="flex min-w-0 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5">
          <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/50">trainee</span>
          <select
            data-academy-trainee
            value={trainee?.key || ''}
            onChange={event => selectAcademyTrainee(event.target.value || null)}
            onKeyDown={keepKeys}
            className="max-w-[170px] rounded border border-white/15 bg-black/50 px-1 py-0.5 text-[11.5px] text-white outline-none focus:border-sky-300/70"
          >
            {!trainee && <option value="">nobody yet</option>}
            {trainees.map(item => <option key={item.key} value={item.key}>{item.name}{item.training ? '' : ' (not training)'}</option>)}
          </select>
        </label>
        {trainee && (
          <span className="flex items-baseline gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-0.5" title="Level: verified XP plus half of the claimed XP">
            <span className="font-bold text-amber-300">{trainee.level.name}</span>
            <span className="text-white/60">{trainee.xp.score} XP{trainee.level.next ? ` / ${trainee.level.next.xp}` : ''}</span>
          </span>
        )}
        <span data-academy-state={look} className="rounded-md border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.14em]" style={{ borderColor: look === 'locked' ? '#4b5563' : `${color}aa`, color: look === 'locked' ? '#9ca3af' : color, background: look === 'verified' ? `${color}22` : 'transparent' }}>
          {LOOK_WORD[look]}{look === 'verified' ? ' ✓' : ''}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto break-words pr-2 text-[12.5px] leading-relaxed text-white/90">
        {progress && progress.state !== 'none' && (
          <div className="mb-3 rounded-lg border-l-2 bg-white/5 px-3 py-2" style={{ borderColor: color }}>
            <Label>{`${progress.state}${progress.by ? ` by ${progress.by}` : ''}${progress.at ? ` · ${when(progress.at)}` : ''}`}</Label>
            <div>{progress.proof || (progress.state === 'claimed' ? 'Claimed, not checked yet.' : 'No note.')}</div>
          </div>
        )}

        <Label>What it is</Label>
        <div className="mb-3 text-[13.5px] text-white">{skill.what}</div>

        <div className="mb-1 flex items-center justify-between gap-2">
          <Label>Say this to your agent</Label>
          <button
            type="button"
            data-academy-copy
            className={`${button} ${copied ? 'border-emerald-300/50 bg-emerald-400/20 text-emerald-50' : ''}`}
            onClick={() => { void copyText(skill.prompt).then(ok => { setCopied(ok); if (!ok) showNotice('Could not copy: select the text instead.', 'warn') }) }}
          >
            {copied ? 'copied ✓' : 'Copy'}
          </button>
        </div>
        <div className="mb-3 select-text whitespace-pre-wrap rounded-lg border border-white/12 bg-black/45 px-3 py-2 font-mono text-[12px] leading-relaxed text-emerald-50">{skill.prompt}</div>

        <Label>Proof</Label>
        <div className="mb-3">{skill.proof}</div>

        {keys.length > 0 && (
          <>
            <Label>{keys.length > 1 ? 'Keys: any one of these is enough' : 'Key'}</Label>
            <div className="mb-3 flex flex-col gap-1">
              {keys.map(key => (
                <div key={key.id} data-academy-key={key.id} data-key-state={held.get(key.id) || 'unknown'} className="flex items-start gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1">
                  {/* Held: the gem is lit with a white rim; missing: an outline. */}
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={held.get(key.id) === 'have'
                    ? { background: ACADEMY_KEY_COLOR[key.kind], boxShadow: `0 0 8px ${ACADEMY_KEY_COLOR[key.kind]}`, border: '1.5px solid #fff' }
                    : held.get(key.id) === 'missing'
                      ? { border: `1.5px solid ${ACADEMY_KEY_COLOR[key.kind]}88` }
                      : { background: ACADEMY_KEY_COLOR[key.kind], boxShadow: `0 0 8px ${ACADEMY_KEY_COLOR[key.kind]}` }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-bold text-white">{key.name}</span>
                      <span className="text-[9.5px] uppercase tracking-[0.14em]" style={{ color: ACADEMY_KEY_COLOR[key.kind] }}>{KIND_WORD[key.kind]}</span>
                      {held.get(key.id) === 'have' && <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-emerald-300">you have it</span>}
                    </div>
                    {key.cost && <div className="text-[11.5px] text-white/65">{key.cost}</div>}
                  </div>
                  {key.link && <a href={key.link} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-bold text-sky-300 hover:underline">get it ↗</a>}
                </div>
              ))}
              {skill.way && <div className="text-[11.5px] text-white/60">Easiest way: {skill.way}</div>}
              <button type="button" data-academy-open-keychain className="self-start text-[11px] font-bold text-amber-200 hover:underline" onClick={openKeychain}>open the keychain</button>
            </div>
          </>
        )}

        <div className="mb-3 flex flex-wrap gap-1.5">
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5"><span className="font-bold" style={{ color }}>{skill.xp} XP</span></span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-white/75">about {skill.mins} min</span>
        </div>

        {needs.length > 0 && (
          <>
            <Label>Needs first</Label>
            <div className="flex flex-wrap gap-1.5">
              {needs.map(item => {
                const state = trainee?.skills[item.id]?.state || 'none'
                return (
                  <button key={item.id} type="button" className={button} onClick={() => openAcademyReader(item.id, getAcademyState().readerMap)} title="Open this skill">
                    {item.name} · {state === 'none' ? 'not yet' : state}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 pt-2">
        <button
          type="button"
          data-academy-claim
          disabled={busy || !trainee || look === 'claimed' || look === 'verified'}
          onClick={() => { void mark('claimed') }}
          className={`${button} border-amber-300/45 bg-amber-400/15 px-3 py-2 text-[12px] text-amber-50`}
          title={trainee ? 'Mark it claimed: half the XP counts until someone checks it' : 'Pick a trainee first'}
        >
          I did it
        </button>
        <button
          type="button"
          data-academy-check
          disabled={busy || !trainee || look === 'verified'}
          onClick={() => { void askAnorak() }}
          className={`${button} border-emerald-300/45 bg-emerald-400/20 px-3 py-2 text-[12px] text-emerald-50`}
          title="Anorak looks at the proof (the world, the disk, the trainee's session) and marks it verified, or says why not"
        >
          Ask Anorak to check
        </button>
        {(look === 'claimed' || look === 'verified') && (
          <button type="button" data-academy-reset disabled={busy} onClick={() => { void mark('none') }} className={`${button} ml-auto`} title="Back to not done (for another take)">
            reset
          </button>
        )}
      </div>
      <div className="shrink-0 text-[10px] text-white/40">
        {trainee ? `Progress of ${trainee.name}, kept in data/academy.local.json.` : 'No trainee: open an agent\'s panel and switch Train on.'}
        {content.source === 'sample' ? ' Showing the three sample skills.' : ''}
      </div>
    </div>
  )
}

export function VillageAcademyReader() {
  const enabled = useAcademyEnabled()
  const { content, trainees, nearby, reader, mapOpen } = useSyncExternalStore(subscribeAcademy, getAcademyState, getAcademyState)
  // The open sheet reads the set it was opened from: the map's, or the world's.
  const sheetContent = useSyncExternalStore(subscribeAcademy, () => readerContent(), () => null)
  const sheetTrainee = useSyncExternalStore(subscribeAcademy, () => readerTrainee(), () => null)
  const trainee = useSyncExternalStore(subscribeAcademy, () => selectedTrainee(), () => null)
  const focusedAgentId = useOasisStore(s => s.agentEngine.focusedAgentId)
  const nearMini = useSyncExternalStore(subscribeNearbyVillageMini, getNearbyVillageMini, () => null)
  const open = enabled && reader ? sheetContent?.skills.find(skill => skill.id === reader) || null : null
  const near = enabled && nearby && !mapOpen ? content?.skills.find(skill => skill.id === nearby) || null : null
  useUILayer(VILLAGE_ACADEMY_LAYER, Boolean(open))

  // Progress: every few seconds and when the window is looked at again.
  useEffect(() => (enabled ? startAcademyRefresh() : undefined), [enabled])

  // Which node the owner looks at: the village's proximity tick asks.
  useEffect(() => {
    if (!enabled) return
    const remove = addVillageProximityRival(updateAcademyProximity)
    return () => {
      remove()
      updateAcademyProximity(null, null)
      closeAcademyReader()
    }
  }, [enabled])

  // Reading needs a free mouse (scroll, buttons, the Copy button).
  useEffect(() => {
    if (open) useInputManager.getState().releasePointerLock()
  }, [open])

  // Opening an agent that is in training turns the tree to it; its panel takes the reader's place.
  useEffect(() => {
    if (!focusedAgentId) return
    closeAcademyReader()
    const agent = useOasisStore.getState().agentEngine.agents[focusedAgentId]
    const key = agent ? academyKeyOf(agent) : null
    if (key && getAcademyState().trainees.some(item => item.key === key && item.training)) selectAcademyTrainee(key)
  }, [focusedAgentId])

  // A canvas click pops every UI layer: that closes the reader too.
  useEffect(() => useInputManager.subscribe((state, prev) => {
    if (prev._uiLayerStack.includes(VILLAGE_ACADEMY_LAYER) && !state._uiLayerStack.includes(VILLAGE_ACADEMY_LAYER)) closeAcademyReader()
  }), [])

  // E at a node, E / Esc while reading: before the world's own bindings.
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const current = getAcademyState()
      const village = useOasisStore.getState().agentEngine
      const action = academyKeyAction({
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        repeat: event.repeat,
        typing: isTypingTarget(event.target),
        readerOpen: Boolean(current.reader),
        nearby: Boolean(current.nearby) && !current.mapOpen,
        agent: Boolean(village.focusedAgentId || village.nearbyAgentId || getNearbyVillageMini()),
        worldKeysFree: useInputManager.getState().can().enterFocuses,
      })
      if (!action) return
      if (action === 'close') closeAcademyReader()
      else if (current.nearby) openAcademyReader(current.nearby)
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [enabled])

  const shown = enabled && Boolean(content) && !focusedAgentId
  return (
    <>
      {/* The skill map: K, or the HUD's Skills button. */}
      <VillageAcademyMap />
      {/* The keychain: which keys you hold (also from the menu and the map's bar). */}
      <VillageAcademyKeychain />
      {shown && near && !open && !nearMini && (
        <PromptBanner accent={academyLaneColor(near.lane)} title={`${near.name} · ${LOOK_WORD[nodeLook(trainee, near)]}`}>
          <KeyPrompt k="E" label="Open skill" accent="#38bdf8" primary />
        </PromptBanner>
      )}
      {shown && open && sheetContent && <AcademySheet skill={open} content={sheetContent} trainee={sheetTrainee} trainees={trainees} />}
    </>
  )
}
