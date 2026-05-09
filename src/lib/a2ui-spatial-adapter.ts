import { A2uiMessageSchema } from '@a2ui/web_core/v0_9'

import {
  SPATIAL_WEB_DEFAULT_SUBMIT_ENDPOINT,
  type SpatialWebObject,
  type SpatialWebObjectType,
  type SpatialWebValue,
} from './spatial-web'
import type { CatalogPlacement, ObjectBehavior } from './conjure/types'

export const A2UI_V09_BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json'

export type A2UIEnvelope = Record<string, unknown>
export type A2UIComponent = Record<string, unknown> & {
  id?: string
  component?: string
}

export interface A2UISpatialAdapterOptions {
  surfaceId?: string
  origin?: [number, number, number]
  columns?: number
  xGap?: number
  yGap?: number
  submitEndpoint?: string
  defaultAccentColor?: string
}

export interface A2UISpatialAdapterResult {
  surfaceId: string
  rootId: string
  dataModel: unknown
  components: A2UIComponent[]
  spatialWebObjects: SpatialWebObject[]
  catalogPlacements: CatalogPlacement[]
  behaviors: Record<string, ObjectBehavior>
  unsupportedComponents: string[]
  warnings: string[]
}

interface SurfaceState {
  surfaceId: string
  rootId: string
  dataModel: unknown
  components: Map<string, A2UIComponent>
  theme: Record<string, unknown>
}

interface LayoutCursor {
  index: number
}

const DEFAULT_ORIGIN: [number, number, number] = [-4.2, 1.6, -5]
const DEFAULT_COLUMNS = 3
const DEFAULT_X_GAP = 3.25
const DEFAULT_Y_GAP = 1.3

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'component'
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function parseJsonPointer(path: string): string[] {
  if (!path || path === '/') return []
  return path
    .replace(/^\//, '')
    .split('/')
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function getByJsonPointer(data: unknown, path: string): unknown {
  if (!path || path === '/') return data
  let current = data
  for (const part of parseJsonPointer(path)) {
    if (Array.isArray(current)) {
      const index = Number(part)
      current = Number.isInteger(index) ? current[index] : undefined
    } else if (isRecord(current)) {
      current = current[part]
    } else {
      return undefined
    }
  }
  return current
}

function setByJsonPointer(data: unknown, path: string, value: unknown): unknown {
  if (!path || path === '/') return value
  const root: Record<string, unknown> = isRecord(data) ? { ...data } : {}
  const parts = parseJsonPointer(path)
  let current: Record<string, unknown> = root

  parts.forEach((part, index) => {
    const last = index === parts.length - 1
    if (last) {
      current[part] = value
      return
    }
    const next = current[part]
    const clone = isRecord(next) ? { ...next } : {}
    current[part] = clone
    current = clone
  })

  return root
}

function stringifyDynamic(value: unknown, dataModel: unknown): string {
  const resolved = resolveDynamic(value, dataModel)
  if (resolved === null || resolved === undefined) return ''
  if (typeof resolved === 'object') return JSON.stringify(resolved)
  return String(resolved)
}

function resolveDynamic(value: unknown, dataModel: unknown): unknown {
  if (!isRecord(value)) return value

  const path = asString(value.path)
  if (path) return getByJsonPointer(dataModel, path)

  const call = asString(value.call)
  if (call === 'formatString' && isRecord(value.args)) {
    return formatString(stringifyDynamic(value.args.value, dataModel), dataModel)
  }

  if (isRecord(value.args) && 'value' in value.args) {
    return resolveDynamic(value.args.value, dataModel)
  }

  return value
}

function formatString(template: string, dataModel: unknown): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, rawPath: string) => {
    const path = rawPath.trim()
    if (!path || path.includes('(')) return ''
    return stringifyDynamic({ path }, dataModel)
  })
}

function normalizeEnvelope(input: Record<string, unknown>): A2UIEnvelope {
  if (isRecord(input.surfaceUpdate)) {
    const surfaceUpdate = input.surfaceUpdate
    return {
      version: input.version || 'v0.9',
      updateComponents: {
        surfaceId: surfaceUpdate.surfaceId,
        components: surfaceUpdate.components,
      },
    }
  }

  if (isRecord(input.dataModelUpdate)) {
    const dataModelUpdate = input.dataModelUpdate
    return {
      version: input.version || 'v0.9',
      updateDataModel: {
        surfaceId: dataModelUpdate.surfaceId,
        path: dataModelUpdate.path,
        value: dataModelUpdate.value ?? dataModelUpdate.contents,
      },
    }
  }

  if (isRecord(input.beginRendering)) {
    const beginRendering = input.beginRendering
    return {
      version: input.version || 'v0.9',
      createSurface: {
        surfaceId: beginRendering.surfaceId,
        catalogId: A2UI_V09_BASIC_CATALOG_ID,
        theme: beginRendering.styles,
      },
      beginRendering,
    }
  }

  return input
}

function validateCanonicalEnvelope(envelope: A2UIEnvelope): A2UIEnvelope {
  const hasCanonicalPayload = Boolean(
    envelope.createSurface
      || envelope.updateComponents
      || envelope.updateDataModel
      || envelope.deleteSurface,
  )
  if (!hasCanonicalPayload) return envelope
  const parsed = A2uiMessageSchema.safeParse(envelope)
  return parsed.success ? parsed.data as A2UIEnvelope : envelope
}

export function parseA2UIEnvelopes(input: unknown): A2UIEnvelope[] {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return []

    try {
      return parseA2UIEnvelopes(JSON.parse(trimmed))
    } catch {
      return trimmed
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => validateCanonicalEnvelope(normalizeEnvelope(JSON.parse(line) as Record<string, unknown>)))
    }
  }

  if (Array.isArray(input)) {
    return input.flatMap(entry => parseA2UIEnvelopes(entry))
  }

  if (!isRecord(input)) return []

  if (Array.isArray(input.messages)) return parseA2UIEnvelopes(input.messages)
  if (Array.isArray(input.envelopes)) return parseA2UIEnvelopes(input.envelopes)
  if (Array.isArray(input.a2ui)) return parseA2UIEnvelopes(input.a2ui)
  if (typeof input.jsonl === 'string') return parseA2UIEnvelopes(input.jsonl)
  if (input.a2ui) return parseA2UIEnvelopes(input.a2ui)

  return [validateCanonicalEnvelope(normalizeEnvelope(input))]
}

function getEnvelopeSurfaceId(envelope: A2UIEnvelope, fallback: string): string {
  for (const key of ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']) {
    const value = envelope[key]
    if (isRecord(value)) {
      const surfaceId = asString(value.surfaceId)
      if (surfaceId) return surfaceId
    }
  }
  return fallback
}

function buildSurface(envelopes: A2UIEnvelope[], options: A2UISpatialAdapterOptions): SurfaceState {
  const surfaceId = options.surfaceId || envelopes.reduce((found, envelope) => (
    found || getEnvelopeSurfaceId(envelope, '')
  ), '') || 'oasis-a2ui-surface'

  const surface: SurfaceState = {
    surfaceId,
    rootId: 'root',
    dataModel: {},
    components: new Map(),
    theme: {},
  }

  for (const envelope of envelopes) {
    const createSurface = envelope.createSurface
    if (isRecord(createSurface) && getEnvelopeSurfaceId(envelope, surfaceId) === surfaceId) {
      if (isRecord(createSurface.theme)) surface.theme = createSurface.theme
    }

    const beginRendering = envelope.beginRendering
    if (isRecord(beginRendering)) {
      surface.rootId = asString(beginRendering.root, surface.rootId)
    }

    const updateDataModel = envelope.updateDataModel
    if (isRecord(updateDataModel) && getEnvelopeSurfaceId(envelope, surfaceId) === surfaceId) {
      surface.dataModel = setByJsonPointer(
        surface.dataModel,
        asString(updateDataModel.path, '/'),
        'value' in updateDataModel ? updateDataModel.value : {},
      )
    }

    const updateComponents = envelope.updateComponents
    if (isRecord(updateComponents) && getEnvelopeSurfaceId(envelope, surfaceId) === surfaceId && Array.isArray(updateComponents.components)) {
      updateComponents.components.forEach((component, index) => {
        if (!isRecord(component)) return
        const id = asString(component.id, `component-${index}`)
        surface.components.set(id, { ...component, id })
      })
    }
  }

  return surface
}

function childIdsFor(component: A2UIComponent): string[] {
  const ids: string[] = []
  if (typeof component.child === 'string') ids.push(component.child)
  if (typeof component.trigger === 'string') ids.push(component.trigger)
  if (typeof component.content === 'string') ids.push(component.content)
  if (Array.isArray(component.children)) {
    ids.push(...component.children.filter((child): child is string => typeof child === 'string'))
  } else if (isRecord(component.children) && typeof component.children.componentId === 'string') {
    ids.push(component.children.componentId)
  }
  if (Array.isArray(component.tabs)) {
    component.tabs.forEach(tab => {
      if (isRecord(tab) && typeof tab.child === 'string') ids.push(tab.child)
    })
  }
  return ids
}

function findRootId(surface: SurfaceState): string {
  if (surface.components.has(surface.rootId)) return surface.rootId
  if (surface.components.has('root')) return 'root'

  const referenced = new Set<string>()
  surface.components.forEach(component => childIdsFor(component).forEach(id => referenced.add(id)))
  const root = Array.from(surface.components.keys()).find(id => !referenced.has(id))
  return root || Array.from(surface.components.keys())[0] || 'root'
}

function childText(component: A2UIComponent, components: Map<string, A2UIComponent>, dataModel: unknown): string {
  const childId = typeof component.child === 'string' ? component.child : ''
  const child = childId ? components.get(childId) : null
  if (child?.component === 'Text') return stringifyDynamic(child.text, dataModel)
  return ''
}

function normalizeOptions(value: unknown, dataModel: unknown): Array<{ value: string; label: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map((option, index) => {
      if (typeof option === 'string') return { value: option, label: option }
      if (!isRecord(option)) return null
      const stableValue = asString(option.value, `option-${index}`)
      return {
        value: stableValue,
        label: stringifyDynamic(option.label ?? stableValue, dataModel) || stableValue,
      }
    })
    .filter((option): option is { value: string; label: string } => Boolean(option))
}

function spatialPosition(cursor: LayoutCursor, options: Required<Pick<A2UISpatialAdapterOptions, 'columns' | 'xGap' | 'yGap'>>, origin: [number, number, number]): [number, number, number] {
  const column = cursor.index % options.columns
  const row = Math.floor(cursor.index / options.columns)
  cursor.index += 1
  return [
    origin[0] + column * options.xGap,
    origin[1] - row * options.yGap,
    origin[2],
  ]
}

function makeSpatialObject(args: {
  component: A2UIComponent
  type: SpatialWebObjectType
  label: string
  value?: SpatialWebValue
  surfaceId: string
  position: [number, number, number]
  accentColor: string
  options?: Array<{ value: string; label: string }>
  min?: number
  max?: number
  step?: number
  placeholder?: string
  submitEndpoint?: string
  actionName?: string
}): SpatialWebObject {
  const object: SpatialWebObject = {
    id: `a2ui-${safeId(args.surfaceId)}-${safeId(asString(args.component.id, 'component'))}`,
    type: args.type,
    label: args.label || asString(args.component.id, args.type),
    formId: args.surfaceId,
    position: args.position,
    accentColor: args.accentColor,
    ...(args.value !== undefined ? { value: args.value } : {}),
    ...(args.options ? { options: args.options } : {}),
    ...(args.min !== undefined ? { min: args.min } : {}),
    ...(args.max !== undefined ? { max: args.max } : {}),
    ...(args.step !== undefined ? { step: args.step } : {}),
    ...(args.placeholder ? { placeholder: args.placeholder } : {}),
  }

  if (args.type === 'button' && args.actionName) {
    object.action = {
      type: 'submit_form',
      endpoint: args.submitEndpoint || SPATIAL_WEB_DEFAULT_SUBMIT_ENDPOINT,
      successMessage: `${args.actionName} sent.`,
    }
  }

  return object
}

function makeCatalogPlacement(args: {
  component: A2UIComponent
  surfaceId: string
  kind: 'image' | 'icon' | 'video' | 'audio'
  name: string
  url: string
  position: [number, number, number]
  scale?: number
}): CatalogPlacement {
  const id = `a2ui-${safeId(args.surfaceId)}-${args.kind}-${safeId(asString(args.component.id, args.kind))}`
  return {
    id,
    catalogId: `a2ui-${args.kind}`,
    name: args.name || args.kind,
    glbPath: '',
    position: args.position,
    scale: args.scale ?? (args.kind === 'audio' ? 1.15 : args.kind === 'icon' ? 0.72 : 1.8),
    ...(args.kind === 'image' || args.kind === 'icon' ? { imageUrl: args.url, imageFrameStyle: args.kind === 'icon' ? 'thin' : 'hologram' } : {}),
    ...(args.kind === 'video' ? { videoUrl: args.url, imageFrameStyle: 'hologram' } : {}),
    ...(args.kind === 'audio' ? { audioUrl: args.url, audioVolume: 1, audioMaxDistance: 15, audioMuted: false } : {}),
  }
}

function makeAudioBehavior(audioUrl: string): ObjectBehavior {
  return {
    movement: { type: 'static' },
    visible: true,
    audioUrl,
    audioVolume: 1,
    audioMaxDistance: 15,
    audioMuted: false,
    audioState: 'paused',
    audioLoop: false,
  }
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function firstSelected(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function spatialForLeaf(args: {
  component: A2UIComponent
  surface: SurfaceState
  cursor: LayoutCursor
  origin: [number, number, number]
  layout: Required<Pick<A2UISpatialAdapterOptions, 'columns' | 'xGap' | 'yGap'>>
  buttonChildIds: Set<string>
  submitEndpoint: string
  accentColor: string
  catalogPlacements: CatalogPlacement[]
  behaviors: Record<string, ObjectBehavior>
  unsupportedComponents: string[]
  warnings: string[]
}): SpatialWebObject | null {
  const { component, surface } = args
  const kind = asString(component.component)
  if (!kind || args.buttonChildIds.has(asString(component.id))) return null

  const position = spatialPosition(args.cursor, args.layout, args.origin)
  const dataModel = surface.dataModel
  const componentId = asString(component.id, kind)

  switch (kind) {
    case 'Text': {
      const text = stringifyDynamic(component.text, dataModel)
      return makeSpatialObject({
        component,
        type: 'output',
        label: text.slice(0, 44) || componentId,
        value: text,
        surfaceId: surface.surfaceId,
        position,
        accentColor: args.accentColor,
      })
    }
    case 'Button': {
      const label = childText(component, surface.components, dataModel)
        || firstString(component.text, component.label, componentId)
      const action = isRecord(component.action) && isRecord(component.action.event)
        ? asString(component.action.event.name, 'action')
        : isRecord(component.action) && isRecord(component.action.functionCall)
          ? asString(component.action.functionCall.call, 'function')
          : ''
      return makeSpatialObject({
        component,
        type: 'button',
        label,
        value: null,
        surfaceId: surface.surfaceId,
        position,
        accentColor: args.accentColor,
        submitEndpoint: args.submitEndpoint,
        actionName: action || 'submit',
      })
    }
    case 'TextField':
    case 'DateTimeInput': {
      const resolvedValue = stringifyDynamic(component.value, dataModel)
      return makeSpatialObject({
        component,
        type: 'text',
        label: stringifyDynamic(component.label, dataModel) || componentId,
        value: resolvedValue,
        surfaceId: surface.surfaceId,
        position,
        accentColor: args.accentColor,
        placeholder: asString(component.placeholder) || (kind === 'DateTimeInput' ? 'Date/time' : undefined),
      })
    }
    case 'CheckBox': {
      const resolvedValue = resolveDynamic(component.value, dataModel)
      return makeSpatialObject({
        component,
        type: 'toggle',
        label: stringifyDynamic(component.label, dataModel) || componentId,
        value: Boolean(resolvedValue),
        surfaceId: surface.surfaceId,
        position,
        accentColor: args.accentColor,
      })
    }
    case 'ChoicePicker': {
      const options = normalizeOptions(component.options, dataModel) || []
      const selected = resolveDynamic(component.value, dataModel)
      const multiple = component.variant === 'multipleSelection'
      return makeSpatialObject({
        component,
        type: multiple ? 'multiselect' : 'select',
        label: stringifyDynamic(component.label, dataModel) || componentId,
        value: multiple
          ? Array.isArray(selected) ? selected.filter((entry): entry is string => typeof entry === 'string') : []
          : firstSelected(selected) || '',
        surfaceId: surface.surfaceId,
        position,
        accentColor: args.accentColor,
        options,
      })
    }
    case 'Slider': {
      const max = toNumber(component.max, 100)
      const min = toNumber(component.min, 0)
      const resolvedValue = resolveDynamic(component.value, dataModel)
      return makeSpatialObject({
        component,
        type: 'slider',
        label: stringifyDynamic(component.label, dataModel) || componentId,
        value: toNumber(resolvedValue, min),
        surfaceId: surface.surfaceId,
        position,
        accentColor: args.accentColor,
        min,
        max,
        step: 1,
      })
    }
    case 'Divider':
      return makeSpatialObject({
        component,
        type: 'output',
        label: 'Divider',
        value: component.axis === 'vertical' ? '|' : '---',
        surfaceId: surface.surfaceId,
        position,
        accentColor: args.accentColor,
      })
    case 'Image':
    case 'Video':
    case 'AudioPlayer': {
      const url = firstString(
        stringifyDynamic(component.url, dataModel),
        stringifyDynamic(component.src, dataModel),
        stringifyDynamic(component.source, dataModel),
        stringifyDynamic(component.imageUrl, dataModel),
        stringifyDynamic(component.videoUrl, dataModel),
        stringifyDynamic(component.audioUrl, dataModel),
      )
      if (!url) {
        args.warnings.push(`${kind} (${componentId}) did not include a usable URL.`)
        return null
      }
      const mediaKind = kind === 'Image' ? 'image' : kind === 'Video' ? 'video' : 'audio'
      const placement = makeCatalogPlacement({
        component,
        surfaceId: surface.surfaceId,
        kind: mediaKind,
        name: firstString(component.alt, component.label, component.title, componentId),
        url,
        position,
      })
      args.catalogPlacements.push(placement)
      if (mediaKind === 'audio') args.behaviors[placement.id] = makeAudioBehavior(url)
      return null
    }
    case 'Icon': {
      const url = firstString(
        stringifyDynamic(component.url, dataModel),
        stringifyDynamic(component.src, dataModel),
        stringifyDynamic(component.source, dataModel),
      )
      if (url) {
        args.catalogPlacements.push(makeCatalogPlacement({
          component,
          surfaceId: surface.surfaceId,
          kind: 'icon',
          name: firstString(component.alt, component.label, component.name, componentId),
          url,
          position,
        }))
        return null
      }

      const iconName = firstString(component.name, component.icon, component.label, componentId)
      return makeSpatialObject({
        component,
        type: 'output',
        label: iconName,
        value: iconName,
        surfaceId: surface.surfaceId,
        position,
        accentColor: args.accentColor,
      })
    }
    default:
      args.unsupportedComponents.push(kind)
      args.warnings.push(`Unsupported A2UI component "${kind}" (${componentId}).`)
      return null
  }
}

export function materializeA2UIToSpatialWeb(
  input: unknown,
  options: A2UISpatialAdapterOptions = {},
): A2UISpatialAdapterResult {
  const envelopes = parseA2UIEnvelopes(input)
  const surface = buildSurface(envelopes, options)
  surface.rootId = findRootId(surface)

  const origin = options.origin || DEFAULT_ORIGIN
  const layout = {
    columns: options.columns || DEFAULT_COLUMNS,
    xGap: options.xGap || DEFAULT_X_GAP,
    yGap: options.yGap || DEFAULT_Y_GAP,
  }
  const accentColor = options.defaultAccentColor
    || asString(surface.theme.primaryColor, '#38bdf8')
  const submitEndpoint = options.submitEndpoint || SPATIAL_WEB_DEFAULT_SUBMIT_ENDPOINT
  const buttonChildIds = new Set<string>()
  surface.components.forEach(component => {
    if (component.component === 'Button' && typeof component.child === 'string') {
      buttonChildIds.add(component.child)
    }
  })

  const unsupportedComponents: string[] = []
  const warnings: string[] = []
  const spatialWebObjects: SpatialWebObject[] = []
  const catalogPlacements: CatalogPlacement[] = []
  const behaviors: Record<string, ObjectBehavior> = {}
  const visited = new Set<string>()
  const cursor: LayoutCursor = { index: 0 }

  const visit = (id: string): void => {
    if (visited.has(id)) return
    visited.add(id)

    const component = surface.components.get(id)
    if (!component) {
      warnings.push(`Missing referenced A2UI component "${id}".`)
      return
    }

    switch (component.component) {
      case 'Row':
      case 'Column':
      case 'List':
        childIdsFor(component).forEach(visit)
        return
      case 'Card':
        if (typeof component.child === 'string') visit(component.child)
        return
      case 'Tabs':
        if (Array.isArray(component.tabs)) {
          component.tabs.forEach(tab => {
            if (!isRecord(tab)) return
            const title = stringifyDynamic(tab.title, surface.dataModel)
            if (title) {
              spatialWebObjects.push(makeSpatialObject({
                component: { id: `tab-${safeId(title)}`, component: 'Text' },
                type: 'output',
                label: title,
                value: title,
                surfaceId: surface.surfaceId,
                position: spatialPosition(cursor, layout, origin),
                accentColor,
              }))
            }
            if (typeof tab.child === 'string') visit(tab.child)
          })
        }
        return
      case 'Modal':
        unsupportedComponents.push('Modal')
        childIdsFor(component).forEach(visit)
        return
      default: {
        const object = spatialForLeaf({
          component,
          surface,
          cursor,
          origin,
          layout,
          buttonChildIds,
          submitEndpoint,
          accentColor,
          catalogPlacements,
          behaviors,
          unsupportedComponents,
          warnings,
        })
        if (object) spatialWebObjects.push(object)
      }
    }
  }

  visit(surface.rootId)

  if (spatialWebObjects.length === 0) {
    surface.components.forEach(component => visit(asString(component.id)))
  }

  return {
    surfaceId: surface.surfaceId,
    rootId: surface.rootId,
    dataModel: surface.dataModel,
    components: Array.from(surface.components.values()),
    spatialWebObjects,
    catalogPlacements,
    behaviors,
    unsupportedComponents: Array.from(new Set(unsupportedComponents)),
    warnings,
  }
}
