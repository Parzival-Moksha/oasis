import { PORTAL_GATE_VARIANT_DEFS, type PortalGateVariantDef } from './portal-gates'

export const PORTAL_THUMB_DIR = 'portal-thumbs'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function portalThumbPath(id: string): string {
  return `/${PORTAL_THUMB_DIR}/${id}.svg`
}

export function buildPortalThumbnailSvg(def: PortalGateVariantDef): string {
  const safeLabel = escapeXml(def.label)
  const safeId = escapeXml(def.id)
  const uid = def.id.replace(/[^a-z0-9-]/gi, '')
  const { from, via, to } = def.preview
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="${safeLabel} portal">
  <defs>
    <radialGradient id="core-${uid}" cx="50%" cy="45%" r="58%">
      <stop offset="0%" stop-color="${via}" stop-opacity="0.95"/>
      <stop offset="42%" stop-color="${from}" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="${to}" stop-opacity="0.94"/>
    </radialGradient>
    <linearGradient id="rim-${uid}" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="${def.accent}"/>
      <stop offset="48%" stop-color="${via}"/>
      <stop offset="100%" stop-color="${from}"/>
    </linearGradient>
    <filter id="glow-${uid}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="256" height="256" rx="22" fill="#020617"/>
  <circle cx="54" cy="46" r="82" fill="${def.accent}" opacity="0.12"/>
  <circle cx="205" cy="203" r="92" fill="${via}" opacity="0.1"/>
  <ellipse cx="128" cy="126" rx="50" ry="86" fill="url(#core-${uid})" filter="url(#glow-${uid})"/>
  <ellipse cx="128" cy="126" rx="67" ry="98" fill="none" stroke="url(#rim-${uid})" stroke-width="10" filter="url(#glow-${uid})"/>
  <ellipse cx="128" cy="126" rx="43" ry="74" fill="none" stroke="#f8fafc" stroke-width="2" opacity="0.58"/>
  <g opacity="0.8">
    <circle cx="84" cy="61" r="3" fill="#fff"/>
    <circle cx="179" cy="73" r="2" fill="#fff"/>
    <circle cx="67" cy="161" r="2" fill="#fff"/>
    <circle cx="192" cy="160" r="3" fill="#fff"/>
    <circle cx="115" cy="39" r="1.5" fill="#fff"/>
    <circle cx="151" cy="211" r="1.5" fill="#fff"/>
  </g>
  <path d="M78 211c20 13 80 13 101 0" fill="none" stroke="${def.accent}" stroke-width="5" opacity="0.35"/>
  <text x="128" y="232" text-anchor="middle" fill="#dbeafe" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700" letter-spacing="0">${safeLabel}</text>
  <text x="128" y="247" text-anchor="middle" fill="#64748b" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="8" letter-spacing="0">${safeId}</text>
</svg>`
}

export function allPortalThumbnailSvgs(): Array<{ id: string; svg: string }> {
  return PORTAL_GATE_VARIANT_DEFS.map(def => ({
    id: def.id,
    svg: buildPortalThumbnailSvg(def),
  }))
}
