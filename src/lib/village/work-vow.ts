// ░▒▓ WORK VOW — the Mindcraft counter: time worked in the Oasis, per day, turned into XP ▓▒░
// Pure: no fs, no DOM. The server keeps the file (work-vow-server.ts), the page reports in small
// steps (work-vow-client.ts).
//
// The rule, in one sentence: every active minute earns valor × (1 + priority) XP, where time on a
// mission has valor 1 and that mission's priority, and time just being in the Oasis has valor 0.7
// and no priority.
// (The old Mindcraft score was minutes × valor × priority with priority 0 to 8; priority is 0 to 1
// now, so the "1 +" keeps a mission minute worth more than a free one, never less.)

export const WORK_VALOR = { mission: 1, free: 0.7 }
/** No key, mouse, walking or dictation for this long: the counter stops. */
export const WORK_IDLE_MS = 3 * 60 * 1000
/** The page reports this often. */
export const WORK_BEAT_MS = 15_000
/** A tab that hasn't reported for this long has gone: another tab may count. */
export const WORK_HOLDER_STALE_MS = 50_000
export const WORK_RULE = 'Every active minute earns valor × (1 + priority) XP: on a mission valor 1 and that mission\'s priority, just being in the Oasis valor 0.7 and no priority. A committed day that is hit counts double; a committed day that is missed costs 7 XP for every missing minute.'

/**
 * A commitment, the first Mindcraft's way (v0.1, 2025): what you commit to counts double, and what
 * you don't deliver costs ten times the missing minutes. Here: so many seconds a day, from a day to
 * a day, of any time in the Oasis or of one mission's time.
 */
export interface WorkVow {
  /** First and last day, local dates. */
  from: string
  to: string
  dailySeconds: number
  /** A day that is hit earns its XP times this (the counted time's XP). Default 2. */
  multiplier?: number
  /** A day that is missed costs the missing minutes times this, at the free-time rate (0.7 XP a minute). Default 10. */
  penaltyFactor?: number
  /** Only this mission's time counts (a commitment to a mission); none: all time in the Oasis. */
  mission?: string
  label?: string
}

export const COMMIT_MULTIPLIER = 2
export const COMMIT_PENALTY_FACTOR = 10

/** The owner's vow of 2026-11-16: three hours a day until the move to Vienna. */
export const DEFAULT_VOW: WorkVow = { from: '2026-11-16', to: '2026-11-22', dailySeconds: 3 * 3600, multiplier: COMMIT_MULTIPLIER, penaltyFactor: COMMIT_PENALTY_FACTOR, label: 'At least three hours a day in the Oasis' }

export interface WorkMissionTime {
  title: string
  /** The mission's priority while it was worked on (the latest). */
  priority: number
  seconds: number
  xp: number
}

export interface WorkDay {
  freeSeconds: number
  freeXp: number
  /** By mission file. */
  missions: Record<string, WorkMissionTime>
}

export interface WorkActive {
  file: string
  title: string
  priority: number
  /** ms */
  startedAt: number
}

export interface WorkFile {
  v: 1
  vow: WorkVow
  /** More commitments, e.g. to one mission (`mission` set). */
  commitments?: WorkVow[]
  /** By local date, `2026-11-16`. */
  days: Record<string, WorkDay>
  /** The mission being worked on (survives a reload). */
  active: WorkActive | null
  /** The one tab that counts, and the moment up to which its time is in the book. */
  holder: { tab: string; seq: number; at: number } | null
  /** The tab that last let go (it was closing): a late report from it must not take the place back. */
  released?: string
}

export function emptyWorkFile(): WorkFile {
  return { v: 1, vow: { ...DEFAULT_VOW }, days: {}, active: null, holder: null }
}

/** A file from disk, made safe: anything missing or odd is dropped, never the days that are fine. */
export function parseWorkFile(value: unknown): WorkFile {
  const file = emptyWorkFile()
  if (!value || typeof value !== 'object') return file
  const raw = value as Partial<WorkFile>
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)
  const vow = (v: unknown): WorkVow | null => {
    const c = v as Partial<WorkVow> | null
    if (!c || typeof c !== 'object' || typeof c.from !== 'string' || typeof c.to !== 'string' || !num(c.dailySeconds)) return null
    return {
      from: c.from,
      to: c.to,
      dailySeconds: c.dailySeconds as number,
      multiplier: typeof c.multiplier === 'number' && c.multiplier >= 1 ? c.multiplier : COMMIT_MULTIPLIER,
      penaltyFactor: typeof c.penaltyFactor === 'number' && c.penaltyFactor >= 0 ? c.penaltyFactor : COMMIT_PENALTY_FACTOR,
      ...(typeof c.mission === 'string' && c.mission ? { mission: c.mission } : {}),
      ...(typeof c.label === 'string' && c.label ? { label: c.label } : {}),
    }
  }
  file.vow = vow(raw.vow) || file.vow
  if (!file.vow.label) file.vow.label = DEFAULT_VOW.label
  const more = (Array.isArray(raw.commitments) ? raw.commitments : []).map(vow).filter((c): c is WorkVow => c !== null)
  if (more.length) file.commitments = more
  for (const [date, day] of Object.entries(raw.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || typeof day !== 'object') continue
    const missions: Record<string, WorkMissionTime> = {}
    for (const [key, m] of Object.entries(day.missions || {})) {
      if (m && typeof m === 'object') missions[key] = { title: String(m.title || key), priority: num(m.priority), seconds: num(m.seconds), xp: num(m.xp) }
    }
    file.days[date] = { freeSeconds: num(day.freeSeconds), freeXp: num(day.freeXp), missions }
  }
  if (raw.active && typeof raw.active.file === 'string') {
    file.active = { file: raw.active.file, title: String(raw.active.title || raw.active.file), priority: num(raw.active.priority), startedAt: num(raw.active.startedAt) }
  }
  if (typeof raw.released === 'string') file.released = raw.released
  if (raw.holder && typeof raw.holder.tab === 'string') file.holder = { tab: raw.holder.tab, seq: num(raw.holder.seq), at: num(raw.holder.at) }
  return file
}

// ─── days ───────────────────────────────────────────────────────────────────

/** Minutes to add to UTC for local time (Vienna in November: 60). Default: this machine's. */
export function localOffsetMinutes(ms: number): number {
  return -new Date(ms).getTimezoneOffset()
}

/** The local date of a moment: `2026-11-16`. */
export function localDay(ms: number, offsetMinutes = localOffsetMinutes(ms)): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

/** The first moment of the local day that `ms` falls in. */
export function localMidnight(ms: number, offsetMinutes = localOffsetMinutes(ms)): number {
  const shifted = ms + offsetMinutes * 60_000
  return shifted - (((shifted % 86_400_000) + 86_400_000) % 86_400_000) - offsetMinutes * 60_000
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function daySeconds(day: WorkDay | undefined): number {
  if (!day) return 0
  return day.freeSeconds + Object.values(day.missions).reduce((sum, mission) => sum + mission.seconds, 0)
}

export function dayXp(day: WorkDay | undefined): number {
  if (!day) return 0
  return Math.round((day.freeXp + Object.values(day.missions).reduce((sum, mission) => sum + mission.xp, 0)) * 10) / 10
}

/** XP for seconds of one kind of time. */
export function xpFor(seconds: number, valor: number, priority: number): number {
  return (seconds / 60) * valor * (1 + Math.max(0, priority))
}

// ─── counting on the page ───────────────────────────────────────────────────

/**
 * How much of [from, to] counts: only while the tab is visible, and only up to WORK_IDLE_MS after
 * the last input. Whole milliseconds; the caller keeps the remainder.
 */
export function activeMsBetween(from: number, to: number, lastInputAt: number | null, visible: boolean, idleMs = WORK_IDLE_MS): number {
  if (!visible || lastInputAt === null || to <= from) return 0
  return Math.max(0, Math.min(to, lastInputAt + idleMs) - from)
}

// ─── the book (server) ──────────────────────────────────────────────────────

export interface WorkBeat {
  /** One id per page load. */
  tab: string
  /** Counts up with every report of this tab: a repeated report is not counted twice. */
  seq: number
  /** Active seconds since this tab's last report. */
  seconds: number
  /** This tab let go while hidden and is in front again: it may take the place back. */
  back?: boolean
}

export interface WorkBeatResult {
  file: WorkFile
  /** This tab is the one that counts. */
  counting: boolean
  /** Seconds that went into the book. */
  credited: number
}

function addSeconds(file: WorkFile, date: string, seconds: number): void {
  if (seconds <= 0) return
  const day = file.days[date] || (file.days[date] = { freeSeconds: 0, freeXp: 0, missions: {} })
  const active = file.active
  if (!active) {
    day.freeSeconds += seconds
    day.freeXp += xpFor(seconds, WORK_VALOR.free, 0)
    return
  }
  const mission = day.missions[active.file] || (day.missions[active.file] = { title: active.title, priority: active.priority, seconds: 0, xp: 0 })
  mission.title = active.title
  mission.priority = active.priority
  mission.seconds += seconds
  mission.xp += xpFor(seconds, WORK_VALOR.mission, active.priority)
}

/**
 * One report from a page. One tab counts at a time: another tab is turned away until the counting
 * one has been silent for WORK_HOLDER_STALE_MS. A tab can never put more seconds in the book than
 * the clock moved since its last report, so a reload, a retry or a second tab cannot double-count.
 * Seconds that straddle local midnight are split between the two days.
 */
export function applyWorkBeat(input: WorkFile, beat: WorkBeat, now: number, offsetMinutes = localOffsetMinutes(now)): WorkBeatResult {
  const file: WorkFile = JSON.parse(JSON.stringify(input))
  const holder = file.holder
  const mine = holder?.tab === beat.tab
  if (holder && !mine && now - holder.at < WORK_HOLDER_STALE_MS) return { file: input, counting: false, credited: 0 }
  // A report that was still on its way when its page let go: too late, the page is gone.
  if (!holder && file.released === beat.tab && !beat.back) return { file: input, counting: false, credited: 0 }
  if (!holder || !mine) {
    delete file.released
    // Taking over (or the first tab ever): the clock starts now, nothing reported before counts.
    file.holder = { tab: beat.tab, seq: beat.seq, at: now }
    return { file, counting: true, credited: 0 }
  }
  if (beat.seq <= holder.seq) return { file: input, counting: true, credited: 0 }
  // Rounded up: reports arrive a few ms early or late, and a second must not be lost on each.
  const wall = Math.max(0, Math.ceil((now - holder.at) / 1000))
  const credited = Math.max(0, Math.min(Math.floor(beat.seconds) || 0, wall))
  if (credited > 0) {
    // The credited seconds end now: what lies before local midnight belongs to yesterday.
    const midnight = localMidnight(now, offsetMinutes)
    const today = Math.min(credited, Math.floor((now - midnight) / 1000))
    addSeconds(file, localDay(now, offsetMinutes), today)
    addSeconds(file, localDay(midnight - 1, offsetMinutes), credited - today)
  }
  file.holder = { tab: beat.tab, seq: beat.seq, at: now }
  return { file, counting: true, credited }
}

/** A page that is closing lets go, so the next one (a reload) counts at once. */
export function releaseWorkHolder(input: WorkFile, tab: string): WorkFile {
  if (input.holder?.tab !== tab) return input
  return { ...input, holder: null, released: tab }
}

/** Start working on a mission (stops the one before), or stop: `mission` null. */
export function setWorkMission(input: WorkFile, mission: { file: string; title: string; priority: number } | null, now: number): WorkFile {
  const file: WorkFile = JSON.parse(JSON.stringify(input))
  file.active = mission ? { ...mission, startedAt: now } : null
  return file
}

// ─── commitments ────────────────────────────────────────────────────────────

export interface CommitmentDay {
  date: string
  /** The seconds that count for this commitment. */
  seconds: number
  status: WorkDayStatus
  /** Hit: the extra XP the multiplier gave. Open: what it will give if the day is finished at this pace. */
  bonusXp: number
  /** Missed: the XP it cost (a positive number). Open: what stopping now would cost. */
  penaltyXp: number
}

export interface CommitmentView {
  label: string
  from: string
  to: string
  dailySeconds: number
  multiplier: number
  penaltyFactor: number
  mission: string | null
  /** XP a missing minute costs. */
  penaltyPerMinute: number
  days: CommitmentDay[]
  /** Earned and lost so far (days that are over or already hit). */
  bonusXp: number
  penaltyXp: number
  /** Today, while it is still open: what is at stake. Null outside the commitment or once today is hit. */
  today: { remainingSeconds: number; bonusIfHit: number; penaltyIfStopped: number } | null
}

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * One commitment against the book. A day that reached its seconds is hit: the XP of the counted time
 * is multiplied (the bonus is the extra). A past day that fell short is missed: every missing minute
 * costs penaltyFactor × the free-time rate. Today is open until it is hit or over.
 */
export function evaluateCommitment(file: WorkFile, commitment: WorkVow, today: string): CommitmentView {
  const multiplier = commitment.multiplier ?? COMMIT_MULTIPLIER
  const penaltyFactor = commitment.penaltyFactor ?? COMMIT_PENALTY_FACTOR
  const perMinute = penaltyFactor * WORK_VALOR.free
  const days: CommitmentDay[] = []
  let bonusXp = 0
  let penaltyXp = 0
  let stake: CommitmentView['today'] = null
  for (let d = commitment.from, guard = 0; d <= commitment.to && guard < 400; d = addDays(d, 1), guard += 1) {
    const day = file.days[d]
    const counted = commitment.mission ? day?.missions[commitment.mission] : null
    const seconds = commitment.mission ? counted?.seconds || 0 : daySeconds(day)
    const xp = commitment.mission ? counted?.xp || 0 : (day ? day.freeXp + Object.values(day.missions).reduce((sum, m) => sum + m.xp, 0) : 0)
    const status: WorkDayStatus = seconds >= commitment.dailySeconds ? 'hit' : d < today ? 'missed' : d === today ? 'open' : 'ahead'
    const missing = Math.max(0, commitment.dailySeconds - seconds) / 60
    const bonus = status === 'hit' ? xp * (multiplier - 1) : 0
    const penalty = status === 'missed' ? missing * perMinute : 0
    bonusXp += bonus
    penaltyXp += penalty
    if (status === 'open') {
      // Finishing at the rate of the time so far (free rate when nothing is counted yet).
      const rate = seconds > 0 ? xp / seconds : xpFor(1, WORK_VALOR.free, 0)
      stake = { remainingSeconds: commitment.dailySeconds - seconds, bonusIfHit: round1((xp + rate * (commitment.dailySeconds - seconds)) * (multiplier - 1)), penaltyIfStopped: round1(missing * perMinute) }
    }
    days.push({ date: d, seconds, status, bonusXp: round1(status === 'open' && stake ? stake.bonusIfHit : bonus), penaltyXp: round1(status === 'open' && stake ? stake.penaltyIfStopped : penalty) })
  }
  return {
    label: commitment.label || (commitment.mission ? `${formatClock(commitment.dailySeconds)} a day on ${commitment.mission}` : `${formatClock(commitment.dailySeconds)} a day in the Oasis`),
    from: commitment.from,
    to: commitment.to,
    dailySeconds: commitment.dailySeconds,
    multiplier,
    penaltyFactor,
    mission: commitment.mission || null,
    penaltyPerMinute: round1(perMinute),
    days,
    bonusXp: round1(bonusXp),
    penaltyXp: round1(penaltyXp),
    today: stake,
  }
}

// ─── what the HUD and Anorak read ───────────────────────────────────────────

export type WorkDayStatus = 'hit' | 'missed' | 'open' | 'ahead'

export interface WorkDayView {
  date: string
  seconds: number
  xp: number
  /** hit: the day's hours are done. missed: a past day that fell short. open: today, still running. ahead: not here yet. */
  status: WorkDayStatus
}

export interface WorkSnapshot {
  now: number
  date: string
  targetSeconds: number
  today: { seconds: number; freeSeconds: number; missionSeconds: number; xp: number; done: boolean; remainingSeconds: number; missions: Array<WorkMissionTime & { file: string }> }
  /** Every day of the vow. */
  week: WorkDayView[]
  vow: WorkVow
  /** The vow first, then any others: multiplier, penalty, each day's bonus or cost, what is at stake today. */
  commitments: CommitmentView[]
  /** Over the vow's days: XP from time, plus bonuses, minus penalties. */
  totals: { xp: number; bonusXp: number; penaltyXp: number; netXp: number }
  /** The mission being worked on; null: just being in the Oasis. */
  active: WorkActive | null
  /** A page reported within the last minute. */
  counting: boolean
  rule: string
}

export function workSnapshot(file: WorkFile, now: number, offsetMinutes = localOffsetMinutes(now)): WorkSnapshot {
  const date = localDay(now, offsetMinutes)
  const target = file.vow.dailySeconds
  const day = file.days[date]
  const seconds = daySeconds(day)
  const week: WorkDayView[] = []
  for (let d = file.vow.from, guard = 0; d <= file.vow.to && guard < 60; d = addDays(d, 1), guard += 1) {
    const worked = daySeconds(file.days[d])
    const status: WorkDayStatus = worked >= target ? 'hit' : d < date ? 'missed' : d === date ? 'open' : 'ahead'
    week.push({ date: d, seconds: worked, xp: dayXp(file.days[d]), status })
  }
  const commitments = [file.vow, ...(file.commitments || [])].map(c => evaluateCommitment(file, c, date))
  const baseXp = round1(week.reduce((sum, d) => sum + d.xp, 0))
  const bonusXp = round1(commitments.reduce((sum, c) => sum + c.bonusXp, 0))
  const penaltyXp = round1(commitments.reduce((sum, c) => sum + c.penaltyXp, 0))
  return {
    now,
    date,
    targetSeconds: target,
    today: {
      seconds,
      freeSeconds: day?.freeSeconds || 0,
      missionSeconds: seconds - (day?.freeSeconds || 0),
      xp: dayXp(day),
      done: seconds >= target,
      remainingSeconds: Math.max(0, target - seconds),
      missions: Object.entries(day?.missions || {}).map(([key, mission]) => ({ file: key, ...mission, xp: Math.round(mission.xp * 10) / 10 })).sort((a, b) => b.seconds - a.seconds),
    },
    week,
    vow: file.vow,
    commitments,
    totals: { xp: baseXp, bonusXp, penaltyXp, netXp: round1(baseXp + bonusXp - penaltyXp) },
    active: file.active,
    counting: Boolean(file.holder && now - file.holder.at < 60_000),
    rule: WORK_RULE,
  }
}

/** `1:23:45`. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const two = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
}
