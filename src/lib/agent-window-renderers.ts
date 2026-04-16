export type AgentWindowRenderMode =
  | 'hybrid-snapdom'
  | 'hybrid-foreign-object'
  | 'live-html'

export const DEFAULT_AGENT_WINDOW_RENDER_MODE: AgentWindowRenderMode = 'live-html'

export const AGENT_WINDOW_RENDERERS: Array<{
  id: AgentWindowRenderMode
  label: string
  shortLabel: string
  description: string
}> = [
  {
    id: 'hybrid-snapdom',
    label: 'Hybrid Snapdom',
    shortLabel: 'snapdom',
    description: 'Fast DOM capture to texture when unfocused, live DOM overlay when focused.',
  },
  {
    id: 'hybrid-foreign-object',
    label: 'Hybrid SVG/FO',
    shortLabel: 'svg-fo',
    description: 'Clone DOM into SVG foreignObject for capture, then use live overlay when focused.',
  },
  {
    id: 'live-html',
    label: 'Live Html',
    shortLabel: 'html',
    description: 'Render the live DOM directly in 3D with no capture stage.',
  },
]

export function resolveAgentWindowRenderMode(renderMode?: string | null): AgentWindowRenderMode {
  if (renderMode === 'hybrid-foreign-object' || renderMode === 'live-html') return renderMode
  return DEFAULT_AGENT_WINDOW_RENDER_MODE
}

export function isHybridAgentWindowRenderMode(renderMode?: string | null): boolean {
  const resolved = resolveAgentWindowRenderMode(renderMode)
  return resolved === 'hybrid-snapdom' || resolved === 'hybrid-foreign-object'
}

export function getAgentWindowRendererMeta(renderMode?: string | null) {
  const resolved = resolveAgentWindowRenderMode(renderMode)
  return AGENT_WINDOW_RENDERERS.find(renderer => renderer.id === resolved) || AGENT_WINDOW_RENDERERS[0]
}
