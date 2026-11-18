'use client'

// Schedule: when this agent wakes up on its own, in the agent's settings menu (engine schedule.js keeps it in the
// roster). A rhythm (off, every hour, 3 or 6 hours, daily, weekly), its standing prompt (its own, or the default),
// the next wake-up, and its appointments (one-off or repeating; Anorak sets them with scripts/schedule.mjs too).
// Quiet hours and the daily cap are for all agents, in Settings > Agents.

import { useEffect, useState } from 'react'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import type { EngineScheduleEvery } from '../../lib/agent-engine-types'
import { SCHEDULE_CHOICES, WEEKDAYS, formatWake, scheduleTakesTime } from '../../lib/village/village-schedule'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { showNotice } from '../forge/GlobalNotice'

const HEADING = 'mb-1 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-white/55'
const FIELD = 'rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[11px] text-white focus:border-sky-300/60 focus:outline-none'

const failed = (what: string) => (error: unknown) => showNotice(`${what}: ${error instanceof Error ? error.message : String(error)}`, 'error')

export function ScheduleSection({ agent, name }: { agent: Pick<EngineAgentState, 'id' | 'schedule' | 'appointments' | 'nextWake' | 'wakesToday'>; name: string }) {
  const schedule = agent.schedule
  const every: EngineScheduleEvery = schedule?.every || 'off'
  const [prompt, setPrompt] = useState(schedule?.prompt || '')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [apptAt, setApptAt] = useState('')
  const [apptNote, setApptNote] = useState('')
  const [apptRepeat, setApptRepeat] = useState<'' | 'daily' | 'weekly'>('')
  useEffect(() => { setPrompt(schedule?.prompt || '') }, [schedule?.prompt])
  useEffect(() => {
    getAgentEngineClient().scheduleSettings().then(reply => setDefaultPrompt((reply as { data?: { defaultPrompt?: string } })?.data?.defaultPrompt || '')).catch(() => {})
  }, [])

  const client = getAgentEngineClient()
  const set = (patch: { every?: EngineScheduleEvery; at?: string; day?: number; prompt?: string }) => client.setSchedule(agent.id, patch).catch(failed('Schedule not saved'))
  const promptChanged = prompt.trim() !== (schedule?.prompt || '')

  return (
    <div className="mb-3" data-agent-schedule>
      <div className={HEADING}>Schedule · {name}</div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <select
          value={every}
          onChange={event => void set({ every: event.target.value as EngineScheduleEvery })}
          data-agent-schedule-every
          className={FIELD}
          title="When it wakes up on its own and looks at what is its to do. Every wake-up spends the plan's tokens."
        >
          {SCHEDULE_CHOICES.map(choice => <option key={choice.every} value={choice.every}>{choice.label}</option>)}
        </select>
        {every === 'weekly' && (
          <select value={schedule?.day ?? 1} onChange={event => void set({ day: Number(event.target.value) })} className={FIELD} aria-label="Day of the week">
            {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
          </select>
        )}
        {scheduleTakesTime(every) && (
          <label className="flex items-center gap-1 text-white/65" title={every === 'daily' || every === 'weekly' ? 'At this time' : 'The first wake-up of the day; the others follow at the interval'}>
            {every === 'daily' || every === 'weekly' ? 'at' : 'from'}
            <input type="time" value={schedule?.at || (every === 'daily' || every === 'weekly' ? '09:00' : '00:00')} onChange={event => event.target.value && void set({ at: event.target.value })} className={FIELD} data-agent-schedule-at />
          </label>
        )}
      </div>
      <div className="mb-1.5 text-[10.5px] text-white/55" data-agent-next-wake>
        {agent.nextWake ? `Next wake-up: ${formatWake(agent.nextWake.at)} (${agent.nextWake.label})` : 'Nothing wakes it: it acts when someone writes to it.'}
        {agent.wakesToday > 0 && ` · ${agent.wakesToday} today`}
      </div>
      {every !== 'off' && (
        <label className="mb-1.5 block">
          <span className="text-white/65">What it is told when it wakes</span>
          <textarea
            value={prompt}
            rows={4}
            maxLength={2000}
            onChange={event => setPrompt(event.target.value)}
            placeholder={defaultPrompt || 'The default standing prompt'}
            data-agent-schedule-prompt
            className={`${FIELD} w-full resize-y leading-snug`}
          />
          <span className="flex items-center gap-2">
            <button type="button" disabled={!promptChanged} onClick={() => void set({ prompt: prompt.trim() })} className="rounded border border-sky-300/40 bg-sky-400/15 px-2 py-0.5 text-[11px] font-bold text-sky-50 hover:bg-sky-400/30 disabled:cursor-not-allowed disabled:opacity-40">Save</button>
            <span className="text-[10px] text-white/45">{schedule?.prompt ? 'its own words' : 'empty: the default (shown greyed)'}</span>
          </span>
        </label>
      )}

      <div className="mt-2 text-white/65">Appointments</div>
      {agent.appointments.length === 0 && <div className="text-[10.5px] text-white/45">None.</div>}
      {agent.appointments.map(appt => (
        <div key={appt.id} className="flex items-center justify-between gap-2 text-[10.5px] text-white/75" data-agent-appointment={appt.id}>
          <span className="min-w-0 truncate" title={appt.prompt || appt.note}>{formatWake(appt.at)}{appt.repeat ? ` · ${appt.repeat}` : ''} · {appt.note || 'its own prompt'}{appt.by ? <span className="text-white/40"> · {appt.by}</span> : null}</span>
          <button type="button" onClick={() => client.removeAppointment(agent.id, appt.id).catch(failed('Not removed'))} className="shrink-0 text-white/45 hover:text-white" aria-label="Remove this appointment">✕</button>
        </div>
      ))}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <input value={apptAt} onChange={event => setApptAt(event.target.value)} placeholder="wed 16:20" className={`${FIELD} w-[78px]`} aria-label="When" title='"16:20", "wed 16:20", "tomorrow 9:00", "2026-11-25 16:20", "in 30m"' data-agent-appointment-at />
        <input value={apptNote} onChange={event => setApptNote(event.target.value)} placeholder="what for" className={`${FIELD} min-w-0 flex-1`} aria-label="What for" data-agent-appointment-note />
        <select value={apptRepeat} onChange={event => setApptRepeat(event.target.value as '' | 'daily' | 'weekly')} className={FIELD} aria-label="Repeat">
          <option value="">once</option>
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
        </select>
        <button
          type="button"
          disabled={!apptAt.trim() || !apptNote.trim()}
          onClick={() => {
            client.addAppointment(agent.id, { at: apptAt.trim(), note: apptNote.trim(), ...(apptRepeat ? { repeat: apptRepeat } : {}) })
              .then(() => { setApptAt(''); setApptNote('') })
              .catch(failed('Appointment not set'))
          }}
          data-agent-appointment-add
          className="rounded border border-sky-300/40 bg-sky-400/15 px-2 py-0.5 text-[11px] font-bold text-sky-50 hover:bg-sky-400/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <button type="button" onClick={() => client.wakeNow(agent.id).catch(failed('Not woken'))} className="mt-1.5 text-[10.5px] text-white/55 underline-offset-2 hover:text-white hover:underline" data-agent-wake-now>
        wake it now
      </button>
    </div>
  )
}
