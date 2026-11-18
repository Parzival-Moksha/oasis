// ░▒▓ WORK VOW — the Mindcraft counter: time worked in the Oasis, per day, turned into XP ▓▒░
// Pure: no fs, no DOM. The server keeps the file (work-vow-server.ts), the page reports in small
// steps (work-vow-client.ts).
//
// The rule (the owner, 2026-11-16: "one minute equals one XP, with valor equals one"):
//   the owner earns minutes × valor: valor 1 with an agent or a mission card open, 0.7 just being in the Oasis;
//   an agent earns its working minutes × the priority (0 to 1) of the mission it is on.
// The missions' priority is the agents' multiplier, not the owner's: "I don't even do them. You do the missions."

export const WORK_VALOR = { mission: 1, agent: 1, free: 0.7 }
/** No key, mouse, walking or dictation for this long: the counter stops. */
export const WORK_IDLE_MS = 3 * 60 * 1000
/** The page reports this often. */
export const WORK_BEAT_MS = 15_000
/** A tab that hasn't reported for this long has gone: another tab may count. */
export const WORK_HOLDER_STALE_MS = 50_000
export const WORK_RULE = 'You earn 1 XP a minute with an agent or a mission open, 0.7 just being in the Oasis. An agent earns its working minutes × its mission\'s priority. A committed day that is hit counts double; a committed day that is missed costs 7 XP for every missing minute.'

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

/** The owner's time with one agent open (whatever it earned: mission time or agent time). */
export interface WorkAgentTime {
  name: string
  seconds: number
  xp: number
}

/** An agent's own working hours on a day: its turns minus the waiting on helpers, and its helpers' time. */
export interface AgentHours {
  name: string
  ownSeconds: number
  helperSeconds: number
  turns: number
  helpers: number
  /** Working minutes × the priority of the mission it was on. */
  xp: number
  /** The mission its latest minutes counted on, and that mission's priority (its XP rate per minute). */
  mission?: string
  priority?: number
  /** Its seconds per mission this day, by mission file. */
  missions?: Record<string, number>
}

export interface WorkDay {
  freeSeconds: number
  freeXp: number
  /** Time with an agent open and no mission: valor 1, no priority. */
  agentSeconds?: number
  agentXp?: number
  /** By mission file. */
  missions: Record<string, WorkMissionTime>
  /** The owner's time by agent (a second view of the same seconds, not added to the total). */
  agents?: Record<string, WorkAgentTime>
  /** The agents' own working hours, by agent. */
  hours?: Record<string, AgentHours>
  /** Time added by hand (the counter was broken, work away from the Oasis), each with its reason. */
  manual?: WorkManualEntry[]
  /** Which page the counted seconds came from: the tab id, its seconds, first and last report, the browser. */
  tabs?: Record<string, WorkTabRecord>
}

export interface WorkTabRecord {
  seconds: number
  /** First and last report that put seconds in (ms). */
  from: number
  to: number
  /** The browser, from its user agent: "Edge 131", "Chrome 131 headless". */
  client?: string
}

export interface WorkManualEntry {
  seconds: number
  xp: number
  reason: string
  /** When it was entered (ms). */
  at: number
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
  holder: { tab: string; seq: number; at: number; client?: string } | null
  /** The tab that last let go (it was closing): a late report from it must not take the place back. */
  released?: string
  /** The last report number that tab had sent when it let go: anything newer proves the page is still there. */
  releasedSeq?: number
  /** What the owner can change in Mindcraft. */
  settings?: { freeValor?: number }
  /** The mission an agent said it is working on, by agent name (lower case): wins over the missions' `who`. */
  agentMissions?: Record<string, string>
  /** Agent hours: the latest event booked per agent and kind, so a replayed or doubled event is not booked twice. */
  marks?: Record<string, number>
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
    const parsed: WorkDay = { freeSeconds: num(day.freeSeconds), freeXp: num(day.freeXp), missions }
    if (num(day.agentSeconds)) {
      parsed.agentSeconds = num(day.agentSeconds)
      parsed.agentXp = num(day.agentXp)
    }
    for (const [key, a] of Object.entries(day.agents || {})) {
      if (a && typeof a === 'object') (parsed.agents ||= {})[key] = { name: String(a.name || key), seconds: num(a.seconds), xp: num(a.xp) }
    }
    for (const [key, h] of Object.entries(day.hours || {})) {
      if (h && typeof h === 'object') (parsed.hours ||= {})[key] = { name: String(h.name || key), ownSeconds: num(h.ownSeconds), helperSeconds: num(h.helperSeconds), turns: num(h.turns), helpers: num(h.helpers), xp: num(h.xp), ...(typeof h.mission === 'string' && h.mission ? { mission: h.mission } : {}), ...(typeof h.priority === 'number' ? { priority: num(h.priority) } : {}), ...(h.missions && typeof h.missions === 'object' ? { missions: Object.fromEntries(Object.entries(h.missions).filter(([, v]) => num(v)).map(([k, v]) => [k, num(v)])) } : {}) }
    }
    for (const m of Array.isArray(day.manual) ? day.manual : []) {
      if (m && typeof m === 'object' && num(m.seconds)) (parsed.manual ||= []).push({ seconds: num(m.seconds), xp: num(m.xp), reason: String(m.reason || ''), at: num(m.at) })
    }
    for (const [tab, t] of Object.entries(day.tabs || {})) {
      if (t && typeof t === 'object' && num(t.seconds)) (parsed.tabs ||= {})[tab] = { seconds: num(t.seconds), from: num(t.from), to: num(t.to), ...(typeof t.client === 'string' && t.client ? { client: t.client } : {}) }
    }
    file.days[date] = parsed
  }
  if (raw.active && typeof raw.active.file === 'string') {
    file.active = { file: raw.active.file, title: String(raw.active.title || raw.active.file), priority: num(raw.active.priority), startedAt: num(raw.active.startedAt) }
  }
  if (typeof raw.released === 'string') file.released = raw.released
  if (typeof raw.releasedSeq === 'number') file.releasedSeq = raw.releasedSeq
  if (raw.settings && typeof raw.settings.freeValor === 'number' && raw.settings.freeValor >= 0 && raw.settings.freeValor <= 1) file.settings = { freeValor: raw.settings.freeValor }
  if (raw.agentMissions && typeof raw.agentMissions === 'object') {
    for (const [name, mission] of Object.entries(raw.agentMissions)) if (typeof mission === 'string' && mission) (file.agentMissions ||= {})[name] = mission
  }
  if (raw.marks && typeof raw.marks === 'object') {
    for (const [key, ts] of Object.entries(raw.marks)) if (num(ts)) (file.marks ||= {})[key] = ts as number
  }
  if (raw.holder && typeof raw.holder.tab === 'string') file.holder = { tab: raw.holder.tab, seq: num(raw.holder.seq), at: num(raw.holder.at), ...(typeof raw.holder.client === 'string' ? { client: raw.holder.client } : {}) }
  return file
}

// ─── days ───────────────────────────────────────────────────────────────────

/** Minutes to add to UTC for local time (Vienna in November: 60). Default: this machine's. */
export function localOffsetMinutes(ms: number): number {
  return -new Date(ms).getTimezoneOffset()
}

/** A day ends at 04:20 local, not at midnight (the owner: "I usually work past midnight"). */
export const DAY_START_MS = (4 * 60 + 20) * 60_000

/** The day a moment belongs to: `2026-11-16` runs from 04:20 on the 16th to 04:20 on the 17th, local time. */
export function localDay(ms: number, offsetMinutes = localOffsetMinutes(ms)): string {
  return new Date(ms + offsetMinutes * 60_000 - DAY_START_MS).toISOString().slice(0, 10)
}

/** The first moment of the day that `ms` falls in (04:20 local). */
export function localMidnight(ms: number, offsetMinutes = localOffsetMinutes(ms)): number {
  const shifted = ms + offsetMinutes * 60_000 - DAY_START_MS
  return shifted - (((shifted % 86_400_000) + 86_400_000) % 86_400_000) - offsetMinutes * 60_000 + DAY_START_MS
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function manualSeconds(day: WorkDay | undefined): number {
  return (day?.manual || []).reduce((sum, m) => sum + m.seconds, 0)
}

/**
 * Add time to a day by hand, with a reason; it counts like counted time (valor 1 unless given) and
 * stays marked as manual everywhere it shows. At most a day's worth per entry.
 */
export function addManualTime(input: WorkFile, entry: { date: string; seconds: number; reason: string; valor?: number }, now: number): WorkFile {
  const seconds = Math.floor(entry.seconds)
  const reason = entry.reason.replace(/\s+/g, ' ').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !(seconds > 0) || seconds > 86_400 || !reason) return input
  const valor = typeof entry.valor === 'number' && entry.valor >= 0 && entry.valor <= 2 ? entry.valor : 1
  const file: WorkFile = JSON.parse(JSON.stringify(input))
  const day = file.days[entry.date] || (file.days[entry.date] = { freeSeconds: 0, freeXp: 0, missions: {} })
  ;(day.manual ||= []).push({ seconds, xp: xpFor(seconds, valor, 0), reason: reason.slice(0, 200), at: now })
  return file
}

/** Take a manual entry back (by its place in the day's list). */
export function removeManualTime(input: WorkFile, date: string, index: number): WorkFile {
  if (!input.days[date]?.manual?.[index]) return input
  const file: WorkFile = JSON.parse(JSON.stringify(input))
  file.days[date].manual?.splice(index, 1)
  if (!file.days[date].manual?.length) delete file.days[date].manual
  return file
}

export function daySeconds(day: WorkDay | undefined): number {
  if (!day) return 0
  return day.freeSeconds + (day.agentSeconds || 0) + manualSeconds(day) + Object.values(day.missions).reduce((sum, mission) => sum + mission.seconds, 0)
}

function rawDayXp(day: WorkDay | undefined): number {
  if (!day) return 0
  return day.freeXp + (day.agentXp || 0) + (day.manual || []).reduce((sum, m) => sum + m.xp, 0) + Object.values(day.missions).reduce((sum, mission) => sum + mission.xp, 0)
}

export function dayXp(day: WorkDay | undefined): number {
  return Math.round(rawDayXp(day) * 10) / 10
}

/** Valor for time with nothing in focus: 0.7 unless the owner set another (Mindcraft setting). */
export function freeValor(file: Pick<WorkFile, 'settings'>): number {
  const value = file.settings?.freeValor
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : WORK_VALOR.free
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
  /** The browser it runs in (the server sets it from the user agent). */
  client?: string
  /** What the owner had open while these seconds ran: an agent, a mission card, or neither. */
  focus?: WorkFocus
}

export interface WorkFocus {
  agent?: { key: string; name: string } | null
  mission?: { file: string; title: string; priority: number } | null
}

export interface WorkBeatResult {
  file: WorkFile
  /** This tab is the one that counts. */
  counting: boolean
  /** Seconds that went into the book. */
  credited: number
  /** Turned away because a different tab reported within the last 50 s (the only case to call "another tab"). */
  otherTab?: boolean
  /** That other tab: its browser, and when it started counting today. */
  other?: { client?: string; since: number }
}

/**
 * Where seconds go. A mission wins (the one started with "work on this", else the card that is open):
 * valor 1 and its priority. Else an open agent: valor 1. Else free time at 0.7. Time with an agent
 * open is also tallied under that agent, whichever of the three it earned as.
 */
function addSeconds(file: WorkFile, date: string, seconds: number, focus?: WorkFocus): void {
  if (seconds <= 0) return
  const day = file.days[date] || (file.days[date] = { freeSeconds: 0, freeXp: 0, missions: {} })
  const on = file.active || focus?.mission || null
  let xp: number
  if (on) {
    const mission = day.missions[on.file] || (day.missions[on.file] = { title: on.title, priority: on.priority, seconds: 0, xp: 0 })
    // The mission's priority multiplies the agents' minutes, not the owner's.
    xp = xpFor(seconds, WORK_VALOR.mission, 0)
    mission.title = on.title
    mission.priority = on.priority
    mission.seconds += seconds
    mission.xp += xp
  } else if (focus?.agent) {
    xp = xpFor(seconds, WORK_VALOR.agent, 0)
    day.agentSeconds = (day.agentSeconds || 0) + seconds
    day.agentXp = (day.agentXp || 0) + xp
  } else {
    xp = xpFor(seconds, freeValor(file), 0)
    day.freeSeconds += seconds
    day.freeXp += xp
  }
  if (focus?.agent?.key) {
    const agents = day.agents || (day.agents = {})
    const agent = agents[focus.agent.key] || (agents[focus.agent.key] = { name: focus.agent.name, seconds: 0, xp: 0 })
    agent.name = focus.agent.name || agent.name
    agent.seconds += seconds
    agent.xp += xp
  }
}

/**
 * One report from a page. One tab counts at a time: another tab is turned away until the counting
 * one has been silent for WORK_HOLDER_STALE_MS. A tab can never put more seconds in the book than
 * the clock moved since its last report, so a reload, a retry or a second tab cannot double-count.
 * Seconds that straddle the day's end (04:20 local) are split between the two days.
 */
export function applyWorkBeat(input: WorkFile, beat: WorkBeat, now: number, offsetMinutes = localOffsetMinutes(now)): WorkBeatResult {
  const file: WorkFile = JSON.parse(JSON.stringify(input))
  const holder = file.holder
  const mine = holder?.tab === beat.tab
  if (holder && !mine && now - holder.at < WORK_HOLDER_STALE_MS) {
    const seen = input.days[localDay(now, offsetMinutes)]?.tabs?.[holder.tab]
    return { file: input, counting: false, credited: 0, otherTab: true, other: { ...(holder.client ? { client: holder.client } : {}), since: seen?.from || holder.at } }
  }
  // A report that was still on its way when its page let go: too late, the page is gone. A report numbered after
  // the letting-go comes from a page that is still there (it was only hidden, or its HUD remounted): it counts again.
  // Without this, a tab that let go and stayed was turned away for good ("another tab is counting", with no other tab).
  if (!holder && file.released === beat.tab && !beat.back && beat.seq <= (file.releasedSeq ?? 0)) return { file: input, counting: false, credited: 0 }
  if (!holder || !mine) {
    delete file.released
    delete file.releasedSeq
    // Taking over (or the first tab ever): the clock starts now, nothing reported before counts.
    file.holder = { tab: beat.tab, seq: beat.seq, at: now, ...(beat.client ? { client: beat.client } : {}) }
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
    addSeconds(file, localDay(now, offsetMinutes), today, beat.focus)
    addSeconds(file, localDay(midnight - 1, offsetMinutes), credited - today, beat.focus)
    noteTab(file, localDay(now, offsetMinutes), beat, today, now)
    noteTab(file, localDay(midnight - 1, offsetMinutes), beat, credited - today, now)
  }
  file.holder = { tab: beat.tab, seq: beat.seq, at: now, ...(beat.client ? { client: beat.client } : {}) }
  return { file, counting: true, credited }
}

/** The day keeps, per tab, how many of its seconds that tab put in (so "whose time was this?" has an answer). */
function noteTab(file: WorkFile, date: string, beat: WorkBeat, seconds: number, now: number): void {
  if (seconds <= 0 || !file.days[date]) return
  const tabs = (file.days[date].tabs ||= {})
  const tab = tabs[beat.tab] || (tabs[beat.tab] = { seconds: 0, from: now - seconds * 1000, to: now })
  tab.seconds += seconds
  tab.to = now
  if (beat.client) tab.client = beat.client
  const keys = Object.keys(tabs)
  if (keys.length > 40) keys.sort((a, b) => tabs[a].to - tabs[b].to).slice(0, keys.length - 40).forEach(key => { delete tabs[key] })
}

// ─── automation never counts ────────────────────────────────────────────────
// Agents' test browsers load the Oasis too, and press keys and move the mouse. Their time is not the
// owner's work: a page driven by automation never reports, and the server ignores what such a page sends.

const AUTOMATION_UA = /HeadlessChrome|\bPlaywright\b|puppeteer|PhantomJS/i
const AUTOMATION_URL = /[?&#](playtest|oasis-test|automation|webdriver)(=[^&#]*)?(?=[&#]|$)/i

/** In the page: a webdriver (Playwright, Selenium), a headless browser, or a test flag in the URL. */
export function isAutomationClient(page: { webdriver?: boolean; userAgent?: string; href?: string }): boolean {
  return page.webdriver === true || AUTOMATION_UA.test(page.userAgent || '') || AUTOMATION_URL.test(page.href || '')
}

/** On the server: a headless browser's user agent, or a report the page itself marked as automation. */
export function isAutomationRequest(userAgent: string | null | undefined, body: unknown): boolean {
  if (AUTOMATION_UA.test(userAgent || '')) return true
  return Boolean(body && typeof body === 'object' && (body as { automation?: unknown }).automation === true)
}

/** A short name for the browser a report came from: "Edge 131", "Chrome 131 headless", "Firefox 132". */
export function clientLabel(userAgent: string | null | undefined): string {
  const ua = userAgent || ''
  if (!ua) return 'unknown'
  const version = (re: RegExp) => re.exec(ua)?.[1] || ''
  let name = /node|undici/i.test(ua) && !/Mozilla/.test(ua) ? 'node' : 'browser'
  if (/Edg\//.test(ua)) name = `Edge ${version(/Edg\/(\d+)/)}`
  else if (/OPR\//.test(ua)) name = `Opera ${version(/OPR\/(\d+)/)}`
  else if (/Firefox\//.test(ua)) name = `Firefox ${version(/Firefox\/(\d+)/)}`
  else if (/Electron\//.test(ua)) name = `Electron ${version(/Electron\/(\d+)/)}`
  else if (/HeadlessChrome\//.test(ua)) name = `Chrome ${version(/HeadlessChrome\/(\d+)/)} headless`
  else if (/Chrome\//.test(ua)) name = `Chrome ${version(/Chrome\/(\d+)/)}`
  else if (/Safari\//.test(ua)) name = 'Safari'
  if (/Android|iPhone|iPad|Mobile/.test(ua)) name += ' (phone)'
  return name.trim()
}

/** A page that is closing lets go, so the next one (a reload) counts at once. */
export function releaseWorkHolder(input: WorkFile, tab: string): WorkFile {
  if (input.holder?.tab !== tab) return input
  return { ...input, holder: null, released: tab, releasedSeq: input.holder.seq }
}

/** Start working on a mission (stops the one before), or stop: `mission` null. */
export function setWorkMission(input: WorkFile, mission: { file: string; title: string; priority: number } | null, now: number): WorkFile {
  const file: WorkFile = JSON.parse(JSON.stringify(input))
  file.active = mission ? { ...mission, startedAt: now } : null
  return file
}

// ─── agent hours ────────────────────────────────────────────────────────────

/**
 * An agent's own working time in a turn: the turn's length minus the time it only waited on helpers
 * (the union of the helpers' intervals inside the turn; two helpers at once are one wait).
 */
export function ownTurnMs(durationMs: number, endTs: number, helpers: Array<{ start: number; end: number | null }>): number {
  const from = endTs - durationMs
  const spans = helpers
    .map(h => [Math.max(from, h.start), Math.min(endTs, h.end ?? endTs)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let waited = 0
  let cursor = from
  for (const [a, b] of spans) {
    if (b <= cursor) continue
    waited += b - Math.max(a, cursor)
    cursor = b
  }
  return Math.max(0, durationMs - waited)
}

export interface AgentWorkReport {
  /** The agent (its session id), and its name. A helper's time is reported under its parent. */
  key: string
  name: string
  /** When the turn or the helper ended (the engine's clock). */
  ts: number
  kind: 'turn' | 'helper'
  /** turn: the agent's own time (ownTurnMs). helper: how long the helper ran. */
  ms: number
  /** The mission these minutes count on (the server looks it up from the missions' `who`). */
  mission?: { file?: string; title: string; priority: number } | null
}

/** Book one finished turn or helper. The same event again (a second tab, a replay after a reload) is ignored. */
export function applyAgentWork(input: WorkFile, report: AgentWorkReport, offsetMinutes = localOffsetMinutes(report.ts)): WorkFile {
  const mark = `${report.key}|${report.kind}`
  if (!report.key || !(report.ms >= 0) || !(report.ts > (input.marks?.[mark] || 0))) return input
  const file: WorkFile = JSON.parse(JSON.stringify(input))
  ;(file.marks ||= {})[mark] = report.ts
  // A day at most: an event with a broken clock must not book a week.
  const seconds = Math.min(86_400, report.ms / 1000)
  const date = localDay(report.ts, offsetMinutes)
  const day = file.days[date] || (file.days[date] = { freeSeconds: 0, freeXp: 0, missions: {} })
  const hours = (day.hours ||= {})[report.key] || (day.hours[report.key] = { name: report.name, ownSeconds: 0, helperSeconds: 0, turns: 0, helpers: 0, xp: 0 })
  hours.name = report.name || hours.name
  if (report.mission) {
    hours.xp = (hours.xp || 0) + (seconds / 60) * Math.max(0, report.mission.priority)
    hours.mission = report.mission.title
    hours.priority = Math.max(0, report.mission.priority)
    if (report.mission.file) (hours.missions ||= {})[report.mission.file] = (hours.missions?.[report.mission.file] || 0) + seconds
  }
  if (report.kind === 'turn') {
    hours.ownSeconds += seconds
    hours.turns += 1
  } else {
    hours.helperSeconds += seconds
    hours.helpers += 1
  }
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

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * One commitment against the book. A day that reached its seconds is hit: the XP of the counted time
 * is multiplied (the bonus is the extra). A past day that fell short is missed: every missing minute
 * costs penaltyFactor × the free-time rate. Today is open until it is hit or over.
 */
export function evaluateCommitment(file: WorkFile, commitment: WorkVow, today: string): CommitmentView {
  const multiplier = commitment.multiplier ?? COMMIT_MULTIPLIER
  const penaltyFactor = commitment.penaltyFactor ?? COMMIT_PENALTY_FACTOR
  const perMinute = penaltyFactor * freeValor(file)
  const days: CommitmentDay[] = []
  let bonusXp = 0
  let penaltyXp = 0
  let stake: CommitmentView['today'] = null
  for (let d = commitment.from, guard = 0; d <= commitment.to && guard < 400; d = addDays(d, 1), guard += 1) {
    const day = file.days[d]
    const counted = commitment.mission ? day?.missions[commitment.mission] : null
    const seconds = commitment.mission ? counted?.seconds || 0 : daySeconds(day)
    const xp = commitment.mission ? counted?.xp || 0 : rawDayXp(day)
    const status: WorkDayStatus = seconds >= commitment.dailySeconds ? 'hit' : d < today ? 'missed' : d === today ? 'open' : 'ahead'
    const missing = Math.max(0, commitment.dailySeconds - seconds) / 60
    const bonus = status === 'hit' ? xp * (multiplier - 1) : 0
    const penalty = status === 'missed' ? missing * perMinute : 0
    bonusXp += bonus
    penaltyXp += penalty
    if (status === 'open') {
      // Finishing at the rate of the time so far (free rate when nothing is counted yet).
      const rate = seconds > 0 ? xp / seconds : xpFor(1, freeValor(file), 0)
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

// ─── Mindcraft: the list of days ────────────────────────────────────────────

/** One unit of work: one per mission, per agent, and one for "in the Oasis", each day. Never a single turn. */
export interface WorkUnit {
  kind: 'mission' | 'agent' | 'free' | 'manual'
  label: string
  seconds: number
  xp: number
  /** A mission the unit's minutes counted on (agents). */
  mission?: string
  /** That mission's priority: the agent's XP per minute. Absent with no mission (no XP). */
  priority?: number
  /** An agent's own time and its helpers' (seconds), when it had helpers. */
  split?: { own: number; helpers: number }
  /** "With agents": each agent and the owner's seconds with it, most first. */
  parts?: Array<{ label: string; seconds: number }>
  /** A manual entry's place in the day's list (for taking it back). */
  manualIndex?: number
}

export interface MindcraftDay {
  date: string
  seconds: number
  /** The one XP number of the day: what the time earned, plus the commitment's bonus, minus its penalty. */
  xp: number
  /** What is inside `xp` from the commitment (owner days only). */
  bonusXp?: number
  penaltyXp?: number
  units: WorkUnit[]
}

export interface MindcraftBook {
  /** The owner's days, newest first: units are his missions, his time with agents, and in the Oasis. */
  owner: MindcraftDay[]
  /** Each agent's days: one unit a day (own time plus helpers, XP on its mission). */
  agents: Array<{ key: string; name: string; seconds: number; xp: number; days: MindcraftDay[]; mission?: string; priority?: number }>
  /** All agents together, per day: one unit per agent. */
  oasis: MindcraftDay[]
  totals: { owner: { seconds: number; xp: number }; oasis: { seconds: number; xp: number } }
}

/** Everything in the book as day lists: the owner's Mindcraft, each agent's, and the whole Oasis'. */
export function mindcraftBook(file: WorkFile, today = localDay(Date.now())): MindcraftBook {
  const dates = Object.keys(file.days).sort().reverse()
  const vowDays = new Map(evaluateCommitment(file, file.vow, today).days.map(day => [day.date, day]))
  const owner: MindcraftDay[] = []
  const oasis: MindcraftDay[] = []
  const byAgent = new Map<string, MindcraftBook['agents'][number]>()
  const valor = freeValor(file)
  for (const date of dates) {
    const day = file.days[date]
    const units: WorkUnit[] = [
      ...Object.values(day.missions).map(m => ({ kind: 'mission' as const, label: m.title, seconds: m.seconds, xp: round1(m.xp) })),
      // Time with agents and no mission, one unit per agent would double the seconds: the agents' split is in the summary.
      ...(day.agentSeconds ? [{ kind: 'agent' as const, label: 'With agents', seconds: day.agentSeconds, xp: round1(day.agentXp || 0), parts: Object.values(day.agents || {}).sort((a, b) => b.seconds - a.seconds).map(agent => ({ label: agent.name, seconds: agent.seconds })) }] : []),
      ...(day.freeSeconds ? [{ kind: 'free' as const, label: `In the Oasis ×${valor}`, seconds: day.freeSeconds, xp: round1(day.freeXp) }] : []),
      ...(day.manual || []).map((m, manualIndex) => ({ kind: 'manual' as const, label: `Added by hand: ${m.reason}`, seconds: m.seconds, xp: round1(m.xp), manualIndex })),
    ].sort((a, b) => b.seconds - a.seconds)
    const stake = vowDays.get(date)
    const bonusXp = stake?.status === 'hit' ? stake.bonusXp : 0
    const penaltyXp = stake?.status === 'missed' ? stake.penaltyXp : 0
    if (units.length || penaltyXp) owner.push({ date, seconds: daySeconds(day), xp: round1(dayXp(day) + bonusXp - penaltyXp), ...(bonusXp ? { bonusXp } : {}), ...(penaltyXp ? { penaltyXp } : {}), units })
    const agentUnits: WorkUnit[] = []
    for (const [key, h] of Object.entries(day.hours || {})) {
      const seconds = Math.round(h.ownSeconds + h.helperSeconds)
      if (!seconds) continue
      const unit: WorkUnit = { kind: 'agent', label: h.name, seconds, xp: round1(h.xp || 0), ...(h.mission ? { mission: h.mission } : {}), ...(typeof h.priority === 'number' ? { priority: h.priority } : {}), ...(h.helperSeconds ? { split: { own: Math.round(h.ownSeconds), helpers: Math.round(h.helperSeconds) } } : {}) }
      agentUnits.push(unit)
      const agent = byAgent.get(key) || { key, name: h.name, seconds: 0, xp: 0, days: [] }
      byAgent.set(key, agent)
      if (!agent.days.length) {
        // Dates run newest first: the first day seen is the latest name, mission and rate.
        agent.name = h.name
        if (h.mission) agent.mission = h.mission
        if (typeof h.priority === 'number') agent.priority = h.priority
      }
      agent.seconds += seconds
      agent.xp = round1(agent.xp + (h.xp || 0))
      agent.days.push({ date, seconds, xp: unit.xp, units: [{ ...unit, label: h.mission || 'No mission' }] })
    }
    if (agentUnits.length) {
      agentUnits.sort((a, b) => b.seconds - a.seconds)
      oasis.push({ date, seconds: agentUnits.reduce((sum, u) => sum + u.seconds, 0), xp: round1(agentUnits.reduce((sum, u) => sum + u.xp, 0)), units: agentUnits })
    }
  }
  const sum = (days: MindcraftDay[]) => ({ seconds: days.reduce((t, d) => t + d.seconds, 0), xp: round1(days.reduce((t, d) => t + d.xp, 0)) })
  // A missed day of the vow with nothing counted at all still costs: it gets a row.
  for (const [date, stake] of vowDays) {
    if (stake.status === 'missed' && !owner.some(day => day.date === date)) owner.push({ date, seconds: 0, xp: round1(-stake.penaltyXp), penaltyXp: stake.penaltyXp, units: [] })
  }
  owner.sort((a, b) => (a.date < b.date ? 1 : -1))
  return { owner, agents: [...byAgent.values()].sort((a, b) => b.seconds - a.seconds), oasis, totals: { owner: sum(owner), oasis: sum(oasis) } }
}

/** Per mission, over every day: the owner's time on it and the agents' time on it. */
export function missionTimers(file: WorkFile): Record<string, { ownerSeconds: number; agentSeconds: number }> {
  const out: Record<string, { ownerSeconds: number; agentSeconds: number }> = {}
  const at = (key: string) => out[key] || (out[key] = { ownerSeconds: 0, agentSeconds: 0 })
  for (const day of Object.values(file.days)) {
    for (const [key, mission] of Object.entries(day.missions)) at(key).ownerSeconds += mission.seconds
    for (const hours of Object.values(day.hours || {})) {
      for (const [key, seconds] of Object.entries(hours.missions || {})) at(key).agentSeconds += Math.round(seconds)
    }
  }
  return out
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

export interface WorkDaySummary {
  date: string
  seconds: number
  targetSeconds: number
  remainingSeconds: number
  xp: number
  /** The commitment for this day: kept, not kept, or the day is still running (`open`). */
  kept: boolean
  open: boolean
  /** What the commitment added (kept) or cost (a past day not kept). */
  bonusXp: number
  penaltyXp: number
  netXp: number
  freeSeconds: number
  /** Time with an agent open and no mission. */
  agentSeconds: number
  missionSeconds: number
  missions: Array<WorkMissionTime & { file: string }>
  /** The owner's time by agent, most first; `share` of all time with agents. */
  agents: Array<WorkAgentTime & { key: string; share: number }>
  /** Where the XP came from, most first: each mission, "With agents", "In the Oasis". */
  topXp: Array<{ label: string; xp: number; seconds: number; kind: 'mission' | 'agents' | 'free' | 'manual' }>
  /** Time added by hand this day (already inside `seconds` and `xp`), with each reason. */
  manualSeconds: number
  manual: WorkManualEntry[]
  /** Which pages the counted seconds came from (recorded from 2026-11-17 evening on). */
  tabs: Array<WorkTabRecord & { tab: string }>
  /** The agents' own working hours this day, and the whole Oasis. */
  agentHours: { totalSeconds: number; xp: number; agents: Array<AgentHours & { key: string; totalSeconds: number }> }
}

/** One day, ready to tell: for the detail view and for the 21:00 message. */
export function daySummary(file: WorkFile, date: string, today: string): WorkDaySummary {
  const day = file.days[date]
  const seconds = daySeconds(day)
  const target = file.vow.dailySeconds
  const inVow = date >= file.vow.from && date <= file.vow.to
  const commitment = inVow ? evaluateCommitment(file, file.vow, today).days.find(item => item.date === date) : undefined
  const kept = seconds >= target
  const open = !kept && date >= today
  const bonusXp = commitment?.status === 'hit' ? commitment.bonusXp : 0
  const penaltyXp = commitment?.status === 'missed' ? commitment.penaltyXp : 0
  const missions = Object.entries(day?.missions || {}).map(([key, mission]) => ({ file: key, ...mission, xp: round1(mission.xp) })).sort((a, b) => b.seconds - a.seconds)
  const withAgents = Object.values(day?.agents || {}).reduce((sum, agent) => sum + agent.seconds, 0)
  const agents = Object.entries(day?.agents || {})
    .map(([key, agent]) => ({ key, name: agent.name, seconds: agent.seconds, xp: round1(agent.xp), share: withAgents ? Math.round((agent.seconds / withAgents) * 1000) / 1000 : 0 }))
    .sort((a, b) => b.seconds - a.seconds)
  const topXp: WorkDaySummary['topXp'] = [
    ...missions.map(mission => ({ label: mission.title, xp: mission.xp, seconds: mission.seconds, kind: 'mission' as const })),
    { label: 'With agents', xp: round1(day?.agentXp || 0), seconds: day?.agentSeconds || 0, kind: 'agents' as const },
    { label: 'In the Oasis', xp: round1(day?.freeXp || 0), seconds: day?.freeSeconds || 0, kind: 'free' as const },
    ...(day?.manual || []).map(m => ({ label: `Added by hand: ${m.reason}`, xp: round1(m.xp), seconds: m.seconds, kind: 'manual' as const })),
  ].filter(item => item.seconds > 0).sort((a, b) => b.xp - a.xp)
  const hours = Object.entries(day?.hours || {})
    .map(([key, h]) => ({ key, ...h, xp: round1(h.xp || 0), ownSeconds: Math.round(h.ownSeconds), helperSeconds: Math.round(h.helperSeconds), totalSeconds: Math.round(h.ownSeconds + h.helperSeconds) }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
  const xp = dayXp(day)
  return {
    date,
    seconds,
    targetSeconds: target,
    remainingSeconds: Math.max(0, target - seconds),
    xp,
    kept,
    open,
    bonusXp,
    penaltyXp,
    netXp: round1(xp + bonusXp - penaltyXp),
    freeSeconds: day?.freeSeconds || 0,
    agentSeconds: day?.agentSeconds || 0,
    missionSeconds: missions.reduce((sum, mission) => sum + mission.seconds, 0),
    missions,
    agents,
    topXp,
    manualSeconds: manualSeconds(day),
    tabs: Object.entries(day?.tabs || {}).map(([tab, t]) => ({ tab, ...t })).sort((a, b) => b.seconds - a.seconds),
    manual: (day?.manual || []).map(m => ({ ...m, xp: round1(m.xp) })),
    agentHours: { totalSeconds: hours.reduce((sum, h) => sum + h.totalSeconds, 0), xp: round1(hours.reduce((sum, h) => sum + h.xp, 0)), agents: hours },
  }
}

export interface WorkSnapshot {
  now: number
  date: string
  targetSeconds: number
  today: { seconds: number; freeSeconds: number; agentSeconds: number; missionSeconds: number; xp: number; done: boolean; remainingSeconds: number; missions: Array<WorkMissionTime & { file: string }>; agents: WorkDaySummary['agents']; topXp: WorkDaySummary['topXp'] }
  /** Today, ready to tell (the same shape `?day=` returns for any day). */
  summary: WorkDaySummary
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
  /** Valor with nothing in focus (the owner's setting, 0.7 by default) and when a day ends. */
  settings: { freeValor: number; dayStartsAt: string }
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
  const summary = daySummary(file, date, date)
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
      freeSeconds: summary.freeSeconds,
      agentSeconds: summary.agentSeconds,
      missionSeconds: summary.missionSeconds,
      xp: summary.xp,
      done: seconds >= target,
      remainingSeconds: summary.remainingSeconds,
      missions: summary.missions,
      agents: summary.agents,
      topXp: summary.topXp,
    },
    summary,
    week,
    vow: file.vow,
    commitments,
    totals: { xp: baseXp, bonusXp, penaltyXp, netXp: round1(baseXp + bonusXp - penaltyXp) },
    active: file.active,
    counting: Boolean(file.holder && now - file.holder.at < 60_000),
    settings: { freeValor: freeValor(file), dayStartsAt: '04:20' },
    rule: WORK_RULE,
  }
}

/**
 * What is left of the day's goal, in words: "27 min to go", "2 h 14 min to go", "goal reached".
 * Minutes round up, so it never says "0 min to go" while the day is not done.
 */
export function timeToGo(seconds: number, targetSeconds: number): string {
  const left = Math.max(0, Math.ceil(targetSeconds - seconds))
  if (left <= 0) return 'goal reached'
  const minutes = Math.ceil(left / 60)
  if (minutes < 60) return `${minutes} min to go`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''} to go`
}

/** `1:23:45`. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const two = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
}
