// ░▒▓ VILLAGE ACADEMY — a skill tree in the village where the owner trains agents ▓▒░
// Pure: what a skill is, what a trainee has, XP and level, the tree's layout, the keys. No fs, no three.js.
//
// The skills, keys and level names are content, read from a private folder (OASIS_ACADEMY_DIR, see
// academy-server.ts); this repo ships only a three-skill sample (academy-sample.ts).
// A trainee is an agent, keyed by its session id. Per skill it has: none | claimed | verified.
// Level = verified XP + half of the claimed XP (rounded down), then the highest level whose XP it reaches.

import type { Vec3 } from './village-layout'

export type AcademySkillState = 'none' | 'claimed' | 'verified'
export const ACADEMY_SKILL_STATES: AcademySkillState[] = ['none', 'claimed', 'verified']

export interface AcademySkill {
  order: number
  id: string
  name: string
  /** 0 = the roots; higher tiers stand further up the tree. */
  tier: number
  lane: string
  what: string
  /** What the owner says to the trainee to start this skill. */
  prompt: string
  /** What has to be shown for it to count. */
  proof: string
  xp: number
  mins: number
  /** Key ids; having any one of them is enough. */
  keys: string[]
  way: string | null
  /** Skill ids that come first. */
  needs: string[]
  /** A shorter name for its label on the skill map. */
  short?: string
  /** Its icon, drawn on a 24 by 24 grid (the skill map shows its number when it has none). */
  icon?: AcademyIconPart[]
  /** An optional side skill; a flagship checkpoint. */
  perk?: boolean
  flag?: boolean
}

/** One shape of an icon: a path (`d`), a circle (`cx cy r`) or a rect (`x y width height rx`), stroked. */
export type AcademyIconPart = ['path' | 'circle' | 'rect', Record<string, string>]

export interface AcademyLane {
  id: string
  name: string
}

/** One set of skills the Academy can show (the film's 13, the full tree...). */
export interface AcademySetInfo {
  id: string
  title: string
  count: number
}

export type AcademyKeyKind = 'subscription' | 'api' | 'account' | 'hardware'

export interface AcademyKey {
  id: string
  name: string
  short: string
  kind: AcademyKeyKind
  cost: string
  link: string
  /** What it is, in a line or two (shown in the keychain). */
  note?: string
  /** Environment variable names this key is kept under, beyond the ones the keychain knows. */
  env?: string[]
}

export interface AcademyLevel {
  name: string
  xp: number
}

export interface AcademyContent {
  skills: AcademySkill[]
  keys: AcademyKey[]
  levels: AcademyLevel[]
  /** `folder`: the private content folder; `sample`: the three skills this repo ships. */
  source: 'folder' | 'sample'
  /** Every lane a skill is in, in the content's order (or the order the skills name them). */
  lanes: AcademyLane[]
  title: string
}

export interface AcademyProgress {
  state: AcademySkillState
  proof?: string
  by?: string
  at?: number
}

export interface AcademyTraineeRecord {
  name: string
  training: boolean
  skills: Record<string, AcademyProgress>
  updatedAt: number
}

/** data/academy.local.json */
export interface AcademyFile {
  v: 1
  trainees: Record<string, AcademyTraineeRecord>
}

export interface AcademyLevelView {
  index: number
  name: string
  xp: number
  next: AcademyLevel | null
}

export interface AcademyTraineeView {
  /** The session id (or the engine's agent id until the agent has a session). */
  key: string
  name: string
  training: boolean
  /** Every skill of the tree, `none` included. */
  skills: Record<string, AcademyProgress>
  xp: { verified: number; claimed: number; score: number }
  level: AcademyLevelView
  /** Skills it can do now: not started, and everything they need is claimed or verified. */
  available: string[]
  /** In training without Spirit and Body verified: it stands as stone. */
  stone: boolean
}

export interface AcademySnapshot extends AcademyContent {
  trainees: AcademyTraineeView[]
}

/**
 * What GET /api/academy answers: the trainees always; the content (skills, keys, levels, lanes) only
 * when the caller doesn't already hold this `rev` of it (`?have=<rev>`), so a poll stays small.
 */
export interface AcademyResponse extends Partial<AcademyContent> {
  set: string
  rev: string
  sets: AcademySetInfo[]
  trainees: AcademyTraineeView[]
}

// ─── content ────────────────────────────────────────────────────────────────

const str = (value: unknown, max = 2000): string => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(item => str(item, 80)).filter(Boolean) : [])
const KEY_KINDS: AcademyKeyKind[] = ['subscription', 'api', 'account', 'hardware']

const ICON_ATTRS: Record<string, string[]> = { path: ['d'], circle: ['cx', 'cy', 'r'], rect: ['x', 'y', 'width', 'height', 'rx'] }

/** An icon as data only: known shapes, known attributes, numbers and path letters, nothing else. */
function iconParts(value: unknown): AcademyIconPart[] {
  if (!Array.isArray(value)) return []
  const out: AcademyIconPart[] = []
  for (const part of value.slice(0, 16)) {
    if (!Array.isArray(part) || typeof part[0] !== 'string' || !ICON_ATTRS[part[0]] || !part[1] || typeof part[1] !== 'object') continue
    const attrs: Record<string, string> = {}
    for (const name of ICON_ATTRS[part[0]]) {
      const raw = (part[1] as Record<string, unknown>)[name]
      const text = typeof raw === 'number' ? String(raw) : str(raw, 1500)
      if (text && /^[\d\s.,eE+\-a-zA-Z]+$/.test(text)) attrs[name] = text
    }
    if (Object.keys(attrs).length) out.push([part[0] as AcademyIconPart[0], attrs])
  }
  return out
}

/** Whatever the JSON files hold, as content the tree can trust: unknown ids dropped, tiers and XP sane. */
export function normalizeAcademyContent(rawSkills: unknown, rawKeys: unknown, source: AcademyContent['source']): AcademyContent | null {
  if (!Array.isArray(rawSkills)) return null
  const seen = new Set<string>()
  const skills: AcademySkill[] = []
  rawSkills.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return
    const item = raw as Record<string, unknown>
    const id = str(item.id, 80)
    if (!id || seen.has(id)) return
    seen.add(id)
    skills.push({
      order: num(item.order, index + 1),
      id,
      name: str(item.name, 80) || id,
      tier: Math.max(0, Math.min(9, Math.round(num(item.tier)))),
      lane: str(item.lane, 40) || 'core',
      what: str(item.what),
      prompt: str(item.prompt, 6000),
      proof: str(item.proof),
      xp: Math.max(0, Math.round(num(item.xp))),
      mins: Math.max(0, Math.round(num(item.mins))),
      keys: ids(item.keys),
      way: str(item.way, 200) || null,
      needs: ids(item.needs),
      ...(str(item.short, 40) ? { short: str(item.short, 40) } : {}),
      ...(iconParts(item.icon).length ? { icon: iconParts(item.icon) } : {}),
      ...(item.perk === true ? { perk: true } : {}),
      ...(item.flag === true ? { flag: true } : {}),
    })
  })
  if (!skills.length) return null
  skills.sort((a, b) => a.order - b.order)
  for (const skill of skills) skill.needs = skill.needs.filter(id => id !== skill.id && seen.has(id))

  const file = (rawKeys && typeof rawKeys === 'object' ? rawKeys : {}) as { keys?: unknown; levels?: unknown }
  const keys: AcademyKey[] = []
  for (const raw of Array.isArray(file.keys) ? file.keys : []) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const id = str(item.id, 80)
    if (!id || keys.some(key => key.id === id)) continue
    const kind = KEY_KINDS.includes(item.kind as AcademyKeyKind) ? item.kind as AcademyKeyKind : 'account'
    const link = str(item.link, 400)
    const env = ids(item.env).filter(name => /^[A-Z][A-Z0-9_]{1,63}$/.test(name))
    keys.push({
      id, name: str(item.name, 80) || id, short: str(item.short, 30) || str(item.name, 30) || id, kind, cost: str(item.cost, 300), link: /^https?:\/\//i.test(link) ? link : '',
      ...(str(item.note, 600) ? { note: str(item.note, 600) } : {}),
      ...(env.length ? { env } : {}),
    })
  }
  const levels: AcademyLevel[] = []
  for (const raw of Array.isArray(file.levels) ? file.levels : []) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const name = str(item.name, 40)
    if (name) levels.push({ name, xp: Math.max(0, Math.round(num(item.xp))) })
  }
  levels.sort((a, b) => a.xp - b.xp)
  if (!levels.length || levels[0].xp > 0) levels.unshift({ name: 'Level 0', xp: 0 })

  // Lanes: the file's list first (it carries names and an order), then any lane a skill names.
  const lanes: AcademyLane[] = []
  const named = (file as { lanes?: unknown }).lanes
  for (const raw of Array.isArray(named) ? named : []) {
    if (!raw || typeof raw !== 'object') continue
    const id = str((raw as Record<string, unknown>).id, 40)
    if (id && !lanes.some(lane => lane.id === id) && skills.some(skill => skill.lane === id)) lanes.push({ id, name: str((raw as Record<string, unknown>).name, 40) || id })
  }
  for (const skill of skills) {
    if (!lanes.some(lane => lane.id === skill.lane)) lanes.push({ id: skill.lane, name: skill.lane.charAt(0).toUpperCase() + skill.lane.slice(1) })
  }
  const title = str((file as { title?: unknown }).title, 80) || `${skills.length} skills`
  return { skills, keys, levels, source, lanes, title }
}

// ─── a trainee's progress ───────────────────────────────────────────────────

export function skillState(progress: Record<string, AcademyProgress> | undefined, id: string): AcademySkillState {
  const state = progress?.[id]?.state
  return state === 'claimed' || state === 'verified' ? state : 'none'
}

/** Not started, and every skill it needs is claimed or verified. */
export function availableSkills(skills: AcademySkill[], progress: Record<string, AcademyProgress> | undefined): string[] {
  return skills
    .filter(skill => skillState(progress, skill.id) === 'none' && skill.needs.every(id => skillState(progress, id) !== 'none'))
    .map(skill => skill.id)
}

export function traineeXp(skills: AcademySkill[], progress: Record<string, AcademyProgress> | undefined): { verified: number; claimed: number; score: number } {
  let verified = 0
  let claimed = 0
  for (const skill of skills) {
    const state = skillState(progress, skill.id)
    if (state === 'verified') verified += skill.xp
    else if (state === 'claimed') claimed += skill.xp
  }
  return { verified, claimed, score: verified + Math.floor(claimed / 2) }
}

/** The highest level whose XP the score reaches. */
export function levelFor(levels: AcademyLevel[], score: number): AcademyLevelView {
  let index = 0
  levels.forEach((level, i) => {
    if (score >= level.xp) index = i
  })
  const level = levels[index] || { name: 'Level 0', xp: 0 }
  return { index, name: level.name, xp: level.xp, next: levels[index + 1] || null }
}

/** A body needs these two before it moves. */
export const ACADEMY_WAKE_SKILLS = ['spirit', 'body']

export function isStone(skills: AcademySkill[], record: Pick<AcademyTraineeRecord, 'training' | 'skills'> | null | undefined): boolean {
  if (!record?.training) return false
  const wake = skills.filter(skill => ACADEMY_WAKE_SKILLS.includes(skill.id))
  return wake.length > 0 && wake.some(skill => skillState(record.skills, skill.id) !== 'verified')
}

export function traineeView(content: Pick<AcademyContent, 'skills' | 'levels'>, key: string, record: AcademyTraineeRecord | null | undefined): AcademyTraineeView {
  const progress = record?.skills || {}
  const skills: Record<string, AcademyProgress> = {}
  for (const skill of content.skills) {
    const entry = progress[skill.id]
    skills[skill.id] = entry && skillState(progress, skill.id) !== 'none' ? entry : { state: 'none' }
  }
  const xp = traineeXp(content.skills, progress)
  return {
    key,
    name: record?.name || key,
    training: Boolean(record?.training),
    skills,
    xp,
    level: levelFor(content.levels, xp.score),
    available: availableSkills(content.skills, progress),
    stone: isStone(content.skills, record),
  }
}

/** How a node looks on the tree. */
export type AcademyNodeLook = 'locked' | 'available' | 'claimed' | 'verified'

export function nodeLook(trainee: Pick<AcademyTraineeView, 'skills' | 'available'> | null, skill: AcademySkill): AcademyNodeLook {
  if (!trainee) return skill.needs.length ? 'locked' : 'available'
  const state = trainee.skills[skill.id]?.state
  if (state === 'verified' || state === 'claimed') return state
  return trainee.available.includes(skill.id) ? 'available' : 'locked'
}

// ─── writes (POST /api/academy) ─────────────────────────────────────────────

export interface AcademyUpdate {
  trainee?: unknown
  name?: unknown
  skill?: unknown
  state?: unknown
  proof?: unknown
  by?: unknown
  training?: unknown
  /** The agent got its session id: move its record from its old key. */
  rekey?: unknown
  remove?: unknown
}

export type AcademyUpdateResult =
  | { ok: true; file: AcademyFile; key: string; warning?: string }
  | { ok: false; status: number; error: string }

/** A session id, or a trainee's name (when exactly one has it). */
export function resolveTraineeKey(file: AcademyFile, trainee: string): string {
  if (file.trainees[trainee]) return trainee
  const wanted = trainee.toLowerCase()
  const byName = Object.keys(file.trainees).filter(key => file.trainees[key].name.toLowerCase() === wanted)
  return byName.length === 1 ? byName[0] : trainee
}

/** One write, applied to the file's contents. Never mutates `file`. */
export function applyAcademyUpdate(file: AcademyFile, skills: AcademySkill[], update: AcademyUpdate, now: number): AcademyUpdateResult {
  const asked = str(update.trainee, 200)
  if (!asked) return { ok: false, status: 400, error: 'trainee is required: the agent\'s session id (or its name)' }
  if (asked === '__proto__' || asked === 'constructor' || asked === 'prototype') return { ok: false, status: 400, error: 'not a trainee key' }
  const key = resolveTraineeKey(file, asked)
  const trainees = { ...file.trainees }
  const existing = trainees[key]
  const name = str(update.name, 80)

  if (update.remove === true) {
    delete trainees[key]
    return { ok: true, file: { v: 1, trainees }, key }
  }

  const rekey = str(update.rekey, 200)
  if (rekey) {
    if (!existing) return { ok: false, status: 404, error: `no trainee ${asked}` }
    if (rekey !== key) {
      // The session's own record wins if it already has one.
      if (!trainees[rekey]) trainees[rekey] = { ...existing, name: name || existing.name, updatedAt: now }
      delete trainees[key]
    }
    return { ok: true, file: { v: 1, trainees }, key: rekey }
  }

  // A skill mark for someone the Academy has never heard of is a typo or an old key, not a new trainee.
  if (!existing && update.skill !== undefined && typeof update.training !== 'boolean' && !name) {
    return { ok: false, status: 404, error: `no trainee ${asked}: use its session id or its name, or send training: true to enrol it` }
  }
  const record: AcademyTraineeRecord = existing
    ? { ...existing, skills: { ...existing.skills } }
    : { name: name || asked, training: false, skills: {}, updatedAt: now }
  if (name) record.name = name
  let touched = false
  let warning: string | undefined

  if (typeof update.training === 'boolean') {
    record.training = update.training
    touched = true
  }

  if (update.skill !== undefined || update.state !== undefined) {
    const skillId = str(update.skill, 80)
    const skill = skills.find(item => item.id === skillId)
    if (!skill) return { ok: false, status: 400, error: `unknown skill ${skillId || '(none)'}: one of ${skills.map(item => item.id).join(', ')}` }
    if (!ACADEMY_SKILL_STATES.includes(update.state as AcademySkillState)) {
      return { ok: false, status: 400, error: 'state must be none, claimed or verified' }
    }
    const state = update.state as AcademySkillState
    if (state === 'none') delete record.skills[skill.id]
    else {
      const missing = skill.needs.filter(id => skillState(record.skills, id) === 'none')
      if (missing.length) warning = `${skill.id} needs ${missing.join(', ')} first; marked anyway`
      const proof = str(update.proof, 600)
      const by = str(update.by, 60)
      record.skills[skill.id] = { state, ...(proof ? { proof } : {}), ...(by ? { by } : {}), at: now }
    }
    touched = true
  }

  if (!touched && !name) return { ok: false, status: 400, error: 'nothing to do: send skill + state, or training: true | false' }
  record.updatedAt = now
  trainees[key] = record
  return { ok: true, file: { v: 1, trainees }, key, ...(warning ? { warning } : {}) }
}

export function parseAcademyFile(text: string): AcademyFile {
  try {
    const raw = JSON.parse(text) as { trainees?: unknown }
    const trainees: Record<string, AcademyTraineeRecord> = {}
    if (raw && typeof raw.trainees === 'object' && raw.trainees) {
      for (const [key, value] of Object.entries(raw.trainees as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') continue
        const item = value as Record<string, unknown>
        const skills: Record<string, AcademyProgress> = {}
        if (item.skills && typeof item.skills === 'object') {
          for (const [id, entry] of Object.entries(item.skills as Record<string, unknown>)) {
            const progress = entry as Record<string, unknown> | null
            if (!progress || (progress.state !== 'claimed' && progress.state !== 'verified')) continue
            const proof = str(progress.proof, 600)
            const by = str(progress.by, 60)
            skills[id] = { state: progress.state, ...(proof ? { proof } : {}), ...(by ? { by } : {}), ...(typeof progress.at === 'number' ? { at: progress.at } : {}) }
          }
        }
        trainees[key] = { name: str(item.name, 80) || key, training: item.training === true, skills, updatedAt: num(item.updatedAt) }
      }
    }
    return { v: 1, trainees }
  } catch {
    return { v: 1, trainees: {} }
  }
}

/** What "Ask Anorak to check" sends him. */
export function academyCheckMessage(input: { name: string; key: string; cwd: string | null; skill: Pick<AcademySkill, 'id' | 'name' | 'proof'>; origin: string }): string {
  const { name, key, cwd, skill, origin } = input
  const body = `{"trainee":"${key}","skill":"${skill.id}","state":"verified" or "claimed","proof":"<what you saw>","by":"Anorak"}`
  return `Academy check: trainee ${name} (session ${key}, folder ${cwd || 'unknown'}) claims skill ${skill.id} '${skill.name}'. `
    + `Proof wanted: ${skill.proof} `
    + `Check it, then POST ${origin}/api/academy ${body}. Use "verified" if you saw the proof, "claimed" if you could not, and say why in "proof".`
}

// ─── the tree in the world ──────────────────────────────────────────────────

/**
 * The tree stands behind the spawn point, across the plaza from the desks, facing the plaza. Tiers
 * rise and step back a little, like a steep stair. Meters.
 */
export const ACADEMY_TREE = {
  /** From the plaza centre to the first row. */
  plazaDistance: 10.5,
  /** Between neighbours in a row, centre to centre. */
  spacing: 2.6,
  /** Centre of a tier-0 medallion above the ground. */
  baseHeight: 1.6,
  tierRise: 2.15,
  /** Each tier stands this much further back: little, so a row is not hidden behind the step in front of it. */
  tierDepth: 0.55,
  medallionRadius: 0.5,
  /** Stand within this (ground distance) of a node and look at it. */
  reach: 8,
  /** ...within this angle of the crosshair, in radians. */
  lookAngle: (11 * Math.PI) / 180,
  /** Or just stand this close to its foot. */
  touch: 1.3,
}

export interface AcademyNodeLayout {
  id: string
  tier: number
  /** Medallion centre in the tree's own frame: +X right, +Y up, +Z toward the plaza. */
  local: Vec3
}

/**
 * One node per skill. A row per tier, centred; within a row a skill stands under the middle of the
 * skills it needs (those in lower rows), so the lines cross as little as a simple rule allows.
 */
export function layoutAcademyNodes(skills: AcademySkill[]): AcademyNodeLayout[] {
  const { spacing, baseHeight, tierRise, tierDepth } = ACADEMY_TREE
  const tiers = [...new Set(skills.map(skill => skill.tier))].sort((a, b) => a - b)
  const placedX = new Map<string, number>()
  const out: AcademyNodeLayout[] = []
  tiers.forEach((tier, row) => {
    const inTier = skills.filter(skill => skill.tier === tier)
    const slotX = (index: number) => (index - (inTier.length - 1) / 2) * spacing
    const wish = inTier.map((skill, index) => {
      const parents = skill.needs.map(id => placedX.get(id)).filter((x): x is number => typeof x === 'number')
      return { skill, index, x: parents.length ? parents.reduce((sum, x) => sum + x, 0) / parents.length : slotX(index) }
    })
    wish.sort((a, b) => a.x - b.x || a.index - b.index)
    wish.forEach((item, index) => {
      const x = slotX(index)
      out.push({ id: item.skill.id, tier, local: [x, baseHeight + row * tierRise, -row * tierDepth] })
    })
    // Only after the whole row: a skill that needs a neighbour in its own row is not pulled toward it.
    wish.forEach((item, index) => placedX.set(item.skill.id, slotX(index)))
  })
  return out
}

/** Where the tree stands: its foot on the ground (y = 0; callers add terrain height) and its yaw. */
export function academyTreeStation(plaza: { x: number; z: number }, yaw: number): { position: Vec3; rotationY: number } {
  const d = ACADEMY_TREE.plazaDistance
  return { position: [plaza.x - Math.sin(yaw) * d, 0, plaza.z - Math.cos(yaw) * d], rotationY: yaw }
}

export interface AcademyPickInput {
  /** Where the owner stands. */
  actor: Vec3 | null
  camera: { position: Vec3; forward: Vec3 } | null
  /** Medallion centres in the world. */
  nodes: Array<{ id: string; position: Vec3 }>
}

/**
 * The node the owner means: the one nearest to the crosshair among those within reach (`looked`), or
 * else the one whose foot they stand at. `distance` is on the ground, to compare with an agent within reach.
 */
export function pickAcademyNode(input: AcademyPickInput): { id: string; distance: number; looked: boolean } | null {
  const { actor, camera, nodes } = input
  if (!actor) return null
  const { reach, lookAngle, touch } = ACADEMY_TREE
  let looked: { id: string; distance: number; dot: number } | null = null
  let touched: { id: string; distance: number } | null = null
  const minDot = Math.cos(lookAngle)
  for (const node of nodes) {
    const distance = Math.hypot(node.position[0] - actor[0], node.position[2] - actor[2])
    if (distance > reach) continue
    if (distance <= touch && (!touched || distance < touched.distance)) touched = { id: node.id, distance }
    if (!camera) continue
    const dx = node.position[0] - camera.position[0]
    const dy = node.position[1] - camera.position[1]
    const dz = node.position[2] - camera.position[2]
    const length = Math.hypot(dx, dy, dz)
    if (length < 0.001) continue
    const dot = (dx * camera.forward[0] + dy * camera.forward[1] + dz * camera.forward[2]) / length
    if (dot >= minDot && (!looked || dot > looked.dot)) looked = { id: node.id, distance, dot }
  }
  if (looked) return { id: looked.id, distance: looked.distance, looked: true }
  return touched ? { ...touched, looked: false } : null
}

// ─── colours ────────────────────────────────────────────────────────────────

/** The film's colour rule: subscriptions gold, API keys blue. */
export const ACADEMY_KEY_COLOR: Record<AcademyKeyKind, string> = {
  subscription: '#fbbf24',
  api: '#3b82f6',
  account: '#cbd5e1',
  hardware: '#c2703d',
}

const LANE_COLOR: Record<string, string> = {
  core: '#a78bfa', ears: '#2dd4bf', voice: '#38bdf8', reach: '#60a5fa', synapse: '#c084fc', initiative: '#fb923c', knows: '#f9a8d4',
  sales: '#facc15', builder: '#34d399', money: '#fbbf24', sally: '#fb7185', creator: '#e879f9', tyler: '#f87171', hands: '#a3e635',
}
const LANE_SPARE = ['#f472b6', '#38bdf8', '#a3e635', '#fb923c', '#e879f9', '#22d3ee']

/** A colour per lane; lanes this file doesn't know get a steady one from the spare list. */
export function academyLaneColor(lane: string): string {
  if (LANE_COLOR[lane]) return LANE_COLOR[lane]
  let hash = 0
  for (let i = 0; i < lane.length; i += 1) hash = (hash * 31 + lane.charCodeAt(i)) >>> 0
  return LANE_SPARE[hash % LANE_SPARE.length]
}

// ─── keys ───────────────────────────────────────────────────────────────────

export type AcademyKeyAction = 'open' | 'close'

export interface AcademyKeyContext {
  code: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  repeat: boolean
  typing: boolean
  readerOpen: boolean
  /** A node is picked. */
  nearby: boolean
  /** An agent is open or within reach: it keeps its keys. */
  agent: boolean
  worldKeysFree: boolean
}

/** E at a node opens it; E or Esc closes it. */
export function academyKeyAction(c: AcademyKeyContext): AcademyKeyAction | null {
  if (c.ctrl || c.meta || c.alt || c.repeat) return null
  if (c.readerOpen) {
    if (c.code === 'Escape') return 'close'
    if (c.code === 'KeyE' && !c.typing) return 'close'
    return null
  }
  if (c.typing || c.agent || !c.nearby || !c.worldKeysFree) return null
  return c.code === 'KeyE' ? 'open' : null
}
