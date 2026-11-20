// ░▒▓ WORK VOW, SERVER SIDE — the book of time worked: data/work-vow.local.json ▓▒░
// One record per local day (seconds free, seconds per mission, XP). Gitignored like every
// data/*.local.json. One writer at a time; written to a temp file first, so a crash mid-write
// leaves the old book, not half of a new one.

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { missionsDir } from './oasis-settings'
import { appendMissionLog } from './village/village-mission-edit'
import { missionForAgent } from './village/mission-dispatch'
import { isMissionFile, parseMission, type Mission } from './village/village-missions'
import {
  addManualTime,
  removeManualTime,
  applyAgentWork,
  applyWorkBeat,
  daySummary,
  localDay,
  mindcraftBook,
  agentHoursHistory,
  type AgentHoursDay,
  missionTimers,
  emptyWorkFile,
  formatClock,
  parseWorkFile,
  releaseWorkHolder,
  setWorkMission,
  workSnapshot,
  type AgentWorkReport,
  type WorkBeat,
  type MindcraftBook,
  type WorkDaySummary,
  type WorkFile,
  type WorkSnapshot,
} from './village/work-vow'

export function workVowPath(): string {
  return process.env.OASIS_WORK_VOW_STATE || path.join(process.cwd(), 'data', 'work-vow.local.json')
}

/** No file yet is an empty book. A file that cannot be read is an error: never overwrite days with nothing. */
async function readBook(): Promise<WorkFile> {
  let text: string
  try {
    text = await fs.readFile(workVowPath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyWorkFile()
    throw error
  }
  return parseWorkFile(JSON.parse(text.replace(/^\uFEFF/, '')))
}

async function writeBook(file: WorkFile): Promise<void> {
  const target = workVowPath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(file, null, 1)}\n`, 'utf8')
  await fs.rename(temp, target)
}

// One change at a time (the dev server is one process; hot reloads keep the chain on globalThis).
const chainHolder = globalThis as unknown as { __oasisWorkVowChain?: Promise<unknown> }

function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = (chainHolder.__oasisWorkVowChain || Promise.resolve()).then(job, job)
  chainHolder.__oasisWorkVowChain = next.catch(() => {})
  return next
}

export function workVowSnapshot(now = Date.now()): Promise<WorkSnapshot> {
  return serial(async () => workSnapshot(await readBook(), now))
}

/** A mission's title and priority, for time on a card that is merely open. Null: no such mission. */
async function missionMeta(file: string): Promise<{ file: string; title: string; priority: number } | null> {
  if (!isMissionFile(file) || file !== path.basename(file)) return null
  try {
    const parsed = parseMission(file, await fs.readFile(path.join(missionsDir(), file), 'utf8'))
    return { file, title: parsed.title, priority: parsed.priority || 0 }
  } catch {
    return null
  }
}

/** Every day in the book as lists: the owner's Mindcraft, each agent's, the whole Oasis'. */
export function workMindcraft(): Promise<MindcraftBook> {
  return serial(async () => mindcraftBook(await readBook()))
}

/** The owner's settings: valor with nothing in focus (0 to 1). */
export function setWorkSettings(settings: { freeValor?: number }, now = Date.now()): Promise<WorkSnapshot> {
  return serial(async () => {
    const book = await readBook()
    if (typeof settings.freeValor === 'number' && settings.freeValor >= 0 && settings.freeValor <= 1) {
      book.settings = { ...book.settings, freeValor: Math.round(settings.freeValor * 100) / 100 }
      await writeBook(book)
    }
    return workSnapshot(book, now)
  })
}

/**
 * The owner's one XP: his old Profile XP, taken once as a starting balance (the first call records
 * `currentOldXp`), plus every Mindcraft XP he earned (the same total Mindcraft shows, the commitment
 * included). The old Profile row in the database is left as it was.
 */
export function foldedOwnerXp(currentOldXp: number, now = Date.now()): Promise<{ total: number; oldXp: number; mindcraftXp: number; foldedAt: number }> {
  return serial(async () => {
    const book = await readBook()
    if (!book.profileFold) {
      book.profileFold = { oldXp: Math.max(0, Math.floor(currentOldXp || 0)), at: now }
      await writeBook(book)
    }
    const mindcraftXp = mindcraftBook(book, localDay(now)).totals.owner.xp
    const fold = book.profileFold
    return { total: Math.max(0, Math.round(fold.oldXp + mindcraftXp)), oldXp: fold.oldXp, mindcraftXp, foldedAt: fold.at }
  })
}

/** The Oasis's own working hours, one line per day, oldest first (the curve). */
export function workAgentHours(): Promise<AgentHoursDay[]> {
  return serial(async () => agentHoursHistory(await readBook()))
}

/** Per mission: the owner's time and the agents' time, over every day. */
export function workMissionTimers(): Promise<Record<string, { ownerSeconds: number; agentSeconds: number }>> {
  return serial(async () => missionTimers(await readBook()))
}

/**
 * An agent says which mission it is working on (null: back to the default, the mission whose `who`
 * names it). Its working minutes are booked there from now on.
 */
export function declareAgentMission(agent: string, file: string | null): Promise<{ ok: true; agent: string; mission: string | null; title?: string; priority?: number } | { ok: false; status: number; error: string }> {
  return serial(async () => {
    const name = agent.trim().toLowerCase()
    if (!name) return { ok: false as const, status: 400, error: 'agent is the agent\'s name' }
    const book = await readBook()
    let meta: { file: string; title: string; priority: number } | null = null
    if (file !== null) {
      meta = await missionMeta(file)
      if (!meta) return { ok: false as const, status: 404, error: 'mission not found' }
    }
    const next = { ...(book.agentMissions || {}) }
    if (meta) next[name] = meta.file
    else delete next[name]
    book.agentMissions = next
    await writeBook(book)
    return { ok: true as const, agent: name, mission: meta?.file || null, ...(meta ? { title: meta.title, priority: meta.priority } : {}) }
  })
}

/** Add time to a day by hand (with a reason), or take an entry back. */
export function editManualTime(edit: { date: string; seconds?: number; reason?: string; valor?: number; remove?: number }, now = Date.now()): Promise<{ ok: boolean; summary: WorkDaySummary }> {
  return serial(async () => {
    const before = await readBook()
    const next = typeof edit.remove === 'number'
      ? removeManualTime(before, edit.date, edit.remove)
      : addManualTime(before, { date: edit.date, seconds: edit.seconds || 0, reason: edit.reason || '', valor: edit.valor }, now)
    if (next !== before) await writeBook(next)
    return { ok: next !== before, summary: daySummary(next, edit.date, localDay(now)) }
  })
}

/** One day, ready to tell (the 21:00 message reads this). */
export function workDaySummary(date: string, now = Date.now()): Promise<WorkDaySummary> {
  return serial(async () => daySummary(await readBook(), date, localDay(now)))
}

let missionCache: { at: number; missions: Mission[] } | null = null

/** Every mission, re-read at most every 30 s (agent XP looks up whose mission a turn counts on). */
async function allMissions(now: number): Promise<Mission[]> {
  if (missionCache && now - missionCache.at < 30_000) return missionCache.missions
  let missions: Mission[] = []
  try {
    const dir = missionsDir()
    const names = (await fs.readdir(dir)).filter(isMissionFile)
    missions = (await Promise.all(names.map(async name => {
      try { return parseMission(name, await fs.readFile(path.join(dir, name), 'utf8')) } catch { return null }
    }))).filter((mission): mission is Mission => mission !== null)
  } catch { /* no folder: no missions, no agent XP */ }
  missionCache = { at: now, missions }
  return missions
}

/** Finished turns and helpers, from the page that heard the engine say so. */
export function reportAgentWork(reports: AgentWorkReport[], fromEngine = false): Promise<{ booked: number }> {
  return serial(async () => {
    const before = await readBook()
    let book = before
    // The engine reports (an empty heartbeat too): pages stop relaying while it does.
    if (fromEngine) book = { ...book, engineReportAt: Date.now() }
    let booked = 0
    const missions = reports.length ? await allMissions(Date.now()) : []
    for (const report of reports.slice(0, 200)) {
      // The agent's minutes count on the mission whose `who` names it: XP = minutes × that priority.
      // The mission the agent said it is on wins; else the open mission whose `who` names it.
      const said = book.agentMissions?.[report.name.trim().toLowerCase()]
      const mission = (said ? missions.find(item => item.file === said && item.column !== 'done') : null) || missionForAgent(missions, report.name)
      const next = applyAgentWork(book, { ...report, mission: mission ? { file: mission.file, title: mission.title, priority: mission.priority || 0 } : null })
      if (next !== book) booked += 1
      book = next
    }
    if (book !== before) await writeBook(book)
    return { booked }
  })
}

export function reportWorkBeat(input: Omit<WorkBeat, 'focus'> & { release?: boolean; focus?: { agent?: { key: string; name: string } | null; mission?: string | null; mindcraft?: boolean } }, now = Date.now()): Promise<{ counting: boolean; credited: number; otherTab: boolean; other?: { client?: string; since: number }; snapshot: WorkSnapshot }> {
  return serial(async () => {
    const mission = input.focus?.mission ? await missionMeta(input.focus.mission) : null
    const beat: WorkBeat & { release?: boolean } = { ...input, focus: { agent: input.focus?.agent || null, mission, mindcraft: input.focus?.mindcraft === true } }
    const before = await readBook()
    const result = applyWorkBeat(before, beat, now)
    // A closing page reports its last seconds and lets go.
    if (beat.release) result.file = releaseWorkHolder(result.file, beat.tab)
    if (result.file !== before) await writeBook(result.file)
    return { counting: result.counting, credited: result.credited, otherTab: result.otherTab === true, ...(result.other ? { other: result.other } : {}), snapshot: workSnapshot(result.file, now) }
  })
}

/** Start working on a mission (its title and priority are read from its file), or stop with null. */
export function switchWorkMission(file: string | null, now = Date.now()): Promise<{ ok: true; snapshot: WorkSnapshot } | { ok: false; status: number; error: string }> {
  return serial(async () => {
    const book = await readBook()
    let mission: { file: string; title: string; priority: number } | null = null
    if (file !== null) {
      if (!isMissionFile(file) || file !== path.basename(file)) return { ok: false as const, status: 400, error: 'not a mission file' }
      try {
        const parsed = parseMission(file, await fs.readFile(path.join(missionsDir(), file), 'utf8'))
        mission = { file, title: parsed.title, priority: parsed.priority || 0 }
      } catch {
        return { ok: false as const, status: 404, error: 'mission not found' }
      }
    }
    const before = book.active
    const next = setWorkMission(book, mission, now)
    await writeBook(next)
    // Stopping leaves a line in the mission's own log: how long today, and the XP it earned.
    if (before && before.file !== mission?.file) {
      const snapshot = workSnapshot(next, now)
      const today = snapshot.today.missions.find(item => item.file === before.file)
      if (today && today.seconds >= 60) {
        try {
          const target = path.join(missionsDir(), before.file)
          const text = (await fs.readFile(target, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
          const two = (n: number) => String(n).padStart(2, '0')
          const at = new Date(now)
          const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`
          const xp = today.xp
          await fs.writeFile(target, appendMissionLog(text, { at: stamp, who: 'owner', text: `Worked on this in the Oasis: ${formatClock(today.seconds)} so far today, ${xp} XP.` }), 'utf8')
        } catch { /* the mission file is gone: the time is still in the book */ }
      }
    }
    return { ok: true as const, snapshot: workSnapshot(next, now) }
  })
}
