// ░▒▓ WORK VOW, SERVER SIDE — the book of time worked: data/work-vow.local.json ▓▒░
// One record per local day (seconds free, seconds per mission, XP). Gitignored like every
// data/*.local.json. One writer at a time; written to a temp file first, so a crash mid-write
// leaves the old book, not half of a new one.

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { appendMissionLog } from './village/village-mission-edit'
import { isMissionFile, parseMission } from './village/village-missions'
import {
  applyAgentWork,
  applyWorkBeat,
  daySummary,
  localDay,
  emptyWorkFile,
  formatClock,
  parseWorkFile,
  releaseWorkHolder,
  setWorkMission,
  workSnapshot,
  xpFor,
  WORK_VALOR,
  type AgentWorkReport,
  type WorkBeat,
  type WorkDaySummary,
  type WorkFile,
  type WorkSnapshot,
} from './village/work-vow'

export function workVowPath(): string {
  return process.env.OASIS_WORK_VOW_STATE || path.join(process.cwd(), 'data', 'work-vow.local.json')
}

function missionsDir(): string {
  return process.env.OASIS_MISSIONS_DIR || 'C:\\7c_oasis\\docs\\missions'
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

/** One day, ready to tell (the 21:00 message reads this). */
export function workDaySummary(date: string, now = Date.now()): Promise<WorkDaySummary> {
  return serial(async () => daySummary(await readBook(), date, localDay(now)))
}

/** Finished turns and helpers, from the page that heard the engine say so. */
export function reportAgentWork(reports: AgentWorkReport[]): Promise<{ booked: number }> {
  return serial(async () => {
    const before = await readBook()
    let book = before
    let booked = 0
    for (const report of reports.slice(0, 200)) {
      const next = applyAgentWork(book, report)
      if (next !== book) booked += 1
      book = next
    }
    if (book !== before) await writeBook(book)
    return { booked }
  })
}

export function reportWorkBeat(input: Omit<WorkBeat, 'focus'> & { release?: boolean; focus?: { agent?: { key: string; name: string } | null; mission?: string | null } }, now = Date.now()): Promise<{ counting: boolean; credited: number; snapshot: WorkSnapshot }> {
  return serial(async () => {
    const mission = input.focus?.mission ? await missionMeta(input.focus.mission) : null
    const beat: WorkBeat & { release?: boolean } = { ...input, focus: { agent: input.focus?.agent || null, mission } }
    const before = await readBook()
    const result = applyWorkBeat(before, beat, now)
    // A closing page reports its last seconds and lets go.
    if (beat.release) result.file = releaseWorkHolder(result.file, beat.tab)
    if (result.file !== before) await writeBook(result.file)
    return { counting: result.counting, credited: result.credited, snapshot: workSnapshot(result.file, now) }
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
          const xp = Math.round(xpFor(today.seconds, WORK_VALOR.mission, today.priority) * 10) / 10
          await fs.writeFile(target, appendMissionLog(text, { at: stamp, who: 'owner', text: `Worked on this in the Oasis: ${formatClock(today.seconds)} so far today, ${xp} XP.` }), 'utf8')
        } catch { /* the mission file is gone: the time is still in the book */ }
      }
    }
    return { ok: true as const, snapshot: workSnapshot(next, now) }
  })
}
