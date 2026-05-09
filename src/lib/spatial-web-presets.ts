import {
  makeSpatialWebId,
  type SpatialWebObject,
  type SpatialWebObjectType,
  type SpatialWebVisualStyle,
} from './spatial-web'

export interface SpatialWebAssetTemplate {
  id: string
  type: SpatialWebObjectType
  label: string
  subtitle: string
  accentColor: string
  visualStyle?: SpatialWebVisualStyle
}

export const SPATIAL_WEB_ASSET_TEMPLATES: SpatialWebAssetTemplate[] = [
  { id: 'button', type: 'button', label: 'Button', subtitle: 'one-click action', accentColor: '#fb7185' },
  { id: 'toggle', type: 'toggle', label: 'Toggle', subtitle: 'yes / no switch', accentColor: '#22c55e' },
  { id: 'slider', type: 'slider', label: 'Slider', subtitle: 'range input', accentColor: '#f59e0b' },
  { id: 'select', type: 'select', label: 'Selector', subtitle: 'single choice', accentColor: '#38bdf8' },
  { id: 'multiselect', type: 'multiselect', label: 'Multi-select', subtitle: 'many choices', accentColor: '#06b6d4' },
  { id: 'text', type: 'text', label: 'Text field', subtitle: 'voice-filled text', accentColor: '#f472b6' },
  { id: 'output', type: 'output', label: 'Output panel', subtitle: 'receipt / response', accentColor: '#34d399' },
  {
    id: 'google-form-altar',
    type: 'text',
    label: 'Forms altar',
    subtitle: 'Google Form to world',
    accentColor: '#22d3ee',
    visualStyle: 'google-form-altar',
  },
]

export function createGoogleFormsAltarObject(overrides: Partial<SpatialWebObject> = {}): SpatialWebObject {
  return {
    id: overrides.id || makeSpatialWebId('spatial-google-form-altar'),
    type: 'text',
    formId: overrides.formId || 'google-forms-altar',
    label: overrides.label || 'Google Forms Altar',
    description: overrides.description || 'Paste a public Google Form link. The altar builds a shareable Oasis world, then opens a portal.',
    value: overrides.value ?? '',
    placeholder: overrides.placeholder || 'https://forms.gle/...',
    position: overrides.position || [0, 1.15, 0],
    rotation: overrides.rotation,
    scale: overrides.scale,
    width: overrides.width ?? 4.8,
    height: overrides.height ?? 1.65,
    accentColor: overrides.accentColor || '#22d3ee',
    visualStyle: 'google-form-altar',
    action: overrides.action || {
      type: 'create_world_from_google_form',
      successMessage: 'Oasis world ready.',
    },
    generatedWorldId: overrides.generatedWorldId,
    generatedWorldUrl: overrides.generatedWorldUrl,
    generatedQrUrl: overrides.generatedQrUrl,
    statusMessage: overrides.statusMessage,
    errorMessage: overrides.errorMessage,
    submittedAt: overrides.submittedAt,
    lastInteractionAt: overrides.lastInteractionAt,
    interactionCount: overrides.interactionCount,
    lastEvent: overrides.lastEvent,
  }
}

export function createPortalZeroGoogleFormsAltar(): SpatialWebObject {
  return createGoogleFormsAltarObject({
    id: 'spatial-google-forms-altar-portal-zero',
    formId: 'portal-zero-google-forms-altar',
    position: [-6.2, 1.2, -4.5],
    rotation: [0, 0.56, 0],
  })
}

export function createSpatialWebObjectFromTemplate(template: SpatialWebAssetTemplate): SpatialWebObject {
  if (template.id === 'google-form-altar') return createGoogleFormsAltarObject()

  const formId = 'spatial-library-demo'
  const base: SpatialWebObject = {
    id: makeSpatialWebId(`spatial-${template.type}`),
    type: template.type,
    formId,
    label: template.label,
    position: [0, 1.15, 0],
    width: template.type === 'output' || template.type === 'text' ? 3 : 2.3,
    height: template.type === 'output' || template.type === 'text' ? 1.05 : 0.82,
    accentColor: template.accentColor,
    ...(template.visualStyle ? { visualStyle: template.visualStyle } : {}),
  }

  return {
    ...base,
    ...(template.type === 'toggle' ? { value: false } : {}),
    ...(template.type === 'slider' ? { value: 50, min: 0, max: 100, step: 10 } : {}),
    ...(template.type === 'select' ? {
      value: 'yes',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'maybe', label: 'Maybe' },
        { value: 'no', label: 'No' },
      ],
    } : {}),
    ...(template.type === 'multiselect' ? {
      value: ['ideas'],
      options: [
        { value: 'coffee', label: 'Coffee' },
        { value: 'snacks', label: 'Snacks' },
        { value: 'ideas', label: 'Ideas' },
      ],
    } : {}),
    ...(template.type === 'text' ? { value: '', placeholder: 'Speak a short answer' } : {}),
    ...(template.type === 'output' ? { value: 'Waiting for input.' } : {}),
    ...(template.type === 'button' ? {
      description: 'Submit this spatial form.',
      action: { type: 'submit_form', successMessage: 'Submitted.' },
    } : {}),
  }
}
