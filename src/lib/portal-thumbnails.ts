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

function portalThumbStars(): string {
  return `<g opacity="0.86">
    <circle cx="48" cy="54" r="2" fill="#fff"/>
    <circle cx="205" cy="49" r="1.6" fill="#fff"/>
    <circle cx="222" cy="139" r="2.4" fill="#fff"/>
    <circle cx="42" cy="165" r="1.8" fill="#fff"/>
    <circle cx="108" cy="31" r="1.4" fill="#fff"/>
    <circle cx="154" cy="220" r="1.7" fill="#fff"/>
    <circle cx="194" cy="206" r="1.2" fill="#fff"/>
  </g>`
}

function portalThumbSmoke(accent: string): string {
  return `<g opacity="0.34" filter="url(#glow-smoke)">
    <ellipse cx="74" cy="192" rx="40" ry="12" fill="${accent}"/>
    <ellipse cx="126" cy="199" rx="58" ry="14" fill="#ffffff" opacity="0.42"/>
    <ellipse cx="180" cy="190" rx="44" ry="12" fill="${accent}"/>
  </g>`
}

function buildPortalThumbnailBody(def: PortalGateVariantDef, uid: string): string {
  const { via, to } = def.preview
  const accent = def.accent

  switch (def.id) {
    case 'void-door':
      return `${portalThumbSmoke(accent)}
  <rect x="82" y="34" width="92" height="166" rx="10" fill="#03020a" stroke="url(#rim-${uid})" stroke-width="10" filter="url(#glow-${uid})"/>
  <rect x="98" y="51" width="60" height="132" rx="6" fill="url(#core-${uid})"/>
  <path d="M111 78c14 15 19 48 5 77M145 65c-14 25-10 61 4 92" fill="none" stroke="${via}" stroke-width="3" opacity="0.55"/>
  ${portalThumbStars()}`
    case 'hologram-gate':
      return `<rect x="62" y="34" width="132" height="164" rx="4" fill="#00191d" stroke="url(#rim-${uid})" stroke-width="5" filter="url(#glow-${uid})"/>
  <g stroke="${accent}" stroke-width="2" opacity="0.72">
    <path d="M82 55h92M82 91h92M82 127h92M82 163h92"/>
    <path d="M93 43v145M128 43v145M163 43v145"/>
  </g>
  <polygon points="128,58 164,118 128,178 92,118" fill="url(#core-${uid})" opacity="0.7"/>
  ${portalThumbStars()}`
    case 'solar-arch':
      return `${portalThumbSmoke(accent)}
  <g filter="url(#glow-${uid})">
    ${Array.from({ length: 15 }, (_, index) => {
      const angle = -160 + index * 23
      return `<rect x="124" y="18" width="8" height="${index % 2 ? 42 : 58}" rx="4" fill="${index % 2 ? via : accent}" transform="rotate(${angle} 128 130)" opacity="0.75"/>`
    }).join('')}
  </g>
  <ellipse cx="128" cy="124" rx="54" ry="84" fill="url(#core-${uid})"/>
  <ellipse cx="128" cy="124" rx="70" ry="101" fill="none" stroke="url(#rim-${uid})" stroke-width="13" filter="url(#glow-${uid})"/>
  <path d="M70 199c32 18 84 18 116 0" fill="none" stroke="${via}" stroke-width="6" opacity="0.5"/>
  ${portalThumbStars()}`
    case 'rift-slit':
      return `${portalThumbSmoke(accent)}
  <path d="M126 29c-20 30 16 48-4 74s15 45-8 71c22-10 13-37 31-60s-15-46 13-85c-22 11-16 30-32 0z" fill="url(#core-${uid})" filter="url(#glow-${uid})"/>
  <path d="M107 42l39 42-25 29 35 51-53 41" fill="none" stroke="${accent}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow-${uid})"/>
  <path d="M139 46l-22 50 30 34-24 61" fill="none" stroke="${via}" stroke-width="3" stroke-linecap="round"/>
  ${portalThumbStars()}`
    case 'stargate-vortex':
      return `${portalThumbSmoke(accent)}
  <circle cx="128" cy="126" r="72" fill="url(#core-${uid})" filter="url(#glow-${uid})"/>
  <circle cx="128" cy="126" r="88" fill="none" stroke="url(#rim-${uid})" stroke-width="15" filter="url(#glow-${uid})"/>
  <g fill="${via}" opacity="0.72">
    ${Array.from({ length: 24 }, (_, index) => {
      const angle = index * 15
      return `<rect x="125" y="30" width="6" height="17" rx="2" transform="rotate(${angle} 128 126)"/>`
    }).join('')}
  </g>
  <path d="M83 126c18-36 72-36 90 0-18 36-72 36-90 0z" fill="none" stroke="#fff" stroke-width="3" opacity="0.5"/>
  ${portalThumbStars()}`
    case 'crystal-cavern':
      return `${portalThumbSmoke(accent)}
  <ellipse cx="128" cy="126" rx="48" ry="86" fill="url(#core-${uid})" filter="url(#glow-${uid})"/>
  ${Array.from({ length: 13 }, (_, index) => {
    const side = index % 2 ? 1 : -1
    const x = 128 + side * (54 + (index % 3) * 13)
    const y = 46 + index * 12
    const color = index % 2 ? via : accent
    return `<polygon points="${x},${y - 18} ${x + side * 18},${y + 4} ${x},${y + 24} ${x - side * 14},${y + 3}" fill="${color}" opacity="0.82" filter="url(#glow-${uid})"/>`
  }).join('')}
  <ellipse cx="128" cy="126" rx="67" ry="98" fill="none" stroke="url(#rim-${uid})" stroke-width="6" opacity="0.8"/>
  ${portalThumbStars()}`
    case 'verdant-arch':
      return `${portalThumbSmoke(accent)}
  <ellipse cx="128" cy="126" rx="48" ry="82" fill="url(#core-${uid})"/>
  <path d="M70 199c-4-86 21-145 58-156 36 11 62 70 58 156" fill="none" stroke="#36533b" stroke-width="16" stroke-linecap="round"/>
  <path d="M78 193c2-69 22-122 50-137 28 15 48 68 50 137" fill="none" stroke="${accent}" stroke-width="5" opacity="0.78" filter="url(#glow-${uid})"/>
  ${Array.from({ length: 16 }, (_, index) => {
    const x = index % 2 ? 80 + (index % 4) * 8 : 176 - (index % 4) * 8
    const y = 55 + index * 8
    const rot = index % 2 ? -28 : 28
    return `<ellipse cx="${x}" cy="${y}" rx="14" ry="6" fill="${index % 3 ? via : accent}" transform="rotate(${rot} ${x} ${y})" opacity="0.78"/>`
  }).join('')}
  ${portalThumbStars()}`
    case 'mirror-pool':
      return `${portalThumbSmoke(accent)}
  <ellipse cx="128" cy="125" rx="51" ry="90" fill="url(#core-${uid})" filter="url(#glow-${uid})"/>
  <ellipse cx="128" cy="125" rx="68" ry="103" fill="none" stroke="url(#rim-${uid})" stroke-width="8"/>
  <path d="M90 97c24-18 51-18 76 0M86 126c31 17 55 17 84 0M96 156c21 13 43 13 64 0" fill="none" stroke="#fff" stroke-width="4" opacity="0.58"/>
  <ellipse cx="128" cy="199" rx="62" ry="18" fill="${accent}" opacity="0.24"/>
  ${portalThumbStars()}`
    case 'clockwork-iris':
      return `<circle cx="128" cy="126" r="63" fill="url(#core-${uid})" filter="url(#glow-${uid})"/>
  <circle cx="128" cy="126" r="82" fill="none" stroke="url(#rim-${uid})" stroke-width="12"/>
  <g fill="${accent}">
    ${Array.from({ length: 28 }, (_, index) => {
      const angle = index * (360 / 28)
      return `<rect x="124" y="30" width="8" height="20" rx="2" transform="rotate(${angle} 128 126)" opacity="${index % 2 ? 0.52 : 0.86}"/>`
    }).join('')}
  </g>
  <g fill="${to}" opacity="0.78">
    ${Array.from({ length: 7 }, (_, index) => {
      const angle = index * (360 / 7)
      return `<path d="M128 126l45-12-12 51z" transform="rotate(${angle} 128 126)"/>`
    }).join('')}
  </g>
  ${portalThumbStars()}`
    default:
      return `${portalThumbSmoke(accent)}
  <ellipse cx="128" cy="126" rx="50" ry="86" fill="url(#core-${uid})" filter="url(#glow-${uid})"/>
  <ellipse cx="128" cy="126" rx="67" ry="98" fill="none" stroke="url(#rim-${uid})" stroke-width="10" filter="url(#glow-${uid})"/>
  <ellipse cx="128" cy="126" rx="43" ry="74" fill="none" stroke="#f8fafc" stroke-width="2" opacity="0.58"/>
  <g fill="${via}" opacity="0.72">
    ${Array.from({ length: 18 }, (_, index) => {
      const angle = index * 20
      return `<rect x="125" y="36" width="6" height="16" rx="2" transform="rotate(${angle} 128 126)"/>`
    }).join('')}
  </g>
  ${portalThumbStars()}`
  }
}

export function buildPortalThumbnailSvg(def: PortalGateVariantDef): string {
  const safeLabel = escapeXml(def.label)
  const safeId = escapeXml(def.id)
  const uid = def.id.replace(/[^a-z0-9-]/gi, '')
  const { from, via, to } = def.preview
  const body = buildPortalThumbnailBody(def, uid)
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
    <filter id="glow-smoke" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
  </defs>
  <rect width="256" height="256" rx="22" fill="#020617"/>
  <circle cx="54" cy="46" r="82" fill="${def.accent}" opacity="0.12"/>
  <circle cx="205" cy="203" r="92" fill="${via}" opacity="0.1"/>
  ${body}
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
