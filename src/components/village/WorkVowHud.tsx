'use client'

// ░▒▓ WORK VOW HUD — today's time toward three hours, what is being counted, the week of the vow ▓▒░
// Plain DOM, bottom left, always there in the village. It re-renders when the shown second changes
// (work-vow-client ticks once a second), never per frame. A click opens the detail.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useMindcraftLook } from './mindcraft-look'
import { formatClock, WORK_VALOR, type WorkDayView, type WorkSnapshot, timeToGo } from '../../lib/village/work-vow'
import { GAME_HUD_TEXT } from '../forge/GameKeycap'
import { useOasisStore } from '../../store/oasisStore'
import { getMissionState, subscribeMissions } from './village-mission-store'
import { MindcraftWindow, openMindcraft } from './MindcraftView'
import { getWorkVowState, setWorkFocus, setWorkMission, startWorkVow, subscribeWorkVow } from './work-vow-client'


/** Between an agent's key and its name in the focus selector's string. */
const SEP = String.fromCharCode(1)
const GREEN = '#34d399'
const AMBER = '#fbbf24'
const RED = '#f87171'
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function Ring({ share, color, size = 38 }: { share: number; color: string; size?: number }) {
  const radius = size / 2 - 4
  const length = 2 * Math.PI * radius
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={`${length * Math.min(1, share)} ${length}`} />
    </svg>
  )
}

function DayPip({ day, today, target, liveSeconds }: { day: WorkDayView; today: boolean; target: number; liveSeconds: number }) {
  const seconds = today ? liveSeconds : day.seconds
  const status = seconds >= target ? 'hit' : day.status
  const color = status === 'hit' ? GREEN : status === 'missed' ? RED : status === 'open' ? AMBER : 'rgba(255,255,255,0.3)'
  const weekday = WEEKDAYS[new Date(`${day.date}T12:00:00Z`).getUTCDay()]
  return (
    <span className="flex flex-col items-center gap-0.5" title={`${day.date}: ${formatClock(seconds)} · ${status}`}>
      <span
        className="flex h-[15px] w-[15px] items-center justify-center rounded-[4px] text-[9px] font-black leading-none"
        style={{
          border: `1.5px solid ${color}`,
          background: status === 'hit' ? color : status === 'missed' ? `${RED}33` : 'transparent',
          color: status === 'hit' ? '#04130d' : color,
          boxShadow: today ? `0 0 8px ${color}99` : undefined,
        }}
      >
        {status === 'hit' ? '✓' : status === 'missed' ? '×' : ''}
      </span>
      <span className="text-[8px] leading-none" style={{ color: today ? '#fff' : 'rgba(255,255,255,0.5)' }}>{weekday}</span>
    </span>
  )
}

function Bar({ label, seconds, total, color, right, onClick, open }: { label: string; seconds: number; total: number; color: string; right?: string; onClick?: () => void; open?: boolean }) {
  const share = total > 0 ? seconds / total : 0
  return (
    <div className={onClick ? 'cursor-pointer' : undefined} onClick={onClick}>
      <div className="flex items-baseline justify-between gap-2 text-white/80">
        <span className="min-w-0 break-words">{onClick ? (open ? '▾ ' : '▸ ') : ''}{label}</span>
        <span className="shrink-0 tabular-nums">{right ?? formatClock(seconds)} · {Math.round(share * 100)}%</span>
      </div>
      <div className="mc-track mb-1.5 !h-[7px]"><div className="h-full" style={{ width: `${Math.min(100, share * 100)}%`, background: color }} /></div>
    </div>
  )
}

/** Today's time by what was open (agents fold out into each agent), and the agents' own working hours. */
function WhereTimeWent({ snapshot }: { snapshot: WorkSnapshot }) {
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [hoursOpen, setHoursOpen] = useState(false)
  const day = snapshot.summary
  if (!day) return null
  const withAgents = day.agents.reduce((sum, agent) => sum + agent.seconds, 0)
  const hours = day.agentHours
  return (
    <div className="mt-2">
      <div className="mc-label mb-1">Where your time went</div>
      {day.missions.map(mission => (
        <Bar key={mission.file} label={`${mission.title} ×${WORK_VALOR.mission}`} seconds={mission.seconds} total={day.seconds} color="#38bdf8" right={`${formatClock(mission.seconds)} · ${mission.xp} XP`} />
      ))}
      {day.agentSeconds > 0 && <Bar label={`With agents ×${WORK_VALOR.agent}`} seconds={day.agentSeconds} total={day.seconds} color="#c084fc" />}
      <Bar label={`In the Oasis ×${snapshot.settings?.freeValor ?? WORK_VALOR.free}`} seconds={day.freeSeconds} total={day.seconds} color="#34d399" />
      {withAgents > 0 && (
        <div className="mt-1.5">
          <Bar label="Daily agent work (you, with an agent open)" seconds={withAgents} total={day.seconds} color="#c084fc" onClick={() => setAgentsOpen(value => !value)} open={agentsOpen} />
          {agentsOpen && <div className="ml-3">{day.agents.map(agent => <Bar key={agent.key} label={agent.name} seconds={agent.seconds} total={withAgents} color="#a78bfa" />)}</div>}
        </div>
      )}
      <div className="mt-1.5">
        <Bar label="Agent hours (the Oasis worked)" seconds={hours.totalSeconds} total={Math.max(hours.totalSeconds, 1)} color="#fbbf24" right={`${formatClock(hours.totalSeconds)} · ${hours.xp} XP`} onClick={() => setHoursOpen(value => !value)} open={hoursOpen} />
        {hoursOpen && (
          <div className="ml-3">
            {hours.agents.length === 0 && <div className="text-white/45">No finished turns yet today.</div>}
            {hours.agents.map(agent => (
              <Bar key={agent.key} label={`${agent.name}${agent.helperSeconds ? ` (own ${formatClock(agent.ownSeconds)} + helpers ${formatClock(agent.helperSeconds)})` : ''}`} seconds={agent.totalSeconds} total={hours.totalSeconds} color="#fcd34d" right={`${formatClock(agent.totalSeconds)} · ${agent.xp} XP`} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Detail({ snapshot, liveSeconds, onClose }: { snapshot: WorkSnapshot; liveSeconds: number; onClose: () => void }) {
  const row = 'flex items-baseline justify-between gap-3'
  // What the commitment did to a day: the bonus of a hit, the cost of a miss.
  const stake = (date: string, status: string) => {
    const day = snapshot.commitments?.[0]?.days.find(item => item.date === date)
    if (status === 'hit') return day && day.status === 'hit' ? ` +${day.bonusXp} · hit` : ' · hit'
    if (status === 'missed') return ` −${day?.penaltyXp ?? 0} · missed`
    return ' · open'
  }
  return (
    <div
      data-ui-panel="village-work-vow"
      className="mc-scope mc-popup oasis-frame fixed bottom-[92px] left-3 z-[9300] max-h-[calc(100vh-110px)] w-[350px] overflow-y-auto p-3 text-white shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl max-[700px]:bottom-auto max-[700px]:top-[120px]"
    >
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="mc-eyebrow">Mindcraft · the vow</div>
          <div className="mc-title text-[17px]">{formatClock(snapshot.targetSeconds).replace(/:00$/, '')} hours a day, {snapshot.vow.from.slice(5)} to {snapshot.vow.to.slice(5)}</div>
        </div>
        <button type="button" onClick={onClose} className="mc-close shrink-0">✕</button>
      </div>
      <div className={row}><span className="text-white/60">Today</span><span className="font-bold">{formatClock(liveSeconds)} · {snapshot.today.xp} XP</span></div>
      <button type="button" onClick={() => { onClose(); openMindcraft() }} className="mc-btn mt-2" data-tone="go">
        Open Mindcraft: every day, mine and the agents&rsquo;
      </button>
      <WhereTimeWent snapshot={snapshot} />
      {snapshot.active && (
        <button type="button" onClick={() => { void setWorkMission(null) }} className="mc-btn mt-2" data-tone="stop">
          ■ stop working on “{snapshot.active.title}”
        </button>
      )}
      {snapshot.commitments?.map((c, index) => (
        <div key={index} className="mc-card mt-3 p-2">
          <div className="mc-label">Committed</div>
          <div className="mc-strong text-[13px]">{c.label}</div>
          <div className="text-white/70">A day you hit: its XP <span style={{ color: GREEN }}>×{c.multiplier}</span>. A day you miss: <span style={{ color: RED }}>−{c.penaltyPerMinute} XP</span> for every missing minute.</div>
          {c.today && (
            <div className="mt-1">Today: finish the last {formatClock(c.today.remainingSeconds)} for <span className="font-bold" style={{ color: GREEN }}>+{c.today.bonusIfHit} XP</span>; stop now and it costs <span className="font-bold" style={{ color: RED }}>−{c.today.penaltyIfStopped} XP</span>.</div>
          )}
          <div className="mt-1 text-white/70">So far: <span style={{ color: GREEN }}>+{c.bonusXp}</span> earned, <span style={{ color: RED }}>−{c.penaltyXp}</span> lost.</div>
        </div>
      ))}
      {snapshot.totals && (
        <div className={`${row} mt-2`}><span className="text-white/60">The vow so far</span><span className="font-bold">{snapshot.totals.xp} + {snapshot.totals.bonusXp} − {snapshot.totals.penaltyXp} = {snapshot.totals.netXp} XP</span></div>
      )}
      <div className="mb-1 mt-3 flex items-center justify-between">
        <span className="mc-label">The week</span>
        <span className="flex items-start gap-1 normal-case tracking-normal">
          {snapshot.week.map(day => <DayPip key={day.date} day={day} today={day.date === snapshot.date} target={snapshot.targetSeconds} liveSeconds={liveSeconds} />)}
        </span>
      </div>
      {snapshot.week.map(day => {
        const seconds = day.date === snapshot.date ? liveSeconds : day.seconds
        const status = seconds >= snapshot.targetSeconds ? 'hit' : day.status
        return (
          <div key={day.date} className={row} style={{ color: status === 'hit' ? GREEN : status === 'missed' ? RED : status === 'open' ? '#fff' : 'rgba(255,255,255,0.4)' }}>
            <span>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
            <span>{status === 'ahead' ? '–' : `${formatClock(seconds)} · ${day.xp} XP${stake(day.date, status)}`}</span>
          </div>
        )
      })}
      <div className="mc-foot mt-3 pt-2 leading-snug">
        {snapshot.rule} Time counts while this tab is visible and you did something in the last 3 minutes. To count a mission, open its panel and press “work on this”.
      </div>
    </div>
  )
}

export function WorkVowHud() {
  const state = useSyncExternalStore(subscribeWorkVow, getWorkVowState, getWorkVowState)
  const [open, setOpen] = useState(false)
  useMindcraftLook() // textures and typefaces: mindcraft-look.tsx (the look is Hipster's, the content is ours)
  useEffect(() => startWorkVow(), [])
  // What is open decides where the seconds go: an agent, a mission card, or just the Oasis.
  const agentFocus = useOasisStore(s => {
    const agent = s.agentEngine.focusedAgentId ? s.agentEngine.agents[s.agentEngine.focusedAgentId] : null
    return agent ? `${agent.sessionId || agent.id}\u0001${agent.name || agent.id}` : ''
  })
  const missionFocus = useSyncExternalStore(subscribeMissions, () => getMissionState().reader?.file || null, () => null)
  useEffect(() => {
    const [key, name] = agentFocus.split('\u0001')
    setWorkFocus({ agent: key ? { key, name } : null, mission: missionFocus })
  }, [agentFocus, missionFocus])

  const snapshot = state.snapshot
  // No book yet: say so, in the counter's place. It never just vanishes (it asks again every 5 s).
  if (!snapshot) {
    return (
      <div data-ui-panel="village-work-vow" data-work-vow="reading" className="fixed bottom-3 left-3 z-[170] rounded-xl border border-white/20 bg-slate-950/80 px-3 py-2 text-[11px] text-white/70 max-[700px]:bottom-auto max-[700px]:left-2 max-[700px]:top-[64px]" style={GAME_HUD_TEXT}>
        work counter: reading the book…
      </div>
    )
  }
  const liveSeconds = snapshot.today.seconds + state.pendingSeconds
  const done = liveSeconds >= snapshot.targetSeconds
  const color = done ? GREEN : AMBER
  const openMission = missionFocus ? getMissionState().missions.find(mission => mission.file === missionFocus) : null
  // What is being counted right now, and what a minute of it is worth.
  const free = snapshot.settings?.freeValor ?? WORK_VALOR.free
  const [what, rate]: [string, number] = snapshot.active
    ? [snapshot.active.title, WORK_VALOR.mission]
    : openMission
      ? [openMission.title, WORK_VALOR.mission]
      : agentFocus
        ? [`with ${agentFocus.split(SEP)[1]}`, WORK_VALOR.agent]
        : ['in the Oasis', free]
  const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible'
  const otherSince = state.other?.since ? new Date(state.other.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
  const status = state.automated
    ? 'not counting: this is a test browser'
    : state.unsaved
    ? 'not saved: server unreachable'
    : state.otherTab
      ? `another Oasis tab is counting${state.other?.client ? ` (${state.other.client}${otherSince ? `, since ${otherSince}` : ''})` : ''}`
      : state.running
        ? `counting: ${what} · ${rate} XP/min`
        : hidden ? 'paused: tab hidden' : 'paused: move, type or talk to count'
  const statusColor = state.unsaved ? RED : state.running ? (rate >= 1 ? '#7dd3fc' : '#a7f3d0') : 'rgba(255,255,255,0.55)'

  return (
    <>
      <button
        type="button"
        data-ui-panel="village-work-vow"
        onClick={() => setOpen(value => !value)}
        title="Your work vow: click for the detail"
        data-done={done ? '1' : '0'}
        className="mc-hud fixed bottom-3 left-3 z-[170] flex items-center gap-2.5 rounded-xl border bg-slate-950/80 py-1.5 pl-2 pr-3 text-left text-white shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md transition hover:bg-slate-900/90 max-[700px]:bottom-auto max-[700px]:left-2 max-[700px]:top-[64px]"
        style={{ borderColor: `${color}66`, boxShadow: done ? `0 0 22px ${GREEN}44` : undefined }}
      >
        <span className="relative flex items-center justify-center">
          <Ring share={liveSeconds / snapshot.targetSeconds} color={color} />
          <span className="absolute text-[11px] font-black" style={{ color }}>{done ? '✓' : state.running ? '▶' : '❙❙'}</span>
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-baseline gap-1.5">
            <span className="mc-clock text-[17px] font-bold leading-none tabular-nums" style={{ color: done ? GREEN : '#f1dca8' }}>{formatClock(liveSeconds)}</span>
            {/* What is left, in words (the owner: "okay, 27 minutes away from the three hours"). */}
            <span className="whitespace-nowrap text-[11px] font-bold" style={{ color: done ? GREEN : '#fde68a' }} title={`The goal is ${formatClock(snapshot.targetSeconds)} a day`}>
              {timeToGo(liveSeconds, snapshot.targetSeconds)}
            </span>
          </span>
          <span className="mc-status flex max-w-[min(420px,calc(100vw-120px))] items-start gap-1.5 text-[9.5px] leading-snug" style={{ ...GAME_HUD_TEXT, color: statusColor }} title={state.running ? `Every minute like this earns ${rate} XP. With nothing open it is ${free}; with an agent or a mission open it is 1.` : 'Nothing is being counted right now'}>
            {state.running && <span className="mt-[3px] h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />}
            {/* Never cut off: a long agent or mission name wraps and the counter grows. */}
            <span className="whitespace-normal break-words text-left">{status}</span>
          </span>
        </span>
      </button>
      {open && <Detail snapshot={snapshot} liveSeconds={liveSeconds} onClose={() => setOpen(false)} />}
      <MindcraftWindow />
    </>
  )
}
