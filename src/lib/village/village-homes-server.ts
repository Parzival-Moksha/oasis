// ░▒▓ VILLAGE HOMES (server) — the homes file on disk, changed one write at a time ▓▒░
// data/village-homes.local.json (git-ignored like the other *.local.json). See lib/village/village-homes.ts.

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { EMPTY_HOMES, cleanHome, isHomeKey, parseHomesFile, withAnswer, withCall, withHome, withRequest, withVillageWorld, type HomeRequest, type HomesFile } from '@/lib/village/village-homes'

export function homesFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.OASIS_VILLAGE_HOMES_FILE || path.join(process.cwd(), 'data', 'village-homes.local.json')
}

export async function readHomes(file = homesFilePath()): Promise<HomesFile> {
  try {
    return parseHomesFile(JSON.parse(await fs.readFile(file, 'utf8')))
  } catch {
    return { ...EMPTY_HOMES, homes: {}, requests: [], done: [], calls: {} }
  }
}

// One change at a time: two writers (the owner's page and an agent's script) never lose each other's change.
let chain: Promise<unknown> = Promise.resolve()

async function change(fn: (file: HomesFile) => HomesFile, file = homesFilePath()): Promise<HomesFile> {
  const job = chain.then(async () => {
    const next = fn(await readHomes(file))
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(next, null, 1)}\n`, 'utf8')
    await fs.rename(temp, file)
    return next
  })
  chain = job.catch(() => {})
  return job
}

export class HomesError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

/** What a client may ask (POST /api/village/homes). */
export async function applyHomesAction(body: Record<string, unknown>, file = homesFilePath()): Promise<{ file: HomesFile; request?: HomeRequest }> {
  const action = String(body.action || '')
  if (action === 'set' || action === 'clear') {
    const world = body.world
    const agent = body.agent
    if (!isHomeKey(world) || !isHomeKey(agent)) throw new HomesError('world and agent are needed')
    const home = action === 'set' ? cleanHome({ ...(body.home as object), by: (body.home as { by?: unknown })?.by, at: Date.now() }) : null
    if (action === 'set' && !home) throw new HomesError('home needs x and z (numbers)')
    return { file: await change(f => withHome(f, world, agent, home), file) }
  }
  if (action === 'request') {
    const agent = body.agent
    const kind = body.kind
    if (!isHomeKey(agent)) throw new HomesError('agent is needed (its session id, or its agent id)')
    if (kind !== 'here' && kind !== 'at' && kind !== 'clear') throw new HomesError('kind is here, at or clear')
    const x = Number(body.x)
    const z = Number(body.z)
    if (kind === 'at' && !(Number.isFinite(x) && Number.isFinite(z))) throw new HomesError('at needs x and z')
    const request: HomeRequest = {
      id: `h${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
      agentKey: agent,
      agentId: isHomeKey(body.agentId) ? body.agentId : null,
      kind,
      ...(kind === 'at' ? { x, z } : {}),
      at: Date.now(),
    }
    return { file: await change(f => withRequest(f, request), file), request }
  }
  if (action === 'answer') {
    const id = body.id
    if (!isHomeKey(id)) throw new HomesError('id is needed')
    const world = isHomeKey(body.world) ? body.world : undefined
    const key = body.agent
    const home = body.home === null ? null : cleanHome({ ...(body.home as object), by: 'agent', at: Date.now() })
    return {
      file: await change(f => {
        // Answered by another page already: nothing to do.
        if (!f.requests.some(r => r.id === id)) return f
        let next = f
        if (body.ok !== false && world && isHomeKey(key)) next = withHome(next, world, key, home)
        return withAnswer(next, id, { ok: body.ok !== false, note: String(body.note || '').slice(0, 300), world })
      }, file),
    }
  }
  if (action === 'village') {
    const world = body.world === null ? null : body.world
    if (world !== null && !isHomeKey(world)) throw new HomesError('world is a world id, or null')
    return { file: await change(f => withVillageWorld(f, world), file) }
  }
  if (action === 'call') {
    const agent = body.agent
    const world = body.world === null ? null : body.world
    if (!isHomeKey(agent)) throw new HomesError('agent is needed')
    if (world !== null && !isHomeKey(world)) throw new HomesError('world is a world id, or null (sent home)')
    return { file: await change(f => withCall(f, agent, world), file) }
  }
  throw new HomesError(`unknown action "${action}"`)
}
