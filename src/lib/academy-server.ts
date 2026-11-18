// ░▒▓ ACADEMY, SERVER SIDE — reads the skill content, keeps the trainees' progress ▓▒░
// Content: skills.json + keys.json (and further sets, skills-<id>.json + keys-<id>.json) in OASIS_ACADEMY_DIR (default C:\7c_oasis\academy, a private folder);
// when it is missing, the three-skill sample in this repo.
// Progress: data/academy.local.json (gitignored like every data/*.local.json), one writer at a time.

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { academyDirSetting } from './oasis-settings'
import { ACADEMY_SAMPLE_KEYS, ACADEMY_SAMPLE_SKILLS } from './village/academy-sample'
import {
  applyAcademyUpdate,
  normalizeAcademyContent,
  parseAcademyFile,
  traineeView,
  type AcademyContent,
  type AcademyFile,
  type AcademyResponse,
  type AcademyUpdate,
  type AcademyUpdateResult,
} from './village/village-academy'

export function academyDir(): string {
  return academyDirSetting()
}

export function academyStatePath(): string {
  return process.env.OASIS_ACADEMY_STATE || path.join(process.cwd(), 'data', 'academy.local.json')
}

const SAMPLE = normalizeAcademyContent(ACADEMY_SAMPLE_SKILLS, ACADEMY_SAMPLE_KEYS, 'sample') as AcademyContent

/** The set every caller gets unless it asks for another: `skills.json` + `keys.json`. */
export const ACADEMY_MAIN_SET = 'main'

interface LoadedSet {
  id: string
  /** Changes when one of its two files does. */
  rev: string
  content: AcademyContent
}

const cached = new Map<string, LoadedSet>()

/**
 * The folder's sets: `skills.json` + `keys.json` is the main one, `skills-<id>.json` + `keys-<id>.json`
 * another (the full tree next to the film's 13). Each is re-read only when one of its files changed.
 * No folder, or nothing usable in it: the sample.
 */
export async function loadAcademySets(): Promise<LoadedSet[]> {
  const dir = academyDir()
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return [{ id: ACADEMY_MAIN_SET, rev: 'sample', content: SAMPLE }]
  }
  const found = names
    .map(name => /^skills(?:-([a-z0-9][a-z0-9_]{0,30}))?\.json$/i.exec(name))
    .filter((match): match is RegExpExecArray => Boolean(match))
    // `skills-main.json` would claim the main set's id.
    .filter(match => (match[1] || '').toLowerCase() !== ACADEMY_MAIN_SET)
    .map(match => ({ id: (match[1] || ACADEMY_MAIN_SET).toLowerCase(), suffix: match[1] ? `-${match[1]}` : '' }))
    .sort((a, b) => (a.suffix ? 1 : 0) - (b.suffix ? 1 : 0) || (a.id < b.id ? -1 : 1))
  const sets: LoadedSet[] = []
  const strip = (text: string) => text.replace(/^\uFEFF/, '')
  for (const { id, suffix } of found) {
    const skillsPath = path.join(dir, `skills${suffix}.json`)
    const keysPath = path.join(dir, `keys${suffix}.json`)
    try {
      const skillsStat = await fs.stat(skillsPath)
      const keysStat = await fs.stat(keysPath).catch(() => null)
      const rev = `${Math.round(skillsStat.mtimeMs).toString(36)}.${skillsStat.size.toString(36)}.${Math.round(keysStat?.mtimeMs ?? 0).toString(36)}`
      const key = `${dir}|${id}`
      const have = cached.get(key)
      if (have?.rev === rev) {
        sets.push(have)
        continue
      }
      const skills = JSON.parse(strip(await fs.readFile(skillsPath, 'utf8')))
      const keys = keysStat ? JSON.parse(strip(await fs.readFile(keysPath, 'utf8'))) : {}
      const content = normalizeAcademyContent(skills, keys, 'folder')
      if (!content) continue
      const loaded = { id, rev, content }
      cached.set(key, loaded)
      sets.push(loaded)
    } catch {
      // A file caught mid-save, or broken: keep serving the last good reading of this set, and
      // never let one broken set take the others down.
      const last = cached.get(`${dir}|${id}`)
      if (last) sets.push(last)
    }
  }
  return sets.length ? sets : [{ id: ACADEMY_MAIN_SET, rev: 'sample', content: SAMPLE }]
}

/** Every skill of every set, the main set's wording first: what a mark may name. */
function allSkills(sets: LoadedSet[]): AcademyContent['skills'] {
  const seen = new Set<string>()
  return sets.flatMap(set => set.content.skills.filter(skill => !seen.has(skill.id) && Boolean(seen.add(skill.id))))
}

/**
 * No file yet is an empty Academy. A file that cannot be read or is not JSON is an error: answering
 * "nobody" would let the next write replace everyone's progress with one record.
 */
async function readState(): Promise<AcademyFile> {
  let text: string
  try {
    text = await fs.readFile(academyStatePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { v: 1, trainees: {} }
    throw error
  }
  text = text.replace(/^\uFEFF/, '')
  try {
    JSON.parse(text)
  } catch {
    throw new Error('data/academy.local.json is not valid JSON: fix it or move it away (nothing was written)')
  }
  return parseAcademyFile(text)
}

async function writeState(file: AcademyFile): Promise<void> {
  const target = academyStatePath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  // Windows refuses a rename over a file another request is reading: try again a few times.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temp, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await fs.unlink(temp).catch(() => {})
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
}

/**
 * One set with every trainee's progress in it. `have`: the content revision the caller already holds;
 * when it still is the current one, the content is left out and only the trainees travel.
 */
export async function academySnapshot(setId?: string | null, have?: string | null): Promise<AcademyResponse> {
  const [sets, file] = await Promise.all([loadAcademySets(), readState()])
  const set = sets.find(item => item.id === (setId || ACADEMY_MAIN_SET).toLowerCase()) || sets[0]
  const trainees = Object.entries(file.trainees)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .map(([key, record]) => traineeView(set.content, key, record))
  return {
    set: set.id,
    rev: set.rev,
    sets: sets.map(item => ({ id: item.id, title: item.content.title, count: item.content.skills.length })),
    trainees,
    ...(have && have === set.rev ? {} : set.content),
  }
}

// Read, change, write: one at a time, so two checks arriving together both land.
let queue: Promise<unknown> = Promise.resolve()

export function updateAcademy(update: AcademyUpdate): Promise<AcademyUpdateResult> {
  const run = queue.then(async () => {
    const [sets, file] = await Promise.all([loadAcademySets(), readState()])
    const result = applyAcademyUpdate(file, allSkills(sets), update, Date.now())
    if (result.ok) await writeState(result.file)
    return result
  })
  queue = run.catch(() => {})
  return run
}
