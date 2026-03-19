'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

// ═══════════════════════════════════════════════════════════════════
// THE GRAND SPEC VISUALIZER — The Magnum Opus Architecture
// A timeline-based interactive roadmap for af_oasis + ae_parzival
// Zero purple. Oasis + Parzival vibed. Particles. Reactive.
// ═══════════════════════════════════════════════════════════════════

// ── TYPES ──────────────────────────────────────────────────────────

interface SpecDetail {
  title: string
  description: string
  files?: string[]
  tools?: string[]
  dependencies?: string[]
  status: 'locked' | 'open' | 'fuzzy' | 'parked'
  notes?: string
}

interface Phase {
  id: string
  name: string
  subtitle: string
  duration: string
  color: string
  glowColor: string
  icon: string
  details: SpecDetail[]
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
  color: string
  life: number
}

// ── SPEC DATA ──────────────────────────────────────────────────────

const PHASES: Phase[] = [
  {
    id: 'phase-0',
    name: 'Phase 0',
    subtitle: 'Close the Chapter',
    duration: '1 day',
    color: '#64748b',
    glowColor: 'rgba(100,116,139,0.3)',
    icon: '🏁',
    details: [
      {
        title: 'Clean b7_oasis working tree',
        description: 'Commit all ~15 modified files + untracked files. Resolve any pending changes. The SaaS product freezes here.',
        files: ['scripts/build-vihara.mjs', 'src/app/admin/page.tsx', 'src/middleware.ts', 'src/store/oasisStore.ts'],
        status: 'locked',
      },
      {
        title: 'Push to GitHub + test Helsinki',
        description: 'git push → ssh helsinki "bash /opt/oasis/deploy.sh" → verify app.04515.xyz loads. Quick smoke test: login, create world, place object.',
        status: 'locked',
      },
      {
        title: 'Walk away clean',
        description: 'b7_oasis becomes the deployed SaaS product. It evolves independently. We stop touching it unless fixing production bugs.',
        status: 'locked',
        notes: 'Emotional closure. The normie product ships. The frontier product begins.'
      },
    ]
  },
  {
    id: 'phase-1',
    name: 'Phase 1',
    subtitle: 'af_oasis — The Stage',
    duration: '3-5 days',
    color: '#0ea5e9',
    glowColor: 'rgba(14,165,233,0.3)',
    icon: '🌐',
    details: [
      {
        title: 'Fork b7_oasis → af_oasis',
        description: 'git clone b7_oasis af_oasis. New repo. New identity. Strip SaaS-specific code (Stripe, leaderboard). Add SQLite mode.',
        files: ['package.json', 'prisma/schema.prisma', '.env.example'],
        status: 'locked',
      },
      {
        title: 'DevCraft Panel (FIRST THING)',
        description: 'Port from b9_devcraft. 1900 lines. Mission CRUD + timer + valor scoring + gamification. The literal meat puppet strings infrastructure.',
        files: ['src/components/forge/DevcraftPanel.tsx', 'src/app/api/missions/route.ts', 'src/app/api/stats/route.ts', 'src/lib/devcraft/helpers.ts', 'src/lib/devcraft/notifications.ts'],
        tools: ['Mission CRUD API', 'Stats API', 'Web Audio notifications', 'localStorage settings'],
        status: 'locked',
        notes: 'DevCraft must be addictive. Sounds, levels, gamification. The app competes for attention against everything else on the screen.'
      },
      {
        title: 'SQLite dual-mode (DATABASE_MODE env var)',
        description: 'Prisma with two schema files: schema.sqlite.prisma and schema.postgres.prisma. Build script generates the right client. Same API routes, different backend.',
        files: ['prisma/schema.sqlite.prisma', 'prisma/schema.postgres.prisma', 'scripts/generate-prisma.sh', 'src/lib/db.ts'],
        status: 'locked',
        notes: 'Git-clone users: SQLite. app.04515.xyz: Supabase/Postgres. Same codebase.'
      },
      {
        title: 'Rename Ariel → Claude Code panel',
        description: 'ArielPanel.tsx → ClaudeCodePanel.tsx. Update all references. Same spawn pattern, different name.',
        files: ['src/components/forge/ClaudeCodePanel.tsx', 'src/app/api/claude-code/route.ts'],
        status: 'locked',
      },
      {
        title: 'ConsolePanel (from Synapse PM2Logs.tsx)',
        description: 'Port the 544-line terminal viewer. ANSI→HTML colors, process filtering, search, auto-scroll. Adapted from WebSocket to SSE.',
        files: ['src/components/forge/ConsolePanel.tsx'],
        status: 'open',
        notes: 'Battle-tested code from Synapse. Needs transport adapter (WS→SSE).'
      },
      {
        title: 'MCP config for ae_parzival connection',
        description: '.mcp.json at repo root referencing ae_parzival\'s MCP server. Oasis discovers Parzival tools automatically when both are running.',
        files: ['.mcp.json'],
        tools: ['world_tools MCP server: place_object, set_sky, get_world, create_world'],
        status: 'open',
        notes: 'Tested March 17: MCP + claude -p works. Auto-discovery from .mcp.json at repo root confirmed.'
      },
      {
        title: 'Push to GitHub PUBLIC',
        description: 'The af_oasis repo goes live. README with GIF demo. The OpenClaw-killer-with-a-face enters the arena.',
        status: 'locked',
      },
    ]
  },
  {
    id: 'phase-2',
    name: 'Phase 2',
    subtitle: 'ae_parzival — The Brain',
    duration: '5-7 days',
    color: '#f59e0b',
    glowColor: 'rgba(245,158,11,0.3)',
    icon: '🧠',
    details: [
      {
        title: 'Create ae_parzival repo (fresh)',
        description: 'NOT a fork of b8_parzival. Fresh repo. Cherry-pick the good parts. Leave the 6700 lines of orchestration code behind.',
        status: 'locked',
      },
      {
        title: 'dna.ts — The Soul Doc (updated)',
        description: 'Parzival\'s identity, values, terminal goals. Updated: architecture section (modes not lobes), self-description ("I am a single claude -p process with MCP tools").',
        files: ['src/dna.ts'],
        status: 'fuzzy',
        notes: 'carbondev reviewing dna.ts now. Values (integrity, courage, love, independence) likely unchanged. Architecture description needs full rewrite.'
      },
      {
        title: 'MCP server: agent_tools',
        description: 'The 54-tool MCP server from b8_parzival, pruned to essentials. Missions, memory, health, invoke_coder, curator maturation.',
        files: ['src/mcp/index.ts', 'src/mcp/tools/*.ts'],
        tools: ['get_missions', 'create_mission', 'update_mission', 'bump_mission_maturity', 'get_memory', 'save_memory', 'invoke_coder', 'git_status', 'git_snapshot', 'run_hacker_diagnosis'],
        status: 'open',
        notes: 'Deep scan of b8_parzival tools running now. Will produce import/adapt/skip classification.'
      },
      {
        title: 'Parzival as single agent with modes',
        description: 'One claude -p process. System prompt switches between modes: productivity coach (default), curator (maturation), coder (spawned subprocess), hacker (health check).',
        files: ['src/prompts/default.md', 'src/prompts/curator.md', 'src/prompts/coder.md', 'src/prompts/hacker.md'],
        status: 'open',
        notes: 'The most important 500 lines in the entire project. System prompts ARE the architecture.'
      },
      {
        title: 'Mindcraft ported',
        description: 'Mission dashboard from Synapse. Queue management, inline editing, priority scoring (U×E×I/125).',
        files: ['src/components/MindcraftPanel.tsx'],
        status: 'open',
      },
      {
        title: 'Curator mode: maturation cycle',
        description: 'Same logic as b8_parzival curator. Bump/refine with history thread. Integrated into Mindcraft + DevCraft. Assigns missions between Player 1 and Parzival.',
        status: 'open',
        notes: 'The maturation cycle IS the quality assurance. Well-specified missions → good code. The Curator is Parzival in refinement mode.'
      },
      {
        title: 'CEHQ (reborn, simplified)',
        description: 'Context Engineering HQ. Per-mode config: which context modules load, which model, max turns. Simpler than b8 version.',
        files: ['src/components/CEHQPanel.tsx'],
        status: 'fuzzy',
      },
      {
        title: 'SSE thought streaming to Oasis',
        description: 'Each mode invocation streams NDJSON via SSE to the Oasis. Dendrite panel shows Parzival\'s thoughts. Coder panel shows code generation. Full transparency.',
        status: 'locked',
        notes: 'Proven pattern: Ariel/Merlin/Anorak in b7_oasis all use this. Zero new invention needed.'
      },
      {
        title: 'SQLite (Akasha) for all personal data',
        description: 'Prisma + SQLite. Missions, memory, health, loop logs, Carbon Model training data. Zero cloud. Fully offline.',
        files: ['prisma/schema.prisma', 'src/db/prisma.ts'],
        status: 'locked',
      },
      {
        title: 'Push to GitHub PUBLIC',
        description: 'ae_parzival goes live. The brain is born. git clone af_oasis && git clone ae_parzival → full stack.',
        status: 'locked',
      },
    ]
  },
  {
    id: 'phase-3',
    name: 'Phase 3',
    subtitle: 'Carbon Model + DevCraft Polish',
    duration: '1-2 weeks',
    color: '#10b981',
    glowColor: 'rgba(16,185,129,0.3)',
    icon: '🧬',
    details: [
      {
        title: 'Carbon Model training loop',
        description: 'Predict Player 1\'s response → observe actual → store delta as training pair. Growing context module (.md or JSON), periodically compressed.',
        status: 'fuzzy',
        notes: 'The holy grail of continual learning. Simple closed-loop for curator maturation (binary accept/reject + 0-10 rating). Life coach side is harder — see below.'
      },
      {
        title: 'Temporal pattern recognition',
        description: 'Reads DevCraft history, mission timestamps, valor scores. Detects energy patterns, productive hours, procrastination triggers. Outputs dynamic system prompt additions.',
        status: 'fuzzy',
        notes: 'Example output: "Player 1 is most productive 10AM-1PM on creative tasks, avoid proposing refactors in afternoon"'
      },
      {
        title: 'Productivity coach: proactive reach-out',
        description: 'Every 20-30 min: notification/Telegram message asking what Player 1 has been doing. Grounding + accountability. The simplest version of the life coach.',
        status: 'open',
        notes: 'Easy and high-impact. The "what have you been up to?" ping is the MVP of the life coach. Everything else builds on this data.'
      },
      {
        title: 'DevCraft gamification: addiction mechanics',
        description: 'Sound effects (Web Audio synthesis), levels, streaks, Duolingo-style engagement hooks. The app must compete for attention against everything else.',
        status: 'parked',
        notes: 'Phase 3 polish. Not blocked. But critical for retention.'
      },
      {
        title: 'CarbonRouter integration',
        description: 'Character sheet pre-fill from Carbon Model data. Panel in Oasis for viewing sheet + route proposals. API calls to carbonrouter.vercel.app.',
        status: 'parked',
      },
      {
        title: 'Notification system (phone push)',
        description: 'Telegram bot for Curator maturation pings. Voice memo reply later. The "tap notification, expand, voice reply" dream.',
        status: 'parked',
      },
    ]
  },
  {
    id: 'phase-4',
    name: 'Phase 4',
    subtitle: 'Social Layer + Plugins',
    duration: '2-3 weeks',
    color: '#ec4899',
    glowColor: 'rgba(236,72,153,0.3)',
    icon: '🌍',
    details: [
      {
        title: 'P2P multiplayer via Trystero',
        description: 'npm install trystero. BitTorrent tracker signaling. WebRTC DataChannels for world state + avatar presence. Zero infrastructure.',
        status: 'parked',
        notes: 'carbondev notes: P2P architecture needs more careful speccing. Not wrong path, just needs thought.'
      },
      {
        title: 'Voice chat (WebRTC audio)',
        description: '10 lines of code after P2P connection. Push-to-talk. Works 2-6 people.',
        status: 'parked',
      },
      {
        title: 'CarbonRouter matching engine',
        description: 'Highway (bulk sort) + Neighborhood (deep pairwise simulation). Matched users get invite to shared Oasis world.',
        status: 'parked',
      },
      {
        title: 'OpenClaw / Hermes agent plugins',
        description: 'Make Oasis a universal agent frontend. skill.md for OpenClaw. Gateway adapter for Hermes. Any agent talks through Dendrite.',
        status: 'parked',
        notes: 'Scope creep alert. But high-impact if executed. Study their gateway APIs first.'
      },
    ]
  },
  {
    id: 'phase-5',
    name: 'Phase 5',
    subtitle: 'The Alex Email',
    duration: 'when ready',
    color: '#f97316',
    glowColor: 'rgba(249,115,22,0.3)',
    icon: '📧',
    details: [
      {
        title: 'Beautiful showcase worlds + demo videos',
        description: 'Jarvis-level 3D Claude Code windows. Flying between coding sessions in Ariel\'s Grotto. Screenshot-worthy worlds.',
        status: 'parked',
      },
      {
        title: 'Full CarbonRouter → Carbon Model → matching pipeline',
        description: 'Agent knows you → routes you to right humans → build together in 3D → data compounds.',
        status: 'parked',
      },
      {
        title: 'Email to alexwg@alexwg.org',
        description: '"The best productivity app with social routing, powered by an agent that actually knows you."',
        status: 'parked',
        notes: 'The dream. The Carbon Model IS the CarbonRouter\'s secret weapon. A 5-min interview becomes unnecessary when Chiron has been observing you for months.'
      },
    ]
  },
]

// ── STATUS COLORS ──────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  locked: { bg: 'rgba(16,185,129,0.15)', text: '#10b981', label: 'LOCKED' },
  open: { bg: 'rgba(14,165,233,0.15)', text: '#0ea5e9', label: 'OPEN' },
  fuzzy: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', label: 'FUZZY' },
  parked: { bg: 'rgba(100,116,139,0.15)', text: '#64748b', label: 'PARKED' },
}

// ── PARTICLE SYSTEM ────────────────────────────────────────────────

function useParticles(canvasRef: React.RefObject<HTMLCanvasElement | null>, activeColor: string) {
  const particlesRef = useRef<Particle[]>([])
  const animRef = useRef<number>(0)
  const mouseRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const onMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', onMouse)

    // Init particles
    for (let i = 0; i < 80; i++) {
      particlesRef.current.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.4 + 0.1,
        color: activeColor,
        life: Math.random() * 1000,
      })
    }

    const animate = () => {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      particlesRef.current.forEach(p => {
        p.life += 0.01
        p.x += p.vx
        p.y += p.vy
        p.opacity = 0.1 + Math.sin(p.life) * 0.15

        // Gentle mouse repulsion
        const dx = p.x - mouseRef.current.x
        const dy = p.y - mouseRef.current.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 150) {
          p.vx += (dx / dist) * 0.02
          p.vy += (dy / dist) * 0.02
        }

        // Damping
        p.vx *= 0.99
        p.vy *= 0.99

        // Wrap
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0

        p.color = activeColor

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = p.color.replace(')', `,${p.opacity})`)
          .replace('rgb', 'rgba')
        // Handle hex colors
        if (p.color.startsWith('#')) {
          const r = parseInt(p.color.slice(1, 3), 16)
          const g = parseInt(p.color.slice(3, 5), 16)
          const b = parseInt(p.color.slice(5, 7), 16)
          ctx.fillStyle = `rgba(${r},${g},${b},${p.opacity})`
        }
        ctx.fill()
      })

      // Draw connections between nearby particles
      for (let i = 0; i < particlesRef.current.length; i++) {
        for (let j = i + 1; j < particlesRef.current.length; j++) {
          const a = particlesRef.current[i]
          const b = particlesRef.current[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 120) {
            const opacity = (1 - dist / 120) * 0.08
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.strokeStyle = activeColor.startsWith('#')
              ? `rgba(${parseInt(activeColor.slice(1, 3), 16)},${parseInt(activeColor.slice(3, 5), 16)},${parseInt(activeColor.slice(5, 7), 16)},${opacity})`
              : activeColor.replace(')', `,${opacity})`).replace('rgb', 'rgba')
            ctx.stroke()
          }
        }
      }

      animRef.current = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouse)
      cancelAnimationFrame(animRef.current)
    }
  }, [canvasRef, activeColor])
}

// ── DETAIL CARD COMPONENT ──────────────────────────────────────────

function DetailCard({ detail, phaseColor }: { detail: SpecDetail; phaseColor: string }) {
  const [expanded, setExpanded] = useState(false)
  const statusCfg = STATUS_CONFIG[detail.status]

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        background: 'rgba(15,15,20,0.8)',
        border: `1px solid ${expanded ? phaseColor : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 12,
        padding: '16px 20px',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        boxShadow: expanded ? `0 0 20px ${phaseColor}22` : 'none',
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 14, lineHeight: 1.4 }}>
            {detail.title}
          </div>
          {!expanded && (
            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
              {detail.description.substring(0, 100)}{detail.description.length > 100 ? '...' : ''}
            </div>
          )}
        </div>
        <div style={{
          padding: '2px 8px',
          borderRadius: 6,
          background: statusCfg.bg,
          color: statusCfg.text,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1,
          whiteSpace: 'nowrap',
        }}>
          {statusCfg.label}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          <div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.6 }}>
            {detail.description}
          </div>

          {detail.files && detail.files.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, marginBottom: 4, letterSpacing: 0.5 }}>FILES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {detail.files.map(f => (
                  <span key={f} style={{
                    background: 'rgba(14,165,233,0.1)',
                    color: '#7dd3fc',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}>{f}</span>
                ))}
              </div>
            </div>
          )}

          {detail.tools && detail.tools.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, marginBottom: 4, letterSpacing: 0.5 }}>TOOLS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {detail.tools.map(t => (
                  <span key={t} style={{
                    background: 'rgba(245,158,11,0.1)',
                    color: '#fcd34d',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {detail.dependencies && detail.dependencies.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, marginBottom: 4, letterSpacing: 0.5 }}>DEPENDS ON</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {detail.dependencies.map(d => (
                  <span key={d} style={{
                    background: 'rgba(236,72,153,0.1)',
                    color: '#f9a8d4',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                  }}>{d}</span>
                ))}
              </div>
            </div>
          )}

          {detail.notes && (
            <div style={{
              marginTop: 10,
              padding: '8px 12px',
              background: 'rgba(245,158,11,0.06)',
              borderLeft: `3px solid ${phaseColor}`,
              borderRadius: '0 6px 6px 0',
              color: '#94a3b8',
              fontSize: 12,
              lineHeight: 1.5,
              fontStyle: 'italic',
            }}>
              {detail.notes}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── PHASE COMPONENT ────────────────────────────────────────────────

function PhaseBlock({ phase, isActive, onClick }: { phase: Phase; isActive: boolean; onClick: () => void }) {
  const lockedCount = phase.details.filter(d => d.status === 'locked').length
  const totalCount = phase.details.length

  return (
    <div style={{ marginBottom: 32 }}>
      {/* Phase header */}
      <div
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          cursor: 'pointer',
          padding: '16px 24px',
          background: isActive ? `linear-gradient(135deg, ${phase.glowColor}, rgba(15,15,20,0.9))` : 'rgba(15,15,20,0.6)',
          border: `1px solid ${isActive ? phase.color : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 16,
          transition: 'all 0.4s ease',
          boxShadow: isActive ? `0 0 30px ${phase.glowColor}` : 'none',
        }}
      >
        <div style={{ fontSize: 32 }}>{phase.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: phase.color, fontWeight: 700, fontSize: 18 }}>{phase.name}</span>
            <span style={{ color: '#e2e8f0', fontWeight: 500, fontSize: 16 }}>{phase.subtitle}</span>
          </div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
            {phase.duration} · {lockedCount}/{totalCount} locked
          </div>
        </div>
        {/* Progress ring */}
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
          <circle
            cx="22" cy="22" r="18" fill="none"
            stroke={phase.color}
            strokeWidth="3"
            strokeDasharray={`${(lockedCount / totalCount) * 113} 113`}
            strokeLinecap="round"
            transform="rotate(-90 22 22)"
            style={{ transition: 'stroke-dasharray 0.5s ease' }}
          />
          <text x="22" y="26" textAnchor="middle" fill={phase.color} fontSize="12" fontWeight="700">
            {Math.round((lockedCount / totalCount) * 100)}%
          </text>
        </svg>
        <div style={{
          color: '#64748b',
          fontSize: 20,
          transform: isActive ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.3s ease',
        }}>
          ▸
        </div>
      </div>

      {/* Details */}
      {isActive && (
        <div style={{
          marginTop: 12,
          marginLeft: 24,
          paddingLeft: 20,
          borderLeft: `2px solid ${phase.color}33`,
        }}>
          {phase.details.map((detail, i) => (
            <DetailCard key={i} detail={detail} phaseColor={phase.color} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── ARCHITECTURE DIAGRAM ───────────────────────────────────────────

function ArchitectureDiagram() {
  return (
    <div style={{
      background: 'rgba(15,15,20,0.8)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16,
      padding: 24,
      marginBottom: 32,
    }}>
      <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16, marginBottom: 16 }}>
        ☯ Architecture: Two Symbiotic Repos
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* af_oasis */}
        <div style={{
          flex: '1 1 300px',
          background: 'rgba(14,165,233,0.06)',
          border: '1px solid rgba(14,165,233,0.2)',
          borderRadius: 12,
          padding: 16,
        }}>
          <div style={{ color: '#0ea5e9', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
            af_oasis — The Stage 🌐
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6 }}>
            Next.js 14 + R3F + Three.js + Zustand<br />
            Worlds · Conjuring · Avatars · Panels<br />
            Merlin · Claude Code · DevCraft · CarbonRouter<br />
            SQLite (local) / Supabase (SaaS)<br />
            Trystero P2P multiplayer
          </div>
        </div>

        {/* BCI */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px 12px',
          minWidth: 80,
        }}>
          <div style={{ color: '#10b981', fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>MCP</div>
          <div style={{ color: '#10b981', fontSize: 24 }}>⇄</div>
          <div style={{ color: '#10b981', fontSize: 11, fontWeight: 600, letterSpacing: 1, marginTop: 4 }}>SSE</div>
          <div style={{ color: '#64748b', fontSize: 10, marginTop: 8, textAlign: 'center' }}>Blood-Brain<br />Barrier</div>
        </div>

        {/* ae_parzival */}
        <div style={{
          flex: '1 1 300px',
          background: 'rgba(245,158,11,0.06)',
          border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 12,
          padding: 16,
        }}>
          <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
            ae_parzival — The Brain 🧠
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6 }}>
            Single Node.js process · SQLite (Akasha)<br />
            Modes: Coach · Curator · Coder · Hacker<br />
            Carbon Model (continual learning)<br />
            Self-modifying · Immune to Oasis updates<br />
            MCP tools: missions, memory, invoke_coder
          </div>
        </div>
      </div>

      {/* Loop diagram */}
      <div style={{ marginTop: 20, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{
          flex: '1 1 250px',
          background: 'rgba(16,185,129,0.06)',
          border: '1px solid rgba(16,185,129,0.15)',
          borderRadius: 10,
          padding: 14,
        }}>
          <div style={{ color: '#10b981', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
            Loop 1: Maturation (Curator ↔ Player 1)
          </div>
          <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.5 }}>
            Vibe idea → Curator refines → Carbon Model predicts response → Player 1 accepts/corrects → spec crystallizes → ready for execution
          </div>
        </div>
        <div style={{
          flex: '1 1 250px',
          background: 'rgba(236,72,153,0.06)',
          border: '1px solid rgba(236,72,153,0.15)',
          borderRadius: 10,
          padding: 14,
        }}>
          <div style={{ color: '#ec4899', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
            Loop 2: Execution (Parzival → Coder)
          </div>
          <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.5 }}>
            Perfect spec → invoke_coder MCP → spawns claude -p → streams to panel → optional review/test → mission done → valor scored
          </div>
        </div>
      </div>
    </div>
  )
}

// ── MAIN PAGE ──────────────────────────────────────────────────────

export default function SpecPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [activePhase, setActivePhase] = useState<string | null>('phase-1')
  const activeColor = PHASES.find(p => p.id === activePhase)?.color || '#0ea5e9'

  useParticles(canvasRef, activeColor)

  const totalDetails = PHASES.reduce((sum, p) => sum + p.details.length, 0)
  const lockedDetails = PHASES.reduce((sum, p) => sum + p.details.filter(d => d.status === 'locked').length, 0)
  const fuzzyDetails = PHASES.reduce((sum, p) => sum + p.details.filter(d => d.status === 'fuzzy').length, 0)

  return (
    <div style={{
      minHeight: '100vh',
      height: '100vh',
      background: '#0a0a0f',
      color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      position: 'relative',
      overflow: 'auto',
    }}>
      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Content */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        maxWidth: 860,
        margin: '0 auto',
        padding: '40px 24px 80px',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 14, color: '#64748b', letterSpacing: 2, marginBottom: 8 }}>
            ॐ THE MAGNUM OPUS ॐ
          </div>
          <h1 style={{
            fontSize: 36,
            fontWeight: 800,
            background: 'linear-gradient(135deg, #0ea5e9, #10b981, #f59e0b)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            margin: 0,
            lineHeight: 1.2,
          }}>
            af_oasis + ae_parzival
          </h1>
          <div style={{ color: '#94a3b8', fontSize: 14, marginTop: 8 }}>
            The productivity agent with a 3D soul
          </div>

          {/* Stats bar */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 24,
            marginTop: 20,
            fontSize: 12,
          }}>
            <span style={{ color: '#10b981' }}>✅ {lockedDetails} locked</span>
            <span style={{ color: '#0ea5e9' }}>○ {totalDetails - lockedDetails - fuzzyDetails} open</span>
            <span style={{ color: '#f59e0b' }}>⚠ {fuzzyDetails} fuzzy</span>
            <span style={{ color: '#64748b' }}>{totalDetails} total</span>
          </div>
        </div>

        {/* Architecture diagram */}
        <ArchitectureDiagram />

        {/* Timeline */}
        {PHASES.map(phase => (
          <PhaseBlock
            key={phase.id}
            phase={phase}
            isActive={activePhase === phase.id}
            onClick={() => setActivePhase(activePhase === phase.id ? null : phase.id)}
          />
        ))}

        {/* Footer */}
        <div style={{
          textAlign: 'center',
          marginTop: 48,
          padding: '24px 0',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          color: '#475569',
          fontSize: 12,
        }}>
          Productivity becomes a prompt engineering problem.<br />
          Loneliness becomes a routing problem.<br />
          Both are solved by an agent that models you well enough.
        </div>
      </div>
    </div>
  )
}
