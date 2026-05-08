export const SPATIAL_WEB_DEFAULT_SUBMIT_ENDPOINT = '/api/hackathon/spatial-submit'

export type SpatialWebObjectType =
  | 'button'
  | 'toggle'
  | 'slider'
  | 'select'
  | 'multiselect'
  | 'text'
  | 'output'

export type SpatialWebValue = string | number | boolean | string[] | null
export type SpatialWebEventName = 'press' | 'change' | 'submit'
export type SpatialWebVisualStyle = 'neon-panel' | 'arcade-button' | 'glass-slider' | 'terminal-panel'

export const SPATIAL_WEB_INTERACTION_RADIUS = 3

export interface SpatialWebOption {
  value: string
  label: string
  price?: number
}

export interface SpatialWebAction {
  type: 'none' | 'submit_form' | 'set_value' | 'spawn_vfx'
  endpoint?: string
  successMessage?: string
  targetObjectId?: string
  value?: SpatialWebValue
}

export interface SpatialWebObject {
  id: string
  type: SpatialWebObjectType
  label: string
  formId?: string
  description?: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number] | number
  width?: number
  height?: number
  accentColor?: string
  visualStyle?: SpatialWebVisualStyle
  value?: SpatialWebValue
  placeholder?: string
  min?: number
  max?: number
  step?: number
  options?: SpatialWebOption[]
  action?: SpatialWebAction
  lastInteractionAt?: string
  interactionCount?: number
  lastEvent?: SpatialWebEventName
  submittedAt?: string
}

export interface SpatialWebSubmissionField {
  id: string
  label: string
  type: SpatialWebObjectType
  value: SpatialWebValue
}

export interface SpatialWebSubmissionPayload {
  formId: string
  submittedAt: string
  fields: SpatialWebSubmissionField[]
}

export function makeSpatialWebId(prefix = 'spatial-web'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function buildSpatialWebSubmission(
  objects: SpatialWebObject[],
  formId: string,
): SpatialWebSubmissionPayload {
  const fields = objects
    .filter(object => object.formId === formId)
    .filter(object => !['button', 'output'].includes(object.type))
    .map(object => ({
      id: object.id,
      label: object.label,
      type: object.type,
      value: object.value ?? null,
    }))

  return {
    formId,
    submittedAt: new Date().toISOString(),
    fields,
  }
}

export function summarizeSpatialWebSubmission(payload: SpatialWebSubmissionPayload): string {
  const summary = payload.fields
    .map(field => {
      const value = Array.isArray(field.value) ? field.value.join(', ') : field.value
      return `${field.label}: ${value ?? 'blank'}`
    })
    .join('\n')
  return summary || 'Submitted.'
}

export function getNextSpatialWebValue(object: Pick<SpatialWebObject, 'type' | 'value' | 'min' | 'max' | 'step' | 'options'>): SpatialWebValue | undefined {
  switch (object.type) {
    case 'toggle':
      return !(object.value === true)
    case 'slider': {
      const min = object.min ?? 0
      const max = object.max ?? 100
      const step = object.step ?? 1
      const current = typeof object.value === 'number' ? object.value : min
      const next = current + step
      return next > max ? min : next
    }
    case 'select': {
      const options = object.options || []
      if (options.length === 0) return undefined
      const current = typeof object.value === 'string' ? object.value : ''
      const currentIndex = options.findIndex(option => option.value === current)
      return options[(currentIndex + 1) % options.length]?.value || options[0].value
    }
    case 'multiselect': {
      const options = object.options || []
      if (options.length === 0) return undefined
      const selected = Array.isArray(object.value)
        ? object.value.filter((value): value is string => typeof value === 'string')
        : []
      if (selected.length >= options.length) return []
      const next = options.find(option => !selected.includes(option.value))
      return next ? [...selected, next.value] : selected
    }
    default:
      return undefined
  }
}

export function resolveSpatialWebObjectPosition(
  object: Pick<SpatialWebObject, 'position'>,
  transform?: { position?: [number, number, number] } | null,
): [number, number, number] {
  return transform?.position || object.position
}

export function findNearestSpatialWebObject(
  objects: SpatialWebObject[],
  actorPosition: [number, number, number] | null | undefined,
  transforms: Record<string, { position?: [number, number, number] } | undefined> = {},
  radius = SPATIAL_WEB_INTERACTION_RADIUS,
): SpatialWebObject | null {
  if (!actorPosition || objects.length === 0) return null
  let nearest: SpatialWebObject | null = null
  let nearestDistanceSq = radius * radius

  for (const object of objects) {
    const position = resolveSpatialWebObjectPosition(object, transforms[object.id])
    const dx = position[0] - actorPosition[0]
    const dy = position[1] - actorPosition[1]
    const dz = position[2] - actorPosition[2]
    const distanceSq = dx * dx + dy * dy + dz * dz
    if (distanceSq <= nearestDistanceSq) {
      nearest = object
      nearestDistanceSq = distanceSq
    }
  }

  return nearest
}
