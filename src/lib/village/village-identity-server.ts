// ░▒▓ VILLAGE IDENTITY (server) — the one file on this PC, changed one write at a time ▓▒░
// data/village-identity.local.json (git-ignored like the other *.local.json; OASIS_VILLAGE_IDENTITY_FILE overrides
// it, for tests). See lib/village/village-identity.ts.

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { EMPTY_IDENTITY, applyIdentityPatch, parseIdentityFile, type IdentityFile, type IdentityPatch } from '@/lib/village/village-identity'

export function identityFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.OASIS_VILLAGE_IDENTITY_FILE || path.join(process.cwd(), 'data', 'village-identity.local.json')
}

export async function readIdentity(file = identityFilePath()): Promise<IdentityFile> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return { ...EMPTY_IDENTITY, agents: {}, settings: {} }
  }
  // A file that is there but unreadable is not "empty": an empty store would let a page fill it with its own
  // inventions. Keep a copy aside and refuse until someone looks.
  try {
    return parseIdentityFile(JSON.parse(text))
  } catch {
    const aside = `${file}.broken-${Date.now()}`
    await fs.copyFile(file, aside).catch(() => {})
    throw new Error(`the identity file is not valid JSON (copied to ${aside})`)
  }
}

let chain: Promise<unknown> = Promise.resolve()

/** Apply a patch; the file is written only when something changed. */
export async function patchIdentity(patch: IdentityPatch, file = identityFilePath(), now = Date.now()): Promise<IdentityFile> {
  const job = chain.then(async () => {
    const current = await readIdentity(file)
    const next = applyIdentityPatch(current, patch, now)
    if (next === current) return current
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(next, null, 1)}\n`, 'utf8')
    await fs.rename(temp, file)
    return next
  })
  chain = job.catch(() => {})
  return job
}
