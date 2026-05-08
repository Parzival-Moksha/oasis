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

export interface SpatialWebOption {
  value: string
  label: string
  price?: number
}

export interface SpatialWebAction {
  type: 'none' | 'submit_form'
  endpoint?: string
  successMessage?: string
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
  value?: SpatialWebValue
  placeholder?: string
  min?: number
  max?: number
  step?: number
  options?: SpatialWebOption[]
  action?: SpatialWebAction
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
