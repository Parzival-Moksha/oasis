import type { SpatialWebObject, SpatialWebObjectType } from './spatial-web'

export interface GoogleFormFieldSpec {
  entryId: string
  label: string
  type: SpatialWebObjectType
  options?: string[]
  min?: number
  max?: number
  step?: number
}

export interface GoogleFormSpatialSpec {
  title: string
  description?: string
  formUrl: string
  responseUrl: string
  fields: GoogleFormFieldSpec[]
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string
  } catch {
    return value
  }
}

function extractGoogleFormsData(html: string): unknown | null {
  const markerIndex = html.indexOf('FB_PUBLIC_LOAD_DATA_')
  if (markerIndex < 0) return null
  const equalsIndex = html.indexOf('=', markerIndex)
  const startIndex = html.indexOf('[', equalsIndex)
  if (equalsIndex < 0 || startIndex < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = startIndex; index < html.length; index += 1) {
    const char = html[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '[') depth += 1
    if (char === ']') depth -= 1
    if (depth === 0) {
      return JSON.parse(html.slice(startIndex, index + 1)) as unknown
    }
  }
  return null
}

function titleFromHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return stripHtml(title || '').replace(/\s*-\s*Google Forms\s*$/i, '') || 'Google Form'
}

function responseUrlFromFormUrl(formUrl: string): string {
  const url = new URL(formUrl)
  url.pathname = url.pathname
    .replace(/\/viewform\/?$/, '/formResponse')
    .replace(/\/edit\/?$/, '/formResponse')
  url.search = ''
  return url.toString()
}

function responseUrlFromHtml(html: string, formUrl: string): string {
  const action = html.match(/<form[^>]+action=["']([^"']*formResponse[^"']*)["']/i)?.[1]
  if (action) {
    try {
      return new URL(action, formUrl).toString()
    } catch {
      // Fall through to URL rewriting.
    }
  }
  return responseUrlFromFormUrl(formUrl)
}

function candidateEntryId(value: unknown): string | null {
  if (typeof value !== 'number') return null
  if (!Number.isInteger(value)) return null
  const text = String(value)
  return text.length >= 6 ? `entry.${text}` : null
}

function collectOptions(node: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 3 || !Array.isArray(node)) return out
  for (const child of node) {
    if (Array.isArray(child)) {
      if (typeof child[0] === 'string' && child[0].trim()) {
        out.push(stripHtml(decodeJsonString(child[0])))
      } else {
        collectOptions(child, depth + 1, out)
      }
    }
  }
  return Array.from(new Set(out)).filter(Boolean)
}

function numericRange(options: string[]): { min: number; max: number; step: number } | null {
  const nums = options.map(option => Number(option)).filter(Number.isFinite)
  if (nums.length < 2 || nums.length !== options.length) return null
  return { min: Math.min(...nums), max: Math.max(...nums), step: 1 }
}

function questionType(googleType: number | null, options: string[]): Pick<GoogleFormFieldSpec, 'type' | 'min' | 'max' | 'step'> {
  if (googleType === 4) return { type: 'multiselect' }
  if (googleType === 5) {
    const range = numericRange(options)
    return { type: 'slider', min: range?.min ?? 0, max: range?.max ?? 10, step: range?.step ?? 1 }
  }
  if (googleType === 2 || googleType === 3 || options.length > 0) return { type: 'select' }
  return { type: 'text' }
}

function extractFieldsFromData(data: unknown): GoogleFormFieldSpec[] {
  const fields: GoogleFormFieldSpec[] = []
  const seen = new Set<string>()

  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return
    const label = typeof node[1] === 'string' ? stripHtml(decodeJsonString(node[1])) : ''
    const googleType = typeof node[3] === 'number' ? node[3] : null
    const entries = Array.isArray(node[4]) ? node[4] : null
    if (label && entries) {
      const firstEntry = entries.find(entry => Array.isArray(entry) && candidateEntryId(entry[0]))
      if (Array.isArray(firstEntry)) {
        const entryId = candidateEntryId(firstEntry[0])
        if (entryId && !seen.has(entryId)) {
          const options = collectOptions(firstEntry[1])
          const typeInfo = questionType(googleType, options)
          fields.push({
            entryId,
            label,
            ...typeInfo,
            ...(options.length > 0 && typeInfo.type !== 'text' ? { options } : {}),
          })
          seen.add(entryId)
        }
      }
    }
    for (const child of node) visit(child)
  }

  visit(data)
  return fields
}

export function parseGoogleFormHtml(html: string, formUrl: string): GoogleFormSpatialSpec {
  const data = extractGoogleFormsData(html)
  const fields = data ? extractFieldsFromData(data) : []
  return {
    title: titleFromHtml(html),
    formUrl,
    responseUrl: responseUrlFromHtml(html, formUrl),
    fields,
  }
}

function initialValue(field: GoogleFormFieldSpec) {
  if (field.type === 'slider') return field.min ?? 0
  if (field.type === 'select') return field.options?.[0] || ''
  if (field.type === 'multiselect') return []
  return ''
}

const JOURNEY_TITLE_Z = -3.15
const JOURNEY_FIRST_FIELD_Z = -5.7
const JOURNEY_FIELD_STEP = -4
const JOURNEY_SIDE_X = 3.05
const JOURNEY_PANEL_Y = 1.18

function fieldPose(index: number): { position: [number, number, number]; rotation: [number, number, number] } {
  const side = index % 2 === 0 ? -1 : 1
  const z = JOURNEY_FIRST_FIELD_Z + index * JOURNEY_FIELD_STEP
  return {
    position: [side * JOURNEY_SIDE_X, JOURNEY_PANEL_Y, z],
    rotation: [0, side < 0 ? 0.62 : -0.62, 0],
  }
}

function submitZ(fieldCount: number): number {
  return JOURNEY_FIRST_FIELD_Z + Math.max(1, fieldCount) * JOURNEY_FIELD_STEP - 1.45
}

function sizeForField(field: GoogleFormFieldSpec): { width: number; height: number; visualStyle: SpatialWebObject['visualStyle'] } {
  if (field.type === 'slider') return { width: 4.6, height: 1.05, visualStyle: 'glass-slider' }
  if (field.type === 'text') return { width: 4.5, height: 1.1, visualStyle: 'terminal-panel' }
  if (field.type === 'multiselect') return { width: 4.35, height: 1.05, visualStyle: 'neon-panel' }
  return { width: 4.05, height: 1.0, visualStyle: 'neon-panel' }
}

export function googleFormSpecToJourneyGroundTiles(spec: Pick<GoogleFormSpatialSpec, 'fields'>): Record<string, string> {
  const tiles: Record<string, string> = {}
  const pathEndZ = Math.floor(submitZ(spec.fields.length) - 2)

  for (let z = pathEndZ; z <= -1; z += 1) {
    for (let x = -1; x <= 1; x += 1) {
      tiles[`${x},${z}`] = 'dirt'
    }
  }

  spec.fields.forEach((_, index) => {
    const { position } = fieldPose(index)
    const centerX = Math.floor(position[0])
    const centerZ = Math.floor(position[2])
    for (let x = centerX - 1; x <= centerX + 1; x += 1) {
      for (let z = centerZ - 1; z <= centerZ; z += 1) {
        tiles[`${x},${z}`] = 'cobble'
      }
    }
  })

  const sendZ = Math.floor(submitZ(spec.fields.length))
  for (let x = -2; x <= 2; x += 1) {
    for (let z = sendZ - 1; z <= sendZ + 1; z += 1) {
      tiles[`${x},${z}`] = 'cobble'
    }
  }

  return tiles
}

export function googleFormSpecToSpatialWebObjects(spec: GoogleFormSpatialSpec, formId: string): SpatialWebObject[] {
  const fieldMap: Record<string, string> = {}
  const objects: SpatialWebObject[] = [
    {
      id: `${formId}-title`,
      type: 'output',
      formId,
      label: spec.title,
      value: spec.description || 'Start here. Walk the path, answer each 3D control, then press submit.',
      position: [0, 2.85, JOURNEY_TITLE_Z],
      rotation: [Math.PI / 6, 0, 0],
      width: 7.2,
      height: 1.35,
      accentColor: '#38bdf8',
      visualStyle: 'terminal-panel',
    },
  ]

  spec.fields.forEach((field, index) => {
    const objectId = `${formId}-field-${index + 1}`
    const pose = fieldPose(index)
    const size = sizeForField(field)
    fieldMap[objectId] = field.entryId
    fieldMap[field.label] = field.entryId
    objects.push({
      id: objectId,
      type: field.type,
      formId,
      label: field.label,
      value: initialValue(field),
      position: pose.position,
      rotation: pose.rotation,
      width: size.width,
      height: size.height,
      accentColor: ['#22c55e', '#f59e0b', '#a78bfa', '#06b6d4', '#f97316'][index % 5],
      visualStyle: size.visualStyle,
      ...(field.options ? { options: field.options.map(option => ({ value: option, label: option })) } : {}),
      ...(field.min !== undefined ? { min: field.min } : {}),
      ...(field.max !== undefined ? { max: field.max } : {}),
      ...(field.step !== undefined ? { step: field.step } : {}),
      ...(field.type === 'text' ? { placeholder: field.label } : {}),
    })
  })

  const sendZ = submitZ(spec.fields.length)
  objects.push(
    {
      id: `${formId}-submit`,
      type: 'button',
      formId,
      label: 'Send',
      description: 'Send this spatial form to Google Forms.',
      position: [0, 0.75, sendZ],
      rotation: [0, 0, 0],
      width: 1.45,
      height: 1.05,
      accentColor: '#fb7185',
      visualStyle: 'portal-zero-button',
      action: {
        type: 'submit_form',
        successMessage: 'Submitted to Google Forms.',
        destination: {
          type: 'google_form',
          formUrl: spec.formUrl,
          responseUrl: spec.responseUrl,
          fieldMap,
        },
      },
    },
    {
      id: `${formId}-receipt`,
      type: 'output',
      formId,
      label: 'Receipt',
      value: 'Waiting for submit.',
      position: [0, 1.3, sendZ - 2.25],
      rotation: [0, 0, 0],
      width: 6.6,
      height: 1.45,
      accentColor: '#34d399',
      visualStyle: 'terminal-panel',
    },
  )

  return objects
}
