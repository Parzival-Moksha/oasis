import { readFile, readdir } from 'fs/promises'
import { join } from 'path'

import sharp from 'sharp'

import { AGENT_AVATAR_CATALOG } from '@/lib/agent-avatar-catalog'
import { buildSpeechCoverage, normalizeMorphToken } from '@/lib/lip-sync-lab'

const GALLERY_PREFIX = '/avatars/gallery/'
const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const EMOTION_GROUPS = [
  ['happy', ['happy', 'joy', 'smile', 'fun']],
  ['angry', ['angry', 'mad']],
  ['sad', ['sad', 'sorrow']],
  ['surprised', ['surprise']],
  ['relaxed', ['relaxed', 'calm']],
  ['neutral', ['neutral']],
] as const
const EYE_LOOK_GROUPS = [
  ['blink', ['blink']],
  ['blinkLeft', ['blinkl', 'blinkleft']],
  ['blinkRight', ['blinkr', 'blinkright']],
  ['lookUp', ['lookup']],
  ['lookDown', ['lookdown']],
  ['lookLeft', ['lookleft']],
  ['lookRight', ['lookright']],
  ['wink', ['wink']],
  ['squint', ['squint']],
  ['wide', ['wide', 'surpriseeyes']],
] as const

export interface AvatarAuditRecord {
  id: string
  name: string
  path: string
  file: string
  triangleCount: number
  maxTextureSize: number
  rawMorphTargetCount: number
  expressionCount: number
  speechRig: 'ovr15' | 'vrm5' | 'limited' | 'none'
  ovrCoverage: number
  vrmCoverage: number
  hasEmotionShapes: boolean
  mouthShapeCount: number
  emotionGroupCount: number
  eyeLookGroupCount: number
  faceRigScore: number
  anatomyTags: string[]
  hasInnerMouth: boolean
  hasTeeth: boolean
  hasTongue: boolean
  hasJawBone: boolean
  speechTargetNames: string[]
  expressionNames: string[]
  rawMorphNames: string[]
  detailRankScore: number
  error?: string
}

export interface AvatarAuditSummary {
  generatedAt: string
  avatars: AvatarAuditRecord[]
  rankedByGeometry: string[]
  rankedByFaceRig: string[]
  rankedBySpeechRig: string[]
}

interface ParsedGlb {
  json: Record<string, any>
  bin: Buffer | null
}

let cachedSummary: AvatarAuditSummary | null = null
let pendingSummary: Promise<AvatarAuditSummary> | null = null

export async function getAvatarAuditSummary(): Promise<AvatarAuditSummary> {
  if (cachedSummary) return cachedSummary
  if (pendingSummary) return pendingSummary

  pendingSummary = buildAvatarAuditSummary()
    .then(summary => {
      cachedSummary = summary
      return summary
    })
    .finally(() => {
      pendingSummary = null
    })

  return pendingSummary
}

async function buildAvatarAuditSummary(): Promise<AvatarAuditSummary> {
  const catalogByPath = new Map(
    AGENT_AVATAR_CATALOG
      .filter(entry => entry.path.startsWith(GALLERY_PREFIX) && entry.path.toLowerCase().endsWith('.vrm'))
      .map(entry => [entry.path, entry] as const),
  )
  const galleryDir = join(process.cwd(), 'public', 'avatars', 'gallery')
  const galleryFiles = (await readdir(galleryDir))
    .filter(file => file.toLowerCase().endsWith('.vrm'))
    .sort((left, right) => left.localeCompare(right))

  const galleryAvatars = galleryFiles.map(file => {
    const path = `${GALLERY_PREFIX}${file}`
    const catalogEntry = catalogByPath.get(path)
    return {
      id: catalogEntry?.id || file.replace(/\.vrm$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: catalogEntry?.name || file.replace(/\.vrm$/i, ''),
      path,
    }
  })

  const avatars: AvatarAuditRecord[] = []
  for (const avatar of galleryAvatars) {
    avatars.push(await auditAvatar(avatar))
  }

  const rankedByGeometry = [...avatars]
    .sort(compareGeometry)
    .map(record => record.path)

  const rankedByFaceRig = [...avatars]
    .sort(compareFaceRig)
    .map(record => record.path)

  const rankedBySpeechRig = [...avatars]
    .sort(compareSpeechRig)
    .map(record => record.path)

  return {
    generatedAt: new Date().toISOString(),
    avatars,
    rankedByGeometry,
    rankedByFaceRig,
    rankedBySpeechRig,
  }
}

async function auditAvatar(entry: { id: string; name: string; path: string }): Promise<AvatarAuditRecord> {
  const diskPath = join(process.cwd(), 'public', entry.path.replace(/^\//, ''))
  const fallback: AvatarAuditRecord = {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    file: basenameOf(entry.path),
    triangleCount: 0,
    maxTextureSize: 0,
    rawMorphTargetCount: 0,
    expressionCount: 0,
    speechRig: 'none',
    ovrCoverage: 0,
    vrmCoverage: 0,
    hasEmotionShapes: false,
    mouthShapeCount: 0,
    emotionGroupCount: 0,
    eyeLookGroupCount: 0,
    faceRigScore: 0,
    anatomyTags: [],
    hasInnerMouth: false,
    hasTeeth: false,
    hasTongue: false,
    hasJawBone: false,
    speechTargetNames: [],
    expressionNames: [],
    rawMorphNames: [],
    detailRankScore: 0,
  }

  try {
    const buffer = await readFile(diskPath)
    const { json, bin } = parseGlb(buffer)
    const rawMorphNames = collectRawMorphNames(json)
    const expressionNames = collectExpressionNames(json)
    const sceneNames = collectSceneNames(json)
    const allSpeechNames = [...rawMorphNames, ...expressionNames]
    const coverage = buildSpeechCoverage(allSpeechNames)
    const triangleCount = countTriangles(json)
    const maxTextureSize = await extractMaxTextureSize(json, bin)
    const detailRankScore = maxTextureSize * 1000 + triangleCount
    const mouthShapeCount = Object.values(coverage.byShape).filter(names => names.length > 0).length
    const emotionGroupCount = countNamedGroups(allSpeechNames, EMOTION_GROUPS)
    const eyeLookGroupCount = countNamedGroups(allSpeechNames, EYE_LOOK_GROUPS)
    const anatomy = inspectAnatomy(sceneNames)
    const innerMouthOnlySpeech = anatomy.hasInnerMouth && expressionNames.length === 0 && rawMorphNames.length > 0
    const anatomyTags = innerMouthOnlySpeech
      ? [...anatomy.tags, 'speech hidden inside mouth']
      : anatomy.tags
    const faceRigScore = (
      coverage.ovrCoverage * 12
      + coverage.vrmCoverage * 4
      + mouthShapeCount * 4
      + emotionGroupCount * 5
      + eyeLookGroupCount * 4
      + (anatomy.hasInnerMouth ? 18 : 0)
      + (anatomy.hasTeeth ? 12 : 0)
      + (anatomy.hasTongue ? 10 : 0)
      + (anatomy.hasJawBone ? 6 : 0)
      - (innerMouthOnlySpeech ? 120 : 0)
    )
    const speechTargetNames = Object.values(coverage.byShape)
      .flat()
      .sort((left, right) => left.localeCompare(right))

    return {
      ...fallback,
      triangleCount,
      maxTextureSize,
      rawMorphTargetCount: rawMorphNames.length,
      expressionCount: expressionNames.length,
      speechRig: coverage.speechRig,
      ovrCoverage: coverage.ovrCoverage,
      vrmCoverage: coverage.vrmCoverage,
      hasEmotionShapes: coverage.hasEmotionShapes,
      mouthShapeCount,
      emotionGroupCount,
      eyeLookGroupCount,
      faceRigScore,
      anatomyTags,
      hasInnerMouth: anatomy.hasInnerMouth,
      hasTeeth: anatomy.hasTeeth,
      hasTongue: anatomy.hasTongue,
      hasJawBone: anatomy.hasJawBone,
      speechTargetNames,
      expressionNames,
      rawMorphNames,
      detailRankScore,
    }
  } catch (error) {
    return {
      ...fallback,
      error: error instanceof Error ? error.message : 'Audit failed',
    }
  }
}

function basenameOf(value: string): string {
  const parts = value.split('/').filter(Boolean)
  return parts[parts.length - 1] || value
}

function parseGlb(buffer: Buffer): ParsedGlb {
  if (buffer.length < 20) throw new Error('GLB too small')

  const magic = buffer.readUInt32LE(0)
  if (magic !== GLB_MAGIC) throw new Error('Not a GLB/VRM file')

  let offset = 12
  let jsonChunk: Record<string, any> | null = null
  let binChunk: Buffer | null = null

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    offset += 8
    const chunkData = buffer.subarray(offset, offset + chunkLength)
    offset += chunkLength

    if (chunkType === JSON_CHUNK) {
      jsonChunk = JSON.parse(new TextDecoder().decode(chunkData)) as Record<string, any>
    } else if (chunkType === BIN_CHUNK) {
      binChunk = Buffer.from(chunkData)
    }
  }

  if (!jsonChunk) throw new Error('Missing JSON chunk')

  return { json: jsonChunk, bin: binChunk }
}

function countTriangles(json: Record<string, any>): number {
  let total = 0
  const meshes = Array.isArray(json.meshes) ? json.meshes : []
  const accessors = Array.isArray(json.accessors) ? json.accessors : []

  for (const mesh of meshes) {
    const primitives = Array.isArray(mesh?.primitives) ? mesh.primitives : []
    for (const primitive of primitives) {
      const mode = typeof primitive?.mode === 'number' ? primitive.mode : 4
      if (mode !== 4) continue

      if (typeof primitive?.indices === 'number') {
        const accessor = accessors[primitive.indices]
        total += Math.floor((accessor?.count || 0) / 3)
      } else {
        const positionAccessorIndex = primitive?.attributes?.POSITION
        const accessor = typeof positionAccessorIndex === 'number' ? accessors[positionAccessorIndex] : null
        total += Math.floor((accessor?.count || 0) / 3)
      }
    }
  }

  return total
}

function collectRawMorphNames(json: Record<string, any>): string[] {
  const names = new Set<string>()
  const meshes = Array.isArray(json.meshes) ? json.meshes : []

  for (const mesh of meshes) {
    if (Array.isArray(mesh?.extras?.targetNames)) {
      for (const name of mesh.extras.targetNames) {
        if (typeof name === 'string' && name.trim()) names.add(name.trim())
      }
    }

    const primitives = Array.isArray(mesh?.primitives) ? mesh.primitives : []
    for (const primitive of primitives) {
      if (Array.isArray(primitive?.extras?.targetNames)) {
        for (const name of primitive.extras.targetNames) {
          if (typeof name === 'string' && name.trim()) names.add(name.trim())
        }
      }
    }
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right))
}

function collectExpressionNames(json: Record<string, any>): string[] {
  const names = new Set<string>()
  const extensions = json.extensions || {}

  const legacyGroups = extensions?.VRM?.blendShapeMaster?.blendShapeGroups
  if (Array.isArray(legacyGroups)) {
    for (const group of legacyGroups) {
      const hasBinds = Array.isArray(group?.binds) && group.binds.length > 0
      if (!hasBinds) continue
      if (typeof group?.presetName === 'string' && group.presetName.trim()) {
        names.add(group.presetName.trim())
      }
      if (typeof group?.name === 'string' && group.name.trim()) {
        names.add(group.name.trim())
      }
    }
  }

  const vrmExpressions = extensions?.VRMC_vrm?.expressions
  const presetExpressions = vrmExpressions?.preset || {}
  const customExpressions = vrmExpressions?.custom || {}

  for (const [key, expression] of Object.entries(presetExpressions)) {
    if (!hasRuntimeExpressionBinds(expression)) continue
    if (key.trim()) names.add(key.trim())
  }
  for (const [key, expression] of Object.entries(customExpressions)) {
    if (!hasRuntimeExpressionBinds(expression)) continue
    if (key.trim()) names.add(key.trim())
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right))
}

function hasRuntimeExpressionBinds(expression: any): boolean {
  return (
    Array.isArray(expression?.morphTargetBinds) && expression.morphTargetBinds.length > 0
  ) || (
    Array.isArray(expression?.materialColorBinds) && expression.materialColorBinds.length > 0
  ) || (
    Array.isArray(expression?.textureTransformBinds) && expression.textureTransformBinds.length > 0
  )
}

function collectSceneNames(json: Record<string, any>): string[] {
  const names = new Set<string>()

  const addNames = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (typeof item?.name === 'string' && item.name.trim()) {
        names.add(item.name.trim())
      }
    }
  }

  addNames(json.nodes)
  addNames(json.meshes)

  return Array.from(names).sort((left, right) => left.localeCompare(right))
}

async function extractMaxTextureSize(json: Record<string, any>, bin: Buffer | null): Promise<number> {
  if (!bin) return 0

  const images = Array.isArray(json.images) ? json.images : []
  const bufferViews = Array.isArray(json.bufferViews) ? json.bufferViews : []
  let maxSize = 0

  for (const image of images) {
    try {
      let data: Buffer | null = null

      if (typeof image?.bufferView === 'number') {
        const bufferView = bufferViews[image.bufferView]
        const offset = bufferView?.byteOffset || 0
        const length = bufferView?.byteLength || 0
        if (length > 0) data = bin.subarray(offset, offset + length)
      } else if (typeof image?.uri === 'string' && image.uri.startsWith('data:')) {
        const encoded = image.uri.split(',')[1]
        if (encoded) data = Buffer.from(encoded, 'base64')
      }

      if (!data) continue

      const metadata = await sharp(data).metadata()
      maxSize = Math.max(maxSize, metadata.width || 0, metadata.height || 0)
    } catch {
      // Keep auditing even if one embedded image is malformed.
    }
  }

  return maxSize
}

function countNamedGroups(
  names: string[],
  groups: ReadonlyArray<readonly [string, readonly string[]]>,
): number {
  const normalizedNames = names.map(normalizeMorphToken).filter(Boolean)
  let count = 0

  for (const [, aliases] of groups) {
    if (aliases.some(alias => normalizedNames.some(name => name.includes(alias)))) {
      count += 1
    }
  }

  return count
}

function inspectAnatomy(sceneNames: string[]): {
  tags: string[]
  hasInnerMouth: boolean
  hasTeeth: boolean
  hasTongue: boolean
  hasJawBone: boolean
} {
  const normalizedNames = sceneNames.map(normalizeMorphToken).filter(Boolean)
  const hasInnerMouth = normalizedNames.some(name => name.includes('interiormouth') || name.includes('innermouth'))
  const hasTeeth = normalizedNames.some(name => name.includes('teeth') || name.includes('tooth'))
  const hasTongue = normalizedNames.some(name => name.includes('tongue'))
  const hasJawBone = normalizedNames.some(name => name.includes('jaw'))

  const tags = [
    hasInnerMouth ? 'inner mouth' : null,
    hasTeeth ? 'teeth' : null,
    hasTongue ? 'tongue' : null,
    hasJawBone ? 'jaw' : null,
  ].filter((value): value is string => Boolean(value))

  return {
    tags,
    hasInnerMouth,
    hasTeeth,
    hasTongue,
    hasJawBone,
  }
}

function speechRigRank(value: AvatarAuditRecord['speechRig']): number {
  switch (value) {
    case 'ovr15':
      return 3
    case 'vrm5':
      return 2
    case 'limited':
      return 1
    default:
      return 0
  }
}

function compareFaceRig(left: AvatarAuditRecord, right: AvatarAuditRecord): number {
  return (
    right.faceRigScore - left.faceRigScore
    || right.mouthShapeCount - left.mouthShapeCount
    || right.emotionGroupCount - left.emotionGroupCount
    || right.eyeLookGroupCount - left.eyeLookGroupCount
    || compareGeometry(left, right)
  )
}

function compareGeometry(left: AvatarAuditRecord, right: AvatarAuditRecord): number {
  return (
    right.maxTextureSize - left.maxTextureSize
    || right.triangleCount - left.triangleCount
    || right.rawMorphTargetCount - left.rawMorphTargetCount
    || left.name.localeCompare(right.name)
  )
}

function compareSpeechRig(left: AvatarAuditRecord, right: AvatarAuditRecord): number {
  return (
    speechRigRank(right.speechRig) - speechRigRank(left.speechRig)
    || right.ovrCoverage - left.ovrCoverage
    || compareFaceRig(left, right)
  )
}
