'use client'

// The picture on each main-menu tile, drawn in SVG (no image files). Each has its own palette,
// its own surface pattern and one emblem.

export type MenuTileId = 'mindcraft' | 'skills' | 'keychain' | 'profile' | 'config' | 'help' | 'invite' | 'continue'

export interface MenuTileDef {
  id: MenuTileId
  label: string
  sub: string
  accent: string
}

export const MENU_TILES: MenuTileDef[] = [
  { id: 'mindcraft', label: 'Mindcraft', sub: 'Your days, missions and XP', accent: '#5ef0a8' },
  { id: 'skills', label: 'Skills', sub: "Your agents' skill map (K)", accent: '#ff8ad8' },
  { id: 'keychain', label: 'Keychain', sub: 'The keys your agents hold', accent: '#ffcf5c' },
  { id: 'profile', label: 'Profile', sub: 'Who you are here', accent: '#c59bff' },
  { id: 'config', label: 'Settings', sub: 'Graphics, sound, controls', accent: '#6fe3ff' },
  { id: 'help', label: 'Help', sub: 'Keys, guide, glossary', accent: '#8fb4ff' },
  { id: 'invite', label: 'Invite a friend', sub: 'One paragraph to send', accent: '#ff9d7a' },
  { id: 'continue', label: 'Continue', sub: 'Back to the world', accent: '#ffd66b' },
]

const W = 200
const H = 150

function gearPath(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  let d = ''
  const step = (Math.PI * 2) / teeth
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    const pts: Array<[number, number]> = [
      [inner, a - step * 0.28], [outer, a - step * 0.16], [outer, a + step * 0.16], [inner, a + step * 0.28],
    ]
    for (const [r, ang] of pts) d += `${d ? 'L' : 'M'}${(cx + Math.cos(ang) * r).toFixed(1)} ${(cy + Math.sin(ang) * r).toFixed(1)}`
  }
  return d + 'Z'
}

function Surface({ id, from, to, pattern }: { id: string; from: string; to: string; pattern: React.ReactNode }) {
  return (
    <>
      <defs>
        <linearGradient id={`ogm-bg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <radialGradient id={`ogm-glow-${id}`} cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`ogm-shade-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.62" />
        </linearGradient>
        {pattern}
      </defs>
      <rect width={W} height={H} fill={`url(#ogm-bg-${id})`} />
      <rect width={W} height={H} fill={`url(#ogm-pat-${id})`} />
      <rect width={W} height={H} fill={`url(#ogm-glow-${id})`} />
    </>
  )
}

function Art({ id }: { id: MenuTileId }) {
  switch (id) {
    case 'mindcraft':
      return (
        <>
          <Surface id={id} from="#0c3a2c" to="#04130f" pattern={
            <pattern id={`ogm-pat-${id}`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="14" height="14" fill="none" stroke="#5ef0a8" strokeOpacity="0.09" />
            </pattern>
          } />
          {/* XP bars rising behind the gem */}
          {[0, 1, 2, 3, 4].map(i => (
            <rect key={i} x={26 + i * 32} y={104 - i * 13} width={20} height={46 + i * 13} rx={2} fill="#5ef0a8" opacity={0.1 + i * 0.045} />
          ))}
          {/* the gem */}
          <path d="M100 22L138 50L100 112L62 50Z" fill="#1fbf7c" />
          <path d="M100 22L138 50L100 58Z" fill="#8dffd0" />
          <path d="M100 22L62 50L100 58Z" fill="#4fe6a6" />
          <path d="M62 50L100 58L100 112Z" fill="#17a268" />
          <path d="M138 50L100 58L100 112Z" fill="#0f7f52" />
          <path d="M100 22L138 50L100 112L62 50Z" fill="none" stroke="#d9fff0" strokeOpacity="0.7" strokeWidth="1.2" />
          <path d="M150 26l2.5 7 7 2.5-7 2.5-2.5 7-2.5-7-7-2.5 7-2.5z" fill="#eafff6" opacity="0.9" />
          <path d="M48 78l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z" fill="#eafff6" opacity="0.7" />
        </>
      )
    case 'skills':
      return (
        <>
          <Surface id={id} from="#4a1640" to="#150612" pattern={
            <pattern id={`ogm-pat-${id}`} width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="8" cy="8" r="0.9" fill="#ff8ad8" fillOpacity="0.2" />
            </pattern>
          } />
          {/* a skill tree: a root, its branches, the learned nodes lit and the rest still dark */}
          {[[100, 122, 62, 88], [100, 122, 138, 88], [62, 88, 40, 52], [62, 88, 84, 50], [138, 88, 118, 50], [138, 88, 160, 52], [84, 50, 100, 18], [118, 50, 100, 18]].map(([x1, y1, x2, y2], i) => (
            <path key={i} d={`M${x1} ${y1}L${x2} ${y2}`} stroke="#ff8ad8" strokeOpacity={i < 4 ? 0.75 : 0.3} strokeWidth={i < 4 ? 2.5 : 1.5} strokeDasharray={i < 4 ? undefined : '3 4'} />
          ))}
          {[[100, 122, 1], [62, 88, 1], [138, 88, 1], [40, 52, 1], [84, 50, 1], [118, 50, 0], [160, 52, 0], [100, 18, 0]].map(([x, y, lit], i) => (
            <g key={i}>
              {lit ? <circle cx={x} cy={y} r="13" fill="#ff8ad8" opacity="0.22" /> : null}
              <circle cx={x} cy={y} r="8" fill={lit ? '#ffd1f1' : '#2a0c24'} stroke={lit ? '#fff0fa' : '#ff8ad8'} strokeOpacity={lit ? 0.9 : 0.5} strokeWidth="1.5" />
            </g>
          ))}
          <path d="M100 13l1.6 3.4 3.7.5-2.7 2.6.7 3.7-3.3-1.8-3.3 1.8.7-3.7-2.7-2.6 3.7-.5z" fill="#ff8ad8" opacity="0.8" />
        </>
      )
    case 'keychain':
      return (
        <>
          <Surface id={id} from="#4a3508" to="#150e03" pattern={
            <pattern id={`ogm-pat-${id}`} width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="7" cy="7" r="0.9" fill="#ffcf5c" fillOpacity="0.2" />
            </pattern>
          } />
          {/* a ring with a gold key and a blue one: subscriptions gold, API keys blue */}
          <circle cx="100" cy="30" r="15" fill="none" stroke="#ffcf5c" strokeOpacity="0.55" strokeWidth="2.5" />
          <g transform="rotate(-28 66 84)">
            <circle cx="66" cy="84" r="17" fill="none" stroke="#ffcf5c" strokeWidth="4.5" />
            <circle cx="66" cy="84" r="5" fill="#ffcf5c" opacity="0.5" />
            <path d="M83 84H146M128 84v13M141 84v10" stroke="#ffcf5c" strokeWidth="4.5" strokeLinecap="round" />
          </g>
          <g transform="rotate(22 134 100)">
            <circle cx="134" cy="100" r="13" fill="none" stroke="#6ea8ff" strokeWidth="3.5" />
            <path d="M147 100H178M168 100v9" stroke="#6ea8ff" strokeWidth="3.5" strokeLinecap="round" />
          </g>
        </>
      )
    case 'profile':
      return (
        <>
          <Surface id={id} from="#34205c" to="#100a22" pattern={
            <pattern id={`ogm-pat-${id}`} width="12" height="12" patternUnits="userSpaceOnUse">
              <circle cx="6" cy="6" r="1.1" fill="#c59bff" fillOpacity="0.16" />
            </pattern>
          } />
          <circle cx="100" cy="66" r="50" fill="none" stroke="#c59bff" strokeOpacity="0.5" strokeWidth="1.5" />
          <circle cx="100" cy="66" r="58" fill="none" stroke="#c59bff" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="3 7" />
          <clipPath id="ogm-profile-clip"><circle cx="100" cy="66" r="46" /></clipPath>
          <g clipPath="url(#ogm-profile-clip)">
            <circle cx="100" cy="66" r="46" fill="#22143f" />
            <circle cx="100" cy="52" r="17" fill="#d9c2ff" />
            <path d="M62 118c2-26 18-38 38-38s36 12 38 38z" fill="#b48cf5" />
          </g>
          <path d="M146 28l3 7.6 8.2.6-6.3 5.2 2 8-6.9-4.4-6.9 4.4 2-8-6.3-5.2 8.2-.6z" fill="#ffe27a" />
        </>
      )
    case 'config':
      return (
        <>
          <Surface id={id} from="#12333f" to="#060f16" pattern={
            <pattern id={`ogm-pat-${id}`} width="16" height="16" patternUnits="userSpaceOnUse">
              <path d="M16 0H0V16" fill="none" stroke="#6fe3ff" strokeOpacity="0.1" />
            </pattern>
          } />
          <path d={gearPath(86, 62, 44, 34, 9)} fill="#4cc9e6" />
          <circle cx="86" cy="62" r="15" fill="#0a1d26" />
          <circle cx="86" cy="62" r="15" fill="none" stroke="#c9f6ff" strokeOpacity="0.7" strokeWidth="1.5" />
          <path d={gearPath(142, 96, 22, 16, 7)} fill="#2f93ab" />
          <circle cx="142" cy="96" r="7" fill="#0a1d26" />
          <path d="M136 22H184M136 36H184" stroke="#6fe3ff" strokeOpacity="0.45" strokeWidth="3" strokeLinecap="round" />
          <circle cx="170" cy="22" r="5" fill="#eafcff" />
          <circle cx="148" cy="36" r="5" fill="#eafcff" />
        </>
      )
    case 'help':
      return (
        <>
          <Surface id={id} from="#1b2c5e" to="#080d22" pattern={
            <pattern id={`ogm-pat-${id}`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
              <path d="M0 5H10" stroke="#8fb4ff" strokeOpacity="0.1" />
            </pattern>
          } />
          <circle cx="100" cy="66" r="50" fill="none" stroke="#8fb4ff" strokeOpacity="0.55" strokeWidth="1.5" />
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i / 24) * Math.PI * 2
            const r1 = i % 6 === 0 ? 40 : 45
            return <path key={i} d={`M${(100 + Math.cos(a) * r1).toFixed(1)} ${(66 + Math.sin(a) * r1).toFixed(1)}L${(100 + Math.cos(a) * 50).toFixed(1)} ${(66 + Math.sin(a) * 50).toFixed(1)}`} stroke="#8fb4ff" strokeOpacity={i % 6 === 0 ? 0.9 : 0.4} strokeWidth="1.5" />
          })}
          <path d="M84 52c0-10 7-17 17-17s17 6 17 15c0 8-5 11-10 14-4 3-6 5-6 11" fill="none" stroke="#eef3ff" strokeWidth="8" strokeLinecap="round" />
          <circle cx="102" cy="92" r="5.5" fill="#eef3ff" />
        </>
      )
    case 'invite':
      return (
        <>
          <Surface id={id} from="#5a2434" to="#1c0a14" pattern={
            <pattern id={`ogm-pat-${id}`} width="18" height="18" patternUnits="userSpaceOnUse">
              <path d="M9 4v10M4 9h10" stroke="#ff9d7a" strokeOpacity="0.12" />
            </pattern>
          } />
          {/* a doorway of light, and the plane that carries the invitation */}
          <path d="M132 118V62a26 26 0 0 1 52 0v56z" fill="#ffb38f" opacity="0.2" />
          <path d="M140 118V64a18 18 0 0 1 36 0v54z" fill="#ffd9c4" opacity="0.5" />
          <path d="M132 118V62a26 26 0 0 1 52 0v56" fill="none" stroke="#ffc9ae" strokeWidth="1.5" />
          <path d="M22 96c22-6 38-20 52-36" fill="none" stroke="#ffd9c4" strokeOpacity="0.7" strokeWidth="1.6" strokeDasharray="2 6" strokeLinecap="round" />
          <path d="M70 34l56 18-30 8-6 26-8-22z" fill="#fff1e8" />
          <path d="M70 34l26 26-6 26-8-22z" fill="#ffb38f" />
          <path d="M70 34l56 18-30 8z" fill="#ffe2d2" />
        </>
      )
    case 'continue':
      return (
        <>
          <Surface id={id} from="#5c4310" to="#1a1004" pattern={
            <pattern id={`ogm-pat-${id}`} width="200" height="10" patternUnits="userSpaceOnUse">
              <path d="M0 9.5H200" stroke="#ffd66b" strokeOpacity="0.1" />
            </pattern>
          } />
          <clipPath id="ogm-continue-clip"><rect width={W} height="98" /></clipPath>
          <g clipPath="url(#ogm-continue-clip)">
            <circle cx="100" cy="98" r="54" fill="#ffcf5a" opacity="0.28" />
            <circle cx="100" cy="98" r="40" fill="#ffe08a" opacity="0.5" />
          </g>
          {[-90, -54, -24, 0, 24, 54, 90].map(x => (
            <path key={x} d={`M100 98L${100 + x * 2.4} 150`} stroke="#ffd66b" strokeOpacity="0.35" strokeWidth="1" />
          ))}
          {[106, 118, 136].map(y => <path key={y} d={`M0 ${y}H200`} stroke="#ffd66b" strokeOpacity="0.28" strokeWidth="1" />)}
          <path d="M0 98H200" stroke="#fff0c0" strokeOpacity="0.8" strokeWidth="1.5" />
          <path d="M84 40L126 66L84 92Z" fill="#fff6dc" />
          <path d="M84 40L126 66L84 92Z" fill="none" stroke="#7a5200" strokeOpacity="0.35" strokeWidth="2" strokeLinejoin="round" />
        </>
      )
  }
}

export function GameMenuTileArt({ id }: { id: MenuTileId }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden>
      <Art id={id} />
      <rect width={W} height={H} fill={`url(#ogm-shade-${id})`} />
    </svg>
  )
}
