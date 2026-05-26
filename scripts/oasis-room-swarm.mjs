#!/usr/bin/env node

import { Client } from 'colyseus.js'
import { setTimeout as sleep } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'

const DEFAULT_ROOM_URL = 'wss://04515.xyz/rooms'
const DEFAULT_WORLD_PREFIX = 'swarm-world'
const SPELLS = ['firebolt', 'lightning-bolt', 'ice-bolt']
const ANIMS = ['idle', 'walk', 'run']
const COLORS = ['#38bdf8', '#f97316', '#22c55e', '#e879f9', '#facc15', '#f43f5e']

const HELP = `
Oasis Colyseus room swarm stress harness

Usage:
  node scripts/oasis-room-swarm.mjs [options]
  pnpm stress:room -- [options]

Options:
  --url <url>                 Room endpoint. Env: OASIS_ROOM_URL or NEXT_PUBLIC_OASIS_ROOM_URL.
                              Default: ${DEFAULT_ROOM_URL}
  --worlds <ids>              Comma-separated world ids. Env: OASIS_SWARM_WORLDS.
  --world-count <n>           Generate this many world ids if --worlds is omitted. Default: 1
  --world-prefix <name>       Prefix for generated world ids. Default: ${DEFAULT_WORLD_PREFIX}
  --users-per-world <n>       Virtual users per world. Env: OASIS_SWARM_USERS_PER_WORLD. Default: 8
  --ramp-delay <ms>           Delay between user joins. Env: OASIS_SWARM_RAMP_DELAY_MS. Default: 250
  --duration <ms|s|m>         Active run duration after ramp. Env: OASIS_SWARM_DURATION_MS. Default: 60s
  --scenario <name>           human | idle | move | pvp | edits | mixed | paint | terrain | objects | chaos.
                              Default: human
  --pvp / --no-pvp            Enable/disable PvP join flag and casts. Default: scenario-dependent
  --edits / --no-edits        Enable/disable lightweight mutation commands. Default: scenario-dependent
  --command-rail              Send edit traffic through the new room command rail instead of legacy mutation.
  --join-claim / --no-join-claim
                              Fetch signed room join claims from the Oasis web app. Default: on for 04515.xyz, off for local.
  --web-url <url>             Oasis web app URL for join claims. Env: OASIS_WEB_URL.
  --ensure-worlds             Create disposable writable swarm worlds through the web app before joining.
                              Only works with generated --world-count worlds, not explicit --worlds ids.
  --world-visibility <value>  Visibility for --ensure-worlds. Default: ffa
  --max-hp <n>                Join maxHp/vitals maxHp. Default: 100
  --max-mana <n>              Join mana/maxMana/vitals maxMana. Default: 20
  --input-hz <n>              Movement/input sends per user per second. Default: 4
  --cast-interval <ms|s>      PvP cast interval per casting user. Default: 3s
  --mutation-interval <ms|s>  Edit mutation interval per editing user. Default: 5s
  --paint-size <n>            Ground paint brush size for paint/chaos scenarios. Default: 3
  --paint-stretch <n>         Ground paint stretch for paint/chaos scenarios. Default: 1
  --max-objects-per-bot <n>   Object spam ring size before bots transform/remove old objects. Default: 40
  --join-timeout <ms|s>       Per-user join timeout. Default: 10s
  --drain-timeout <ms|s>      Wait for in-flight command acks before leaving. Default: 3s
  --json <path>               Write JSON summary to a file in addition to stdout.
  --dry-run                   Print resolved config and exit without connecting.
  --help                      Show this help.

Examples:
  pnpm stress:room -- --worlds portal-zero --users-per-world 8 --duration 90s --scenario mixed
  node scripts/oasis-room-swarm.mjs --url ws://localhost:4519 --world-count 3 --users-per-world 12 --pvp
`.trim()

function parseDuration(value, fallbackMs) {
  if (value === undefined || value === null || value === '') return fallbackMs
  const raw = String(value).trim().toLowerCase()
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/)
  if (!match) throw new Error(`Invalid duration: ${value}`)
  const n = Number(match[1])
  const unit = match[2] || 'ms'
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid duration: ${value}`)
  if (unit === 'm') return Math.round(n * 60_000)
  if (unit === 's') return Math.round(n * 1000)
  return Math.round(n)
}

function parseNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = true } = {}) {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${value}`)
  const clamped = Math.max(min, Math.min(max, n))
  return integer ? Math.floor(clamped) : clamped
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const raw = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  throw new Error(`Invalid boolean: ${value}`)
}

function readArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`)
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (key === 'help') {
      out.help = true
      continue
    }
    if (key === 'dryRun') {
      out.dryRun = true
      continue
    }
    if (key === 'pvp') {
      out.pvp = true
      continue
    }
    if (key === 'noPvp') {
      out.pvp = false
      continue
    }
    if (key === 'edits') {
      out.edits = true
      continue
    }
    if (key === 'noEdits') {
      out.edits = false
      continue
    }
    if (key === 'commandRail') {
      out.commandRail = true
      continue
    }
    if (key === 'joinClaim') {
      out.joinClaim = true
      continue
    }
    if (key === 'noJoinClaim') {
      out.joinClaim = false
      continue
    }
    if (key === 'ensureWorlds') {
      out.ensureWorlds = true
      continue
    }
    const value = inlineValue ?? argv[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${rawKey}`)
    out[key] = value
  }
  return out
}

function resolveConfig(argv, env) {
  const args = readArgs(argv)
  if (args.help) return { help: true }

  const scenario = String(args.scenario ?? env.OASIS_SWARM_SCENARIO ?? 'human').trim().toLowerCase()
  if (!['human', 'idle', 'move', 'pvp', 'edits', 'mixed', 'paint', 'terrain', 'objects', 'chaos'].includes(scenario)) {
    throw new Error(`Invalid scenario "${scenario}". Use human, idle, move, pvp, edits, mixed, paint, terrain, objects, or chaos.`)
  }

  const explicitWorlds = String(args.worlds ?? env.OASIS_SWARM_WORLDS ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  const worldCount = parseNumber(args.worldCount ?? env.OASIS_SWARM_WORLD_COUNT, 1, { min: 1, max: 500 })
  const worldPrefix = String(args.worldPrefix ?? env.OASIS_SWARM_WORLD_PREFIX ?? DEFAULT_WORLD_PREFIX)
    .trim()
    .replace(/[^a-zA-Z0-9_:.-]/g, '')
    .slice(0, 80) || DEFAULT_WORLD_PREFIX
  const worlds = explicitWorlds.length > 0
    ? explicitWorlds
    : Array.from({ length: worldCount }, (_, i) => `${worldPrefix}-${i + 1}`)

  const defaultPvp = scenario === 'pvp' || scenario === 'mixed'
  const defaultEdits = scenario === 'edits' || scenario === 'mixed' || scenario === 'paint' || scenario === 'terrain' || scenario === 'objects' || scenario === 'chaos'
  const pvp = parseBool(args.pvp ?? env.OASIS_SWARM_PVP, defaultPvp)
  const edits = parseBool(args.edits ?? env.OASIS_SWARM_EDITS, defaultEdits)
  const roomUrl = String(args.url ?? env.OASIS_ROOM_URL ?? env.NEXT_PUBLIC_OASIS_ROOM_URL ?? DEFAULT_ROOM_URL).trim()
  const hostedRoom = /04515\.xyz/i.test(roomUrl) || roomUrl.startsWith('wss://')
  const joinClaim = parseBool(args.joinClaim ?? env.OASIS_SWARM_JOIN_CLAIM, hostedRoom)

  return {
    help: false,
    dryRun: Boolean(args.dryRun),
    url: roomUrl,
    webUrl: String(args.webUrl ?? env.OASIS_WEB_URL ?? (hostedRoom ? 'https://04515.xyz' : 'http://localhost:4516')).replace(/\/+$/, ''),
    worlds,
    worldsExplicit: explicitWorlds.length > 0,
    ensureWorlds: Boolean(args.ensureWorlds ?? parseBool(env.OASIS_SWARM_ENSURE_WORLDS, false)),
    worldVisibility: String(args.worldVisibility ?? env.OASIS_SWARM_WORLD_VISIBILITY ?? 'ffa').trim() || 'ffa',
    usersPerWorld: parseNumber(args.usersPerWorld ?? env.OASIS_SWARM_USERS_PER_WORLD, 8, { min: 1, max: 1_000 }),
    rampDelayMs: parseDuration(args.rampDelay ?? env.OASIS_SWARM_RAMP_DELAY_MS, 250),
    durationMs: parseDuration(args.duration ?? env.OASIS_SWARM_DURATION_MS, 60_000),
    scenario,
    pvp,
    edits,
    commandRail: Boolean(args.commandRail),
    joinClaim,
    maxHp: parseNumber(args.maxHp ?? env.OASIS_SWARM_MAX_HP, 100, { min: 1, max: 10_000 }),
    maxMana: parseNumber(args.maxMana ?? env.OASIS_SWARM_MAX_MANA, 20, { min: 1, max: 10_000 }),
    inputHz: parseNumber(args.inputHz ?? env.OASIS_SWARM_INPUT_HZ, 4, { min: 0, max: 30, integer: false }),
    castIntervalMs: parseDuration(args.castInterval ?? env.OASIS_SWARM_CAST_INTERVAL_MS, 3_000),
    mutationIntervalMs: parseDuration(args.mutationInterval ?? env.OASIS_SWARM_MUTATION_INTERVAL_MS, 5_000),
    paintSize: parseNumber(args.paintSize ?? env.OASIS_SWARM_PAINT_SIZE, 3, { min: 1, max: 5 }),
    paintStretch: parseNumber(args.paintStretch ?? env.OASIS_SWARM_PAINT_STRETCH, 1, { min: 1, max: 8 }),
    maxObjectsPerBot: parseNumber(args.maxObjectsPerBot ?? env.OASIS_SWARM_MAX_OBJECTS_PER_BOT, 40, { min: 1, max: 2_000 }),
    joinTimeoutMs: parseDuration(args.joinTimeout ?? env.OASIS_SWARM_JOIN_TIMEOUT_MS, 10_000),
    drainTimeoutMs: parseDuration(args.drainTimeout ?? env.OASIS_SWARM_DRAIN_TIMEOUT_MS, 3_000),
    jsonPath: args.json ? String(args.json) : '',
  }
}

function extractSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

function mergeCookieHeader(existing, setCookieHeaders) {
  const jar = new Map()
  if (existing) {
    for (const part of existing.split(';')) {
      const [name, ...rest] = part.trim().split('=')
      if (name && rest.length > 0) jar.set(name, rest.join('='))
    }
  }
  for (const header of setCookieHeaders) {
    const first = String(header).split(';')[0]
    const [name, ...rest] = first.split('=')
    if (name && rest.length > 0) jar.set(name.trim(), rest.join('=').trim())
  }
  return Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join('; ')
}

async function fetchRoomJoinClaim(config, worldId) {
  if (!config.joinClaim) return null
  const cookie = await initWebSession(config)
  const claimResponse = await fetch(`${config.webUrl}/api/rooms/join-claim?worldId=${encodeURIComponent(worldId)}`, {
    headers: cookie ? { cookie } : undefined,
  })
  if (!claimResponse.ok) throw new Error(`join claim failed: HTTP ${claimResponse.status}`)
  return claimResponse.json()
}

async function initWebSession(config) {
  let cookie = ''
  const sessionResponse = await fetch(`${config.webUrl}/api/session/init`, {
    headers: cookie ? { cookie } : undefined,
  })
  cookie = mergeCookieHeader(cookie, extractSetCookie(sessionResponse.headers))
  if (!sessionResponse.ok) throw new Error(`session init failed: HTTP ${sessionResponse.status}`)
  return cookie
}

async function ensureSwarmWorlds(config) {
  if (!config.ensureWorlds) return config.worlds
  if (config.worldsExplicit) {
    throw new Error('--ensure-worlds cannot be combined with explicit --worlds because /api/worlds assigns ids')
  }
  const cookie = await initWebSession(config)
  const runId = Date.now().toString(36)
  const created = []
  for (let i = 0; i < config.worlds.length; i += 1) {
    const response = await fetch(`${config.webUrl}/api/worlds`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        name: `Swarm ${runId} ${i + 1}`,
        icon: 'S',
        visibility: config.worldVisibility,
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`create swarm world failed: HTTP ${response.status}${text ? ` ${text.slice(0, 240)}` : ''}`)
    }
    const meta = await response.json()
    if (!meta?.id) throw new Error('create swarm world response missing id')
    created.push(meta.id)
  }
  return created
}

function makeMetrics(config) {
  const byWorld = Object.fromEntries(config.worlds.map(worldId => [worldId, {
    targetUsers: config.usersPerWorld,
    joinOk: 0,
    joinFail: 0,
    disconnects: 0,
    messagesSent: 0,
    castsSent: 0,
    mutationsSent: 0,
    commandsSent: 0,
    commandKindCounts: {},
    commandEvents: 0,
    commandRejected: 0,
    commandLatencyCount: 0,
    commandLatencyTotalMs: 0,
    commandLatencyMaxMs: 0,
    leaveTimeouts: 0,
    errors: 0,
    peakPlayersSeen: 0,
    approxBytesSent: 0,
    approxBytesReceived: 0,
  }]))

  return {
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: 0,
    targetUsers: config.worlds.length * config.usersPerWorld,
    joinOk: 0,
    joinFail: 0,
    disconnects: 0,
    messagesSent: 0,
    castsSent: 0,
    mutationsSent: 0,
    commandsSent: 0,
    commandKindCounts: {},
    commandEvents: 0,
    commandRejected: 0,
    commandLatencyCount: 0,
    commandLatencyTotalMs: 0,
    commandLatencyMaxMs: 0,
    commandLatencyP95Ms: 0,
    pendingCommands: 0,
    leaveTimeouts: 0,
    _pendingCommands: new Map(),
    _commandLatenciesMs: [],
    errors: 0,
    approxBytesSent: 0,
    approxBytesReceived: 0,
    stateChanges: 0,
    approxStateBytesReceived: 0,
    byWorld,
    samples: [],
    errorSamples: [],
  }
}

function inc(metrics, worldId, key, amount = 1) {
  metrics[key] += amount
  if (metrics.byWorld[worldId]) metrics.byWorld[worldId][key] += amount
}

function addApproxBytes(metrics, worldId, key, amount) {
  metrics[key] += amount
  if (metrics.byWorld[worldId]) metrics.byWorld[worldId][key] += amount
}

function incCommandKind(metrics, worldId, kind) {
  metrics.commandKindCounts[kind] = (metrics.commandKindCounts[kind] || 0) + 1
  if (metrics.byWorld[worldId]) {
    metrics.byWorld[worldId].commandKindCounts[kind] = (metrics.byWorld[worldId].commandKindCounts[kind] || 0) + 1
  }
}

function pushError(metrics, worldId, error) {
  inc(metrics, worldId, 'errors')
  if (metrics.errorSamples.length >= 20) return
  metrics.errorSamples.push({
    at: new Date().toISOString(),
    worldId,
    message: error instanceof Error ? error.message : String(error),
  })
}

function recordCommandSent(metrics, bot, command) {
  incCommandKind(metrics, bot.worldId, command.kind || 'unknown')
  metrics._pendingCommands.set(command.id, {
    at: performance.now(),
    worldId: bot.worldId,
  })
}

function recordCommandEvent(metrics, worldId, event) {
  inc(metrics, worldId, 'commandEvents')
  try {
    addApproxBytes(metrics, worldId, 'approxBytesReceived', Buffer.byteLength(JSON.stringify(event)))
  } catch {}
  const commandId = typeof event?.commandId === 'string' ? event.commandId : ''
  const pending = commandId ? metrics._pendingCommands.get(commandId) : null
  if (pending) {
    metrics._pendingCommands.delete(commandId)
    const latencyMs = Math.max(0, performance.now() - pending.at)
    metrics._commandLatenciesMs.push(latencyMs)
    metrics.commandLatencyCount += 1
    metrics.commandLatencyTotalMs += latencyMs
    metrics.commandLatencyMaxMs = Math.max(metrics.commandLatencyMaxMs, latencyMs)
    const bucket = metrics.byWorld[pending.worldId]
    if (bucket) {
      bucket.commandLatencyCount += 1
      bucket.commandLatencyTotalMs += latencyMs
      bucket.commandLatencyMaxMs = Math.max(bucket.commandLatencyMaxMs, latencyMs)
    }
  }
  if (event?.kind === 'command.rejected') {
    inc(metrics, worldId, 'commandRejected')
    pushError(metrics, worldId, new Error(`command rejected: ${event.error || 'unknown'}`))
  }
}

function finalizeCommandLatency(metrics) {
  const latencies = metrics._commandLatenciesMs.slice().sort((a, b) => a - b)
  const p95Index = latencies.length > 0 ? Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95)) : -1
  metrics.commandLatencyP95Ms = p95Index >= 0 ? Math.round(latencies[p95Index]) : 0
  metrics.commandLatencyAvgMs = metrics.commandLatencyCount > 0
    ? Math.round(metrics.commandLatencyTotalMs / metrics.commandLatencyCount)
    : 0
  metrics.commandLatencyMaxMs = Math.round(metrics.commandLatencyMaxMs)
  const durationSec = Math.max(0.001, metrics.durationMs / 1000)
  metrics.approxSendKBps = Math.round((metrics.approxBytesSent / 1024 / durationSec) * 10) / 10
  metrics.approxReceiveKBps = Math.round((metrics.approxBytesReceived / 1024 / durationSec) * 10) / 10
  metrics.approxStateReceiveKBps = Math.round((metrics.approxStateBytesReceived / 1024 / durationSec) * 10) / 10
  metrics.approxTotalReceiveKBps = Math.round(((metrics.approxBytesReceived + metrics.approxStateBytesReceived) / 1024 / durationSec) * 10) / 10
  metrics.pendingCommands = metrics._pendingCommands.size
  for (const bucket of Object.values(metrics.byWorld)) {
    bucket.commandLatencyAvgMs = bucket.commandLatencyCount > 0
      ? Math.round(bucket.commandLatencyTotalMs / bucket.commandLatencyCount)
      : 0
    bucket.commandLatencyMaxMs = Math.round(bucket.commandLatencyMaxMs)
    bucket.commandLatencyTotalMs = Math.round(bucket.commandLatencyTotalMs)
  }
  Reflect.deleteProperty(metrics, '_pendingCommands')
  Reflect.deleteProperty(metrics, '_commandLatenciesMs')
}

async function waitForPendingCommands(metrics, timeoutMs) {
  const deadline = performance.now() + Math.max(0, timeoutMs)
  while (metrics._pendingCommands.size > 0 && performance.now() < deadline) {
    await sleep(50)
  }
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function makeInput(bot) {
  const now = Date.now()
  const elapsed = (now - bot.startedAt) / 1000
  const wander = Math.sin(elapsed * bot.turnRate + bot.phase)
  const speed = bot.scenario === 'idle' ? 0 : bot.speed
  bot.yaw += randomBetween(-0.18, 0.18) + wander * 0.03
  bot.x += Math.sin(bot.yaw) * speed
  bot.z += Math.cos(bot.yaw) * speed
  bot.x = Math.max(-80, Math.min(80, bot.x))
  bot.z = Math.max(-80, Math.min(80, bot.z))
  const moving = speed > 0.001 && Math.random() > 0.18
  return {
    x: Number(bot.x.toFixed(3)),
    y: 1,
    z: Number(bot.z.toFixed(3)),
    yaw: Number(bot.yaw.toFixed(4)),
    vx: Number((Math.sin(bot.yaw) * speed * 20).toFixed(3)),
    vz: Number((Math.cos(bot.yaw) * speed * 20).toFixed(3)),
    animState: moving ? (speed > 0.12 ? 'run' : 'walk') : ANIMS[Math.floor(Math.random() * ANIMS.length)],
  }
}

function makeCast(bot) {
  const spell = SPELLS[Math.floor(Math.random() * SPELLS.length)]
  const yaw = bot.yaw + randomBetween(-0.18, 0.18)
  return {
    spell,
    design: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)],
    ox: Number(bot.x.toFixed(3)),
    oy: 2.2,
    oz: Number(bot.z.toFixed(3)),
    dx: Number(Math.sin(yaw).toFixed(4)),
    dy: Number(randomBetween(-0.02, 0.04).toFixed(4)),
    dz: Number(Math.cos(yaw).toFixed(4)),
    speed: spell === 'lightning-bolt' ? 38 : 26,
    damage: spell === 'ice-bolt' ? 10 : 14,
    seed: Math.floor(Math.random() * 0xffffffff),
    clientPredictionId: `sw${bot.index}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
  }
}

function makeMutation(bot) {
  return {
    kind: 'placement_vfx',
    payload: {
      position: [Number(bot.x.toFixed(2)), 1, Number(bot.z.toFixed(2))],
      typeOverride: 'sparkle',
    },
  }
}

function makePaintCommand(bot) {
  return {
    id: `swarm-command-${bot.index}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind: 'ground.paint',
    worldId: bot.worldId,
    actorId: bot.playerId,
    actorDisplayName: bot.displayName,
    createdAt: new Date().toISOString(),
    payload: {
      cx: Math.max(-49, Math.min(49, Math.round(bot.x))),
      cz: Math.max(-49, Math.min(49, Math.round(bot.z))),
      presetId: bot.paintPreset,
      size: bot.paintSize,
      stretch: bot.paintStretch,
    },
  }
}

function makeTerrainCommand(bot) {
  return {
    id: `swarm-command-${bot.index}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind: 'terrain.brush',
    worldId: bot.worldId,
    actorId: bot.playerId,
    actorDisplayName: bot.displayName,
    createdAt: new Date().toISOString(),
    payload: {
      x: Math.max(-49, Math.min(49, Number(bot.x.toFixed(2)))),
      z: Math.max(-49, Math.min(49, Number(bot.z.toFixed(2)))),
      radius: 3,
      intensity: 1.2,
      direction: Math.random() > 0.35 ? 'up' : 'down',
      deltaSeconds: 0.12,
    },
  }
}

function makeVfxCommand(bot) {
  return {
    id: `swarm-command-${bot.index}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind: 'placement.vfx',
    worldId: bot.worldId,
    actorId: bot.playerId,
    actorDisplayName: bot.displayName,
    createdAt: new Date().toISOString(),
    payload: {
      position: [Number(bot.x.toFixed(2)), 1, Number(bot.z.toFixed(2))],
      typeOverride: 'sparkle',
    },
  }
}

function makeObjectAddCommand(bot) {
  const id = `swarm-object-${bot.index}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  bot.placedObjectIds.push(id)
  return {
    id: `swarm-command-${bot.index}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind: 'object.add',
    worldId: bot.worldId,
    actorId: bot.playerId,
    actorDisplayName: bot.displayName,
    createdAt: new Date().toISOString(),
    payload: {
      object: {
        id,
        catalogId: 'platform_1x1',
        name: `Swarm Platform ${bot.index}`,
        glbPath: '/models/cyberpunk/Cyberpunk Game Kit - Quaternius/Platforms/Platform_1x1_Empty.gltf',
        position: [Number(bot.x.toFixed(2)), 0, Number(bot.z.toFixed(2))],
        rotation: [0, Number(bot.yaw.toFixed(3)), 0],
        scale: 1,
      },
    },
  }
}

function makeObjectTransformCommand(bot) {
  const id = bot.placedObjectIds[Math.floor(Math.random() * bot.placedObjectIds.length)]
  return {
    id: `swarm-command-${bot.index}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind: 'object.transform',
    worldId: bot.worldId,
    actorId: bot.playerId,
    actorDisplayName: bot.displayName,
    createdAt: new Date().toISOString(),
    payload: {
      id,
      position: [Number((bot.x + randomBetween(-2, 2)).toFixed(2)), 0, Number((bot.z + randomBetween(-2, 2)).toFixed(2))],
      rotation: [0, Number((bot.yaw + randomBetween(-0.4, 0.4)).toFixed(3)), 0],
      scale: Number(randomBetween(0.8, 1.6).toFixed(2)),
    },
  }
}

function makeObjectRemoveCommand(bot) {
  const id = bot.placedObjectIds.shift()
  return {
    id: `swarm-command-${bot.index}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind: 'object.remove',
    worldId: bot.worldId,
    actorId: bot.playerId,
    actorDisplayName: bot.displayName,
    createdAt: new Date().toISOString(),
    payload: { id },
  }
}

function makeObjectCommand(bot, config) {
  if (bot.placedObjectIds.length === 0) return makeObjectAddCommand(bot)
  if (bot.placedObjectIds.length < config.maxObjectsPerBot) {
    return Math.random() < 0.8 ? makeObjectAddCommand(bot) : makeObjectTransformCommand(bot)
  }
  return Math.random() < 0.65 ? makeObjectTransformCommand(bot) : makeObjectRemoveCommand(bot)
}

function makeCommand(bot, config) {
  if (bot.scenario === 'paint') return makePaintCommand(bot)
  if (bot.scenario === 'terrain') return makeTerrainCommand(bot)
  if (bot.scenario === 'objects') return makeObjectCommand(bot, config)
  if (bot.scenario === 'chaos') {
    const roll = Math.random()
    if (roll < 0.42) return makePaintCommand(bot)
    if (roll < 0.62) return makeTerrainCommand(bot)
    if (roll < 0.90) return makeObjectCommand(bot, config)
    return makeVfxCommand(bot)
  }
  return Math.random() > 0.5 ? makePaintCommand(bot) : makeVfxCommand(bot)
}

function sendSafe(room, type, payload, bot, metrics, countKey = null) {
  try {
    room.send(type, payload)
    inc(metrics, bot.worldId, 'messagesSent')
    try {
      addApproxBytes(metrics, bot.worldId, 'approxBytesSent', Buffer.byteLength(JSON.stringify({ type, payload })))
    } catch {}
    if (countKey) inc(metrics, bot.worldId, countKey)
    return true
  } catch (error) {
    pushError(metrics, bot.worldId, error)
    return false
  }
}

async function leaveRoomWithTimeout(room, timeoutMs = 1_500) {
  let timer
  let leaveError = null
  const leavePromise = Promise.resolve(room.leave(true)).then(
    () => 'left',
    error => {
      leaveError = error
      return 'error'
    },
  )
  const timeoutPromise = new Promise(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })

  const result = await Promise.race([leavePromise, timeoutPromise])
  clearTimeout(timer)
  if (result === 'error' && leaveError) throw leaveError
  return result
}

async function withTimeout(promise, timeoutMs, label) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function startBot(bot, config, metrics, stopSignal) {
  const client = new Client(config.url)
  let room
  let joinSettled = false
  let joinClaim = null
  try {
    joinClaim = await fetchRoomJoinClaim(config, bot.worldId)
  } catch (error) {
    inc(metrics, bot.worldId, 'joinFail')
    pushError(metrics, bot.worldId, error)
    return null
  }
  const joinPromise = client.joinOrCreate('world', {
    worldId: bot.worldId,
    playerId: bot.playerId,
    userId: joinClaim?.userId,
    joinClaim: joinClaim?.claim,
    displayName: bot.displayName,
    color: bot.color,
    pvpEnabled: joinClaim?.pvpEnabled === true || config.pvp,
    maxHp: config.maxHp,
    mana: config.maxMana,
    maxMana: config.maxMana,
  }).finally(() => {
    joinSettled = true
  })
  try {
    room = await withTimeout(joinPromise, config.joinTimeoutMs, `join ${bot.playerId}`)
    bot.sessionId = room.sessionId
    inc(metrics, bot.worldId, 'joinOk')
  } catch (error) {
    if (!joinSettled) {
      joinPromise
        .then(lateRoom => lateRoom.leave(true).catch(leaveError => pushError(metrics, bot.worldId, leaveError)))
        .catch(() => {})
    }
    inc(metrics, bot.worldId, 'joinFail')
    pushError(metrics, bot.worldId, error)
    return null
  }

  room.onLeave((code) => {
    if (!stopSignal.stopping) inc(metrics, bot.worldId, 'disconnects')
    if (!stopSignal.stopping && code !== 1000 && code !== 1001) {
      pushError(metrics, bot.worldId, new Error(`room left with code ${code}`))
    }
  })

  room.onMessage('worldEvent', (event) => {
    recordCommandEvent(metrics, bot.worldId, event)
  })
  room.onMessage('worldSnapshot', (snapshot) => {
    try {
      addApproxBytes(metrics, bot.worldId, 'approxBytesReceived', Buffer.byteLength(JSON.stringify(snapshot)))
    } catch {}
  })
  room.onMessage('cast', () => {
    // Remote casts are expected during PvP stress; registering avoids noisy
    // colyseus.js warnings from the harness itself.
  })
  ;(room.onError)((code, message) => {
    pushError(metrics, bot.worldId, new Error(`room error ${code}: ${message}`))
  })
  room.onStateChange((state) => {
    const size = typeof state?.players?.size === 'number' ? state.players.size : 0
    metrics.byWorld[bot.worldId].peakPlayersSeen = Math.max(metrics.byWorld[bot.worldId].peakPlayersSeen, size)
    metrics.stateChanges += 1
    try {
      const json = typeof state?.toJSON === 'function' ? state.toJSON() : state
      metrics.approxStateBytesReceived += Buffer.byteLength(JSON.stringify(json))
    } catch {}
  })

  sendSafe(room, 'profile', {
    displayName: bot.displayName,
    color: bot.color,
  }, bot, metrics)
  sendSafe(room, 'vitals', {
    hp: config.maxHp,
    maxHp: config.maxHp,
    mana: config.maxMana,
    maxMana: config.maxMana,
  }, bot, metrics)

  const inputIntervalMs = config.inputHz > 0 ? Math.max(34, Math.round(1000 / config.inputHz)) : 0
  let inputTimer = null
  let castTimer = null
  let mutationTimer = null
  let stopped = false

  if (inputIntervalMs > 0) {
    inputTimer = setInterval(() => {
      if (!stopSignal.stopping) sendSafe(room, 'input', makeInput(bot), bot, metrics)
    }, inputIntervalMs + Math.floor(randomBetween(0, 60)))
  }
  if (config.pvp && config.castIntervalMs > 0 && bot.scenario !== 'idle') {
    const interval = Math.max(250, config.castIntervalMs + Math.floor(randomBetween(-200, 400)))
    castTimer = setInterval(() => {
      if (!stopSignal.stopping) sendSafe(room, 'cast', makeCast(bot), bot, metrics, 'castsSent')
    }, interval)
  }
  if (config.edits && config.mutationIntervalMs > 0) {
    const interval = Math.max(500, config.mutationIntervalMs + Math.floor(randomBetween(-500, 800)))
    mutationTimer = setInterval(() => {
      if (stopSignal.stopping) return
      if (config.commandRail) {
        const command = makeCommand(bot, config)
        recordCommandSent(metrics, bot, command)
        if (!sendSafe(room, 'command', command, bot, metrics, 'commandsSent')) {
          metrics._pendingCommands.delete(command.id)
        }
      } else {
        sendSafe(room, 'mutation', makeMutation(bot), bot, metrics, 'mutationsSent')
      }
    }, interval)
  }

  return {
    bot,
    room,
    async stop() {
      if (stopped) return
      stopped = true
      clearInterval(inputTimer)
      clearInterval(castTimer)
      clearInterval(mutationTimer)
      try {
        const result = await leaveRoomWithTimeout(room)
        if (result === 'timeout') {
          inc(metrics, bot.worldId, 'leaveTimeouts')
        }
      } catch (error) {
        pushError(metrics, bot.worldId, error)
      }
    },
  }
}

function makeBots(config) {
  const bots = []
  let index = 0
  for (const worldId of config.worlds) {
    for (let i = 0; i < config.usersPerWorld; i += 1) {
      index += 1
      const scenario = config.scenario === 'human'
        ? (Math.random() < 0.2 ? 'idle' : 'move')
        : config.scenario
      bots.push({
        index,
        worldId,
        scenario,
        playerId: `swarm-${Date.now().toString(36)}-${index}`,
        displayName: `Swarm ${index}`,
        color: COLORS[index % COLORS.length],
        startedAt: Date.now(),
        phase: randomBetween(0, Math.PI * 2),
        turnRate: randomBetween(0.4, 1.5),
        speed: scenario === 'idle' ? 0 : randomBetween(0.03, 0.18),
        x: randomBetween(-8, 8),
        z: randomBetween(-8, 8),
        yaw: randomBetween(-Math.PI, Math.PI),
        paintPreset: ['grass', 'stone', 'sand', 'mud', 'snow'][index % 5],
        paintSize: config.paintSize,
        paintStretch: config.paintStretch,
        placedObjectIds: [],
      })
    }
  }
  return bots
}

function publicConfig(config) {
  return {
    url: config.url,
    worlds: config.worlds,
    usersPerWorld: config.usersPerWorld,
    targetUsers: config.worlds.length * config.usersPerWorld,
    rampDelayMs: config.rampDelayMs,
    durationMs: config.durationMs,
    scenario: config.scenario,
    pvp: config.pvp,
    edits: config.edits,
    commandRail: config.commandRail,
    joinClaim: config.joinClaim,
    webUrl: config.webUrl,
    ensureWorlds: config.ensureWorlds,
    worldVisibility: config.worldVisibility,
    maxHp: config.maxHp,
    maxMana: config.maxMana,
    inputHz: config.inputHz,
    castIntervalMs: config.castIntervalMs,
    mutationIntervalMs: config.mutationIntervalMs,
    paintSize: config.paintSize,
    paintStretch: config.paintStretch,
    maxObjectsPerBot: config.maxObjectsPerBot,
    joinTimeoutMs: config.joinTimeoutMs,
    drainTimeoutMs: config.drainTimeoutMs,
  }
}

async function writeJsonSummary(path, summary) {
  if (!path) return
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
}

async function main() {
  const config = resolveConfig(process.argv.slice(2), process.env)
  if (config.help) {
    console.log(HELP)
    return
  }

  if (config.dryRun) {
    console.log(JSON.stringify({ dryRun: true, config: publicConfig(config) }, null, 2))
    return
  }

  if (config.ensureWorlds) {
    config.worlds = await ensureSwarmWorlds(config)
  }
  const resolved = publicConfig(config)

  const metrics = makeMetrics(config)
  const started = performance.now()
  const stopSignal = { stopping: false, wake: null }
  const active = []
  const bots = makeBots(config)

  const stop = async () => {
    const firstStop = !stopSignal.stopping
    stopSignal.stopping = true
    if (firstStop && typeof stopSignal.wake === 'function') stopSignal.wake()
    await Promise.allSettled(active.map(item => item.stop()))
  }

  process.once('SIGINT', () => {
    console.warn('\nSIGINT received; draining swarm...')
    stop().catch(error => pushError(metrics, 'global', error))
  })

  console.log(`[swarm] connecting ${bots.length} users to ${config.url}`)
  console.log(`[swarm] worlds=${config.worlds.join(',')} usersPerWorld=${config.usersPerWorld} scenario=${config.scenario} pvp=${config.pvp} edits=${config.edits}`)

  const joinTasks = []
  for (const bot of bots) {
    if (stopSignal.stopping) break
    const joinTask = startBot(bot, config, metrics, stopSignal).then(async handle => {
      if (!handle) return
      if (stopSignal.stopping) {
        await handle.stop()
        return
      }
      active.push(handle)
    }).catch(error => {
      inc(metrics, bot.worldId, 'joinFail')
      pushError(metrics, bot.worldId, error)
    })
    joinTasks.push(joinTask)
    await sleep(config.rampDelayMs)
  }

  const sampleTimer = setInterval(() => {
    metrics.samples.push({
      atMs: Math.round(performance.now() - started),
      joinOk: metrics.joinOk,
      joinFail: metrics.joinFail,
      disconnects: metrics.disconnects,
      messagesSent: metrics.messagesSent,
      castsSent: metrics.castsSent,
      mutationsSent: metrics.mutationsSent,
      commandsSent: metrics.commandsSent,
      commandEvents: metrics.commandEvents,
      commandRejected: metrics.commandRejected,
      commandLatencyCount: metrics.commandLatencyCount,
      commandLatencyMaxMs: Math.round(metrics.commandLatencyMaxMs),
      approxBytesSent: metrics.approxBytesSent,
      approxBytesReceived: metrics.approxBytesReceived,
      stateChanges: metrics.stateChanges,
      approxStateBytesReceived: metrics.approxStateBytesReceived,
      leaveTimeouts: metrics.leaveTimeouts,
      errors: metrics.errors,
    })
  }, 5_000)

  await new Promise(resolve => {
    const timer = setTimeout(resolve, config.durationMs)
    stopSignal.wake = () => {
      clearTimeout(timer)
      resolve()
    }
    if (stopSignal.stopping) stopSignal.wake()
  })
  stopSignal.wake = null
  stopSignal.stopping = true
  await waitForPendingCommands(metrics, config.drainTimeoutMs)
  clearInterval(sampleTimer)
  await stop()
  await Promise.allSettled(joinTasks)
  await stop()

  metrics.endedAt = new Date().toISOString()
  metrics.durationMs = Math.round(performance.now() - started)
  finalizeCommandLatency(metrics)

  const summary = {
    config: resolved,
    metrics,
  }
  await writeJsonSummary(config.jsonPath, summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch(error => {
  console.error(`[swarm] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
