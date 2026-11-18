'use client'

// ░▒▓ MINDCRAFT SHEET — one mission, open: read it, edit it, talk in its log ▓▒░
// The 2D window the mission wall opens (E beside the world, F over all of it). Everything written
// here goes to the mission's markdown file through /api/village/missions, then the wall re-reads.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { renderMarkdown } from '../../lib/anorak-renderers'
import { MISSION_COLUMN_COLOR, type Mission } from '../../lib/village/village-missions'
import { MISSION_STATES, parseMissionLog, splitMissionLog, type MissionLogEntry } from '../../lib/village/village-mission-edit'
import { useAgentVoiceInput } from '../../hooks/useAgentVoiceInput'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { findMissionAgent, formatMissionNote } from '../../lib/village/mission-dispatch'
import { showNotice } from '../forge/GlobalNotice'
import { getSessionPanelGeometry } from './village-actions'
import {
  closeMissionReader,
  logMission,
  patchMission,
  saveMissionText,
  setMissionEditing,
  toggleMissionReaderMode,
  type MissionPatch,
} from './village-mission-store'
import { VILLAGE_FONT_BODY, VILLAGE_FONT_DISPLAY, VILLAGE_TYPE_CLASS } from './village-status'
import { formatClock } from '../../lib/village/work-vow'
import { getVillageSettings } from '../../lib/village/village-settings-client'
import { getWorkVowState, setWorkMission, subscribeWorkVow } from './work-vow-client'

const FIELD = 'rounded border border-white/15 bg-black/50 px-1 py-0.5 text-[11.5px] text-white outline-none focus:border-sky-300/70'

/** The mission's own text: under the title, above the log. */
function missionText(mission: Mission): string {
  const { before } = splitMissionLog(mission.markdown)
  const lines = before.split('\n')
  const title = lines.findIndex(line => line.startsWith('# '))
  return lines.slice(title >= 0 ? title + 1 : 0).join('\n').trim()
}

function isOwner(who: string): boolean {
  return /\bowner\b/i.test(who)
}

function keepKeys(event: ReactKeyboardEvent) {
  // Typing never reaches the world; Esc is the reader's (it drops the edit, then closes).
  if (event.key !== 'Escape') event.stopPropagation()
}

function LogThread({ entries, large }: { entries: MissionLogEntry[]; large: boolean }) {
  if (!entries.length) return <div className="text-white/45">No log yet. Write the first line below.</div>
  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, index) => {
        const mine = isOwner(entry.who)
        return (
          <div key={index} className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[92%] rounded-xl border px-3 py-1.5 ${mine ? 'border-emerald-300/30 bg-emerald-400/10' : 'border-white/10 bg-white/5'}`}
            >
              <div className="mb-0.5 flex items-baseline gap-2 text-[9.5px] uppercase tracking-[0.14em] text-white/50">
                <span className="font-bold" style={{ color: mine ? '#6ee7b7' : '#7dd3fc' }}>{entry.who || 'log'}</span>
                <span>{entry.date}{entry.time ? ` ${entry.time}` : ''}</span>
                {entry.guessMatch !== null && <span className="text-amber-200/90" title="How close the guess before this answer was (shared words)">guess match {Math.round(entry.guessMatch * 100)}%</span>}
              </div>
              <div className={large ? 'text-[14.5px]' : 'text-[12.5px]'}>{renderMarkdown(entry.text)}</div>
            </div>
            {entry.guess && (
              <div className="max-w-[86%] self-end rounded-xl border border-dashed border-amber-200/35 bg-amber-300/5 px-3 py-1.5 text-white/75">
                <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.14em] text-amber-200/80">{entry.who || 'agent'} guesses {entry.guess.who} will say</div>
                <div className={large ? 'text-[13.5px]' : 'text-[12px]'}>{entry.guess.text}</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function MissionSheet({ mission, mode }: { mission: Mission; mode: 'side' | 'full' }) {
  const zIndex = useOasisStore(s => s.getPanelZIndex('village-mission', 9400))
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const scroller = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const draftRef = useRef('')
  draftRef.current = draft
  const [busy, setBusy] = useState(false)
  /** The whole file open in a text box: what it was when opened, and what it is now. */
  const [raw, setRaw] = useState<{ expected: string; text: string } | null>(null)
  const [who, setWho] = useState(mission.who)
  const [doneWhen, setDoneWhen] = useState(mission.doneWhen)
  // The mission's timer: the owner's time on it and the agents' time on it, over every day.
  const [timer, setTimer] = useState<{ ownerSeconds: number; agentSeconds: number } | null>(null)
  useEffect(() => {
    let gone = false
    setTimer(null)
    fetch('/api/village/work?missions=1', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then((data: { missions?: Record<string, { ownerSeconds: number; agentSeconds: number }> } | null) => { if (!gone) setTimer(data?.missions?.[mission.file] || { ownerSeconds: 0, agentSeconds: 0 }) })
      .catch(() => {})
    return () => { gone = true }
  }, [mission.file])
  // The work counter: is this the mission being worked on?
  const working = useSyncExternalStore(subscribeWorkVow, () => getWorkVowState().snapshot?.active?.file === mission.file, () => false)

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // The keyboard scrolls the text (arrows, Page Down, Space) as soon as it opens.
  useEffect(() => {
    scroller.current?.focus({ preventScroll: true })
  }, [mission.file, mode])
  // Another mission, or the file changed on disk: the fields follow.
  useEffect(() => { setWho(mission.who) }, [mission.file, mission.who])
  useEffect(() => { setDoneWhen(mission.doneWhen) }, [mission.file, mission.doneWhen])
  useEffect(() => {
    setRaw(null)
    setDraft('')
  }, [mission.file])
  // Esc drops an open text edit before it closes the sheet.
  useEffect(() => {
    setMissionEditing(raw ? () => setRaw(null) : null)
    return () => setMissionEditing(null)
  }, [raw])

  const text = useMemo(() => renderMarkdown(missionText(mission)), [mission])
  const entries = useMemo(() => parseMissionLog(mission.markdown), [mission])
  // A new entry: keep the end of the thread in view.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length, mission.file])

  const run = async (job: Promise<{ ok: boolean; error?: string }>): Promise<boolean> => {
    setBusy(true)
    const result = await job
    setBusy(false)
    if (!result.ok) showNotice(`Mission not saved: ${result.error}`, 'error')
    return result.ok
  }
  const patch = (change: MissionPatch) => { void run(patchMission(mission.file, change)) }
  // Talking is the way in: the mic writes into the box, like the agents' boxes.
  const voiceBase = useRef<string | null>(null)
  const join = (base: string, spoken: string) => (base.trim() && spoken.trim() ? `${base.trim()} ${spoken.trim()}` : `${base}${spoken}`)
  const voice = useAgentVoiceInput({
    onLiveText: spoken => {
      if (voiceBase.current === null) voiceBase.current = draftRef.current
      setDraft(join(voiceBase.current, spoken))
    },
    onTranscript: spoken => {
      setDraft(join(voiceBase.current ?? draftRef.current, spoken))
      voiceBase.current = null
    },
  })
  const send = async () => {
    const message = draft.trim()
    if (!message || busy) return
    if (voice.listening) voice.stop()
    if (!(await run(logMission(mission.file, message)))) return
    setDraft('')
    // A note on a card is a job for someone: it goes to the mission agent (or the agent the mission
    // names), who does it or passes it on. The card says who got it.
    const engine = useOasisStore.getState().agentEngine
    const agents = engine.order.map(id => engine.agents[id]).filter(Boolean)
    const target = engine.connection.status === 'open' ? findMissionAgent(agents, mission.who) : null
    if (!target) {
      showNotice('Logged. No agent in the village to take it: the note waits in the log of the mission.', 'warn')
      return
    }
    try {
      await getAgentEngineClient().send(target.agent.id, formatMissionNote({
        file: mission.file,
        title: mission.title,
        who: mission.who,
        text: message,
        dir: (await getVillageSettings()).missionsDir,
        villageAgents: agents.filter(agent => agent.owned && agent.id !== target.agent.id).map(agent => agent.name),
      }))
      await logMission(mission.file, `Handed to ${target.agent.name}.`, 'Mindcraft')
      showNotice(`Sent to ${target.agent.name}`, 'info')
    } catch (error) {
      showNotice(`Logged, but not sent to ${target.agent.name}: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }
  const saveRaw = async () => {
    if (raw && await run(saveMissionText(mission.file, raw.text, raw.expected))) setRaw(null)
  }

  const color = MISSION_COLUMN_COLOR[mission.column]
  const full = mode === 'full'
  const geometry = getSessionPanelGeometry(viewport.width, viewport.height)
  const style = full
    ? { left: '50%', top: '4%', bottom: '4%', width: `min(980px, ${viewport.width - 32}px)`, transform: 'translateX(-50%)' }
    : geometry.side === 'right'
      ? { right: geometry.margin, top: geometry.margin, width: geometry.width, height: geometry.height }
      : { left: geometry.margin, right: geometry.margin, bottom: geometry.margin, height: geometry.height }
  const button = 'rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10.5px] font-bold text-white/85 transition hover:bg-white/15 disabled:opacity-40'
  const scoreSelect = (key: 'ease' | 'impact' | 'urgency') => (
    <label className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5">
      <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/50">{key}</span>
      <select value={mission[key] ?? ''} disabled={busy} onChange={event => patch({ [key]: Number(event.target.value) })} onKeyDown={keepKeys} className={FIELD}>
        {mission[key] === null && <option value="">–</option>}
        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  )

  return (
    <>
      {full && <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm" style={{ zIndex }} onClick={closeMissionReader} />}
      <div
        data-ui-panel="village-mission"
        className={`fixed flex flex-col gap-2.5 rounded-xl border bg-slate-950/95 text-white shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl ${full ? 'p-6' : 'p-3.5'} ${VILLAGE_TYPE_CLASS}`}
        style={{ ...style, zIndex, borderColor: `${color}88`, fontFamily: VILLAGE_FONT_BODY }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9.5px] uppercase tracking-[0.26em]" style={{ color }}>Mindcraft · {mission.column}</div>
            <div className={`break-words font-bold leading-tight tracking-wide ${full ? 'text-[26px]' : 'text-[18px]'}`} style={{ fontFamily: VILLAGE_FONT_DISPLAY }}>{mission.title}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={`${button} ${working ? 'border-amber-300/50 bg-amber-400/20 text-amber-50' : 'border-emerald-300/45 bg-emerald-400/20 text-emerald-50'}`}
              title={working ? 'Stop: your time is counted on what you have open again' : 'Keep counting your time on this mission after you close the card, until you stop'}
              onClick={() => { void setWorkMission(working ? null : mission.file) }}
            >
              {working ? '■ stop work' : '▶ work on this'}
            </button>
            <button type="button" className={button} disabled={busy} title="Edit the whole file as text" onClick={() => setRaw(raw ? null : { expected: mission.markdown, text: mission.markdown })}>
              {raw ? 'cancel edit' : 'edit text'}
            </button>
            <button type="button" className={`${button} font-mono`} onClick={toggleMissionReaderMode} title={full ? 'Back beside the world (F)' : 'Over the whole screen (F)'}>
              {full ? 'F side' : 'F full screen'}
            </button>
            <button type="button" className={`${button} text-[12px]`} onClick={closeMissionReader} title="Back to the world (Esc)">✕</button>
          </div>
        </div>

        {raw ? (
          <>
            <textarea
              autoFocus
              value={raw.text}
              onChange={event => setRaw({ expected: raw.expected, text: event.target.value })}
              onKeyDown={event => {
                keepKeys(event)
                if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void saveRaw()
                }
              }}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded-lg border border-white/15 bg-black/50 p-3 font-mono text-[12.5px] leading-relaxed text-white outline-none focus:border-sky-300/70"
            />
            <div className="flex shrink-0 items-center gap-2 text-[10.5px] text-white/50">
              <button type="button" className={`${button} border-emerald-300/45 bg-emerald-400/20 text-emerald-50`} disabled={busy || raw.text === raw.expected} onClick={() => { void saveRaw() }}>save (Ctrl+S)</button>
              <button type="button" className={button} onClick={() => setRaw(null)}>cancel (Esc)</button>
              <span>The first lines are the header: state, who, done when, score. Keep a blank line after them.</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11.5px]">
              <span className="flex items-baseline gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-0.5" title="ease × impact × urgency ÷ 125">
                <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/50">priority</span>
                <span className="font-bold" style={{ color }}>{mission.priority === null ? '–' : mission.priority.toFixed(2)}</span>
              </span>
              <label className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5">
                <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/50">state</span>
                <select value={mission.state} disabled={busy} onChange={event => patch({ state: event.target.value })} onKeyDown={keepKeys} className={FIELD}>
                  {!MISSION_STATES.includes(mission.state) && <option value={mission.state}>{mission.state}</option>}
                  {MISSION_STATES.map(state => <option key={state} value={state}>{state}</option>)}
                </select>
              </label>
              {timer && (
                <span className="flex items-baseline gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-0.5" title="Time counted on this mission, over every day: yours (the card open, or 'work on this'), and the agents' working time booked on it">
                  <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/50">time</span>
                  <span className="font-bold">you {formatClock(timer.ownerSeconds)} · agents {formatClock(timer.agentSeconds)}</span>
                </span>
              )}
              {scoreSelect('ease')}
              {scoreSelect('impact')}
              {scoreSelect('urgency')}
              <label className="flex min-w-[160px] flex-1 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5">
                <span className="text-[9.5px] uppercase tracking-[0.14em] text-white/50">who</span>
                <input
                  value={who}
                  onChange={event => setWho(event.target.value)}
                  onBlur={() => { if (who.trim() !== mission.who) patch({ who }) }}
                  onKeyDown={event => {
                    keepKeys(event)
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                  className={`${FIELD} min-w-0 flex-1`}
                />
              </label>
            </div>
            <label className={`flex shrink-0 items-start gap-2 rounded-lg border-l-2 bg-white/5 px-3 py-2 leading-snug ${full ? 'text-[15px]' : 'text-[12.5px]'}`} style={{ borderColor: color }}>
              <span className="mt-0.5 shrink-0 text-[9.5px] uppercase tracking-[0.14em] text-white/50">done when</span>
              <textarea
                value={doneWhen}
                rows={2}
                onChange={event => setDoneWhen(event.target.value)}
                onBlur={() => { if (doneWhen.trim() !== mission.doneWhen) patch({ doneWhen }) }}
                onKeyDown={event => {
                  keepKeys(event)
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                }}
                placeholder="one sentence a person can check"
                className="min-w-0 flex-1 resize-none bg-transparent text-white outline-none placeholder:text-white/30"
              />
            </label>
            <div
              ref={scroller}
              tabIndex={-1}
              className={`min-h-0 flex-1 overflow-y-auto break-words pr-2 leading-relaxed text-white/90 outline-none ${full ? 'text-[15px]' : 'text-[12.5px]'}`}
            >
              {mission.pictureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mission.pictureUrl} alt="" className="mb-3 aspect-video w-full rounded-lg border border-white/10 object-cover" />
              )}
              {text}
              <div className="mb-2 mt-4 flex items-center gap-2 text-[9.5px] uppercase tracking-[0.26em] text-white/45">
                <span>Log</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <LogThread entries={entries} large={full} />
            </div>
            <div className="flex shrink-0 items-end gap-2 border-t border-white/10 pt-2">
              <textarea
                value={draft}
                rows={2}
                disabled={busy}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  keepKeys(event)
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                placeholder="Say or type a note: it goes into the log and to an agent, who starts on it (Enter sends)"
                className="min-w-0 flex-1 resize-none rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-[12.5px] text-white outline-none placeholder:text-white/35 focus:border-emerald-300/60"
              />
              {voice.supported && (
                <button
                  type="button"
                  className={`${button} px-2.5 py-2 ${voice.listening ? 'border-rose-300/60 bg-rose-500/30 text-rose-50' : ''}`}
                  title={voice.listening ? 'Stop the mic' : 'Talk: your words appear in the box'}
                  onClick={() => voice.toggle()}
                >
                  {voice.listening ? '■ mic' : '🎙'}
                </button>
              )}
              <button type="button" className={`${button} border-emerald-300/45 bg-emerald-400/20 px-3 py-2 text-emerald-50`} disabled={busy || !draft.trim()} onClick={() => { void send() }}>log it</button>
            </div>
          </>
        )}
        <div className="shrink-0 text-[10px] text-white/40">{mission.file} · saved to the markdown file; a change on disk shows here within half a minute</div>
      </div>
    </>
  )
}
