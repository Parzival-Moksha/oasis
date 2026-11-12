// ░▒▓ ACADEMY, SERVER SIDE — reads the skill content, keeps the trainees' progress ▓▒░
// Content: skills.json + keys.json in OASIS_ACADEMY_DIR (default C:\7c_oasis\academy, a private folder);
// when it is missing, the three-skill sample in this repo.
// Progress: data/academy.local.json (gitignored like every data/*.local.json), one writer at a time.

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { ACADEMY_SAMPLE_KEYS, ACADEMY_SAMPLE_SKILLS } from './village/academy-sample'
import {
  applyAcademyUpdate,
  normalizeAcademyContent,
  parseAcademyFile,
  traineeView,
  type AcademyContent,
  type AcademyFile,
  type AcademySnapshot,
  type AcademyUpdate,
  type AcademyUpdateResult,
} from './village/village-academy'

const DEFAULT_DIR = 'C:\\7c_oasis\\academy'

export function academyDir(): string {
  return process.env.OASIS_ACADEMY_DIR || DEFAULT_DIR
}

export function academyStatePath(): string {
  return process.env.OASIS_ACADEMY_STATE || path.join(process.cwd(), 'data', 'academy.local.json')
}

const SAMPLE = normalizeAcademyContent(ACADEMY_SAMPLE_SKILLS, ACADEMY_SAMPLE_KEYS, 'sample') as AcademyContent

let cached: { stamp: string; content: AcademyContent } | null = null

/** The folder's content, re-read only when one of its two files changed. */
export async function loadAcademyContent(): Promise<AcademyContent> {
  const dir = academyDir()
  const skillsPath = path.join(dir, 'skills.json')
  const keysPath = path.join(dir, 'keys.json')
  try {
    const skillsStat = await fs.stat(skillsPath)
    const keysStat = await fs.stat(keysPath).catch(() => null)
    const stamp = `${dir}|${skillsStat.mtimeMs}|${keysStat?.mtimeMs ?? 0}`
    if (cached?.stamp === stamp) return cached.content
    const strip = (text: string) => text.replace(/^\uFEFF/, '')
    const skills = JSON.parse(strip(await fs.readFile(skillsPath, 'utf8')))
    const keys = keysStat ? JSON.parse(strip(await fs.readFile(keysPath, 'utf8'))) : {}
    const content = normalizeAcademyContent(skills, keys, 'folder')
    if (!content) return SAMPLE
    cached = { stamp, content }
    return content
  } catch {
    return SAMPLE
  }
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

export async function academySnapshot(): Promise<AcademySnapshot> {
  const [content, file] = await Promise.all([loadAcademyContent(), readState()])
  const trainees = Object.entries(file.trainees)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .map(([key, record]) => traineeView(content, key, record))
  return { ...content, trainees }
}

// Read, change, write: one at a time, so two checks arriving together both land.
let queue: Promise<unknown> = Promise.resolve()

export function updateAcademy(update: AcademyUpdate): Promise<AcademyUpdateResult> {
  const run = queue.then(async () => {
    const [content, file] = await Promise.all([loadAcademyContent(), readState()])
    const result = applyAcademyUpdate(file, content.skills, update, Date.now())
    if (result.ok) await writeState(result.file)
    return result
  })
  queue = run.catch(() => {})
  return run
}
