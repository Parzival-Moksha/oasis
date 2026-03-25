'use client'

import { useState, useRef, useEffect } from 'react'

// ═══════════════════════════════════════════════════════════════════
// THE GRAND SPEC VISUALIZER v2 — Shipped features, checkmarks, VFX
// Updated to reflect actual oasisspec3.txt state, March 2026
// ═══════════════════════════════════════════════════════════════════

// ── TYPES ──────────────────────────────────────────────────────────

type Status = 'shipped' | 'active' | 'planned' | 'parked'

interface SpecDetail {
  title: string
  description: string
  files?: string[]
  tools?: string[]
  status: Status
  notes?: string
}

interface Phase {
  id: string
  name: string
  subtitle: string
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
    color: '#10b981',
    glowColor: 'rgba(16,185,129,0.3)',
    icon: '🏁',
    details: [
      { title: 'SaaS purge (auth, NextAuth, login, Stripe)', description: 'Stripped all SaaS-specific code. No auth, no OAuth, no sessions, no login page. Local-first, admin-free.', status: 'shipped' },
      { title: 'FPS → Noclip rename', description: 'Renamed FPS mode to Noclip (Quake-style fly mode). WASD + mouse look, no gravity, no collision.', status: 'shipped' },
      { title: 'CLAUDE.md rewritten', description: 'Complete rewrite of the project spec file. Architecture overview, agent systems, gotchas, code standards.', status: 'shipped' },
      { title: 'Ariel → Anorak rename', description: 'Full rename of the feedback portal agent. UI, API routes, store references all updated.', status: 'shipped' },
      { title: 'Old 🔮 button + World Chat nuked', description: 'Removed legacy UI elements that no longer served the local-first architecture.', status: 'shipped' },
      { title: '/api/pricing stub + Profile/XP routes stubbed', description: 'API stubs ready for future gamification and monetization layers.', status: 'shipped' },
    ]
  },
  {
    id: 'phase-1',
    name: 'Phase 1',
    subtitle: 'Ship or Die',
    color: '#0ea5e9',
    glowColor: 'rgba(14,165,233,0.3)',
    icon: '🌐',
    details: [
      // ── Input & Camera ──
      { title: 'InputManager (7 states, pointer lock, capabilities)', description: 'Unified input state machine: Orbit, Noclip, ThirdPerson, AgentFocus, Placement, Paint, UIFocused. One dispatcher routing all events.', status: 'shipped' },
      { title: 'EventBus (22 commands, 28 dispatches)', description: 'Global event system for decoupled communication between components. Type-safe, zero-dependency.', status: 'shipped' },
      { title: 'CameraController (ONE useFrame)', description: 'Single animation frame loop for all camera modes. Orbit, noclip, third-person, agent focus — all driven by one controller.', status: 'shipped' },
      { title: 'AnimationController (idle/walk/run FSM)', description: 'Finite state machine for avatar animations. Smooth blending between idle, walk, run states.', status: 'shipped' },
      { title: 'Mode switch VFX label + orbit sphere restored', description: 'Visual feedback when switching camera modes. Orbit guide sphere re-enabled.', status: 'shipped' },
      { title: 'Paint/placement → InputManager transitions', description: 'Painting and object placement now properly route through the input state machine.', status: 'shipped' },
      { title: 'Object selection routing through InputManager', description: 'Selection broken in TPS mode. Needs InputManager integration.', status: 'planned' },
      // ── 3D Agent Windows ──
      { title: 'Independent 3D sessions (each window fresh)', description: 'Each 3D agent window gets its own session context. No cross-contamination between windows.', status: 'shipped' },
      { title: '3D window session selector + new with remount', description: 'Header dropdown to pick/create sessions on 3D agent windows. +new button with proper component remount.', status: 'shipped' },
      { title: '3D windows respect global opacity', description: 'Agent window backgrounds honor the global opacity slider from settings.', status: 'shipped' },
      { title: '3D agent window picture frames (4 styles)', description: 'Shared frame system between catalog images and agent windows. Wood, metal, ornate, minimal.', status: 'shipped' },
      { title: 'Agent windows in Joystick', description: 'ObjectInspector shows frame picker, session info, type badge for agent windows.', status: 'shipped' },
      { title: 'Focus glow z-depth fix', description: 'Frame z-fight prevention. Focus glow renders at correct depth.', status: 'shipped' },
      { title: 'Cursor control in zoomon mode', description: 'Pointer unlocked, mouse is standard 2D cursor when focused on a 3D agent window.', status: 'shipped' },
      { title: 'Transform gizmo + HUD hidden in zoomon', description: 'TransformControls, selection ring, and status bar hidden when in agent-focus mode.', status: 'shipped' },
      { title: 'Frame alignment fix (legacy defaults)', description: 'Legacy windows without width/height/scale now default to 800/600/1, fixing NaN frame dimensions.', status: 'shipped' },
      { title: 'Frame thickness slider', description: 'User-controllable frame thickness (0.2x-3x) in Joystick panel.', status: 'shipped' },
      { title: 'Per-window opacity + blur', description: 'Independent opacity (dim to black) and blur sliders for each 3D agent window.', status: 'shipped' },
      { title: 'Window resize handle', description: 'Bottom-right corner drag to resize 3D agent windows (400-1600 x 300-1200px).', status: 'shipped' },
      { title: 'Panel z-ordering (window manager)', description: 'Last-clicked panel gets highest z-index. Works across Wizard, Inspector, Anorak, Parzival.', status: 'shipped' },
      { title: 'Parzival window cleanup', description: 'HP bar + coach/brain emoji removed, inline markdown renderer, turquoise accent.', status: 'shipped' },
      { title: 'Purple color purge', description: 'All purple colors replaced: Opus=amber, Merlin=amber, Parzival=turquoise, neon/void frames=sky-blue, ObjectInspector fuchsia→sky.', status: 'shipped' },
      { title: 'Avatar TPS cannot interact with 3D windows', description: 'Pointer lock captures clicks. Needs center-screen raycast from crosshair.', status: 'planned' },
      { title: 'Window occlusion (occlude="blending")', description: 'Depth-based blending for 3D Html windows behind world objects.', status: 'shipped' },
      { title: '3D window flicker during streaming', description: 'Memoized Html style object prevents drei CSS transform recalculation on child re-renders.', status: 'shipped' },
      { title: 'Extract frame components (FrameComponents.tsx)', description: 'Broke circular import. Neon+void frames purged of purple.', status: 'shipped' },
      // ── Audio ──
      { title: 'AudioManager (20 events, 102 sounds, per-event UI)', description: 'Centralized audio system. Web Audio API. Per-event sound selection in settings. Kenney UI sounds.', status: 'shipped' },
      // ── Testing ──
      { title: 'Visual QA MCP (Parzival\'s Eyes)', description: 'Playwright + Claude Vision + @playwright/mcp. Automated visual regression testing.', status: 'shipped' },
      { title: 'Playwright test suite (38/38)', description: 'Full end-to-end visual/navigation test suite. All passing.', status: 'shipped' },
      { title: 'Vitest unit tests (28/28)', description: 'Component and utility unit tests. All passing.', status: 'shipped' },
      // ── UI ──
      { title: 'Anorak unification (AnorakContent.tsx)', description: 'Merged feedback portal and vibecode chat into unified component with react-markdown streaming.', status: 'shipped' },
      { title: 'react-markdown → hand-built renderer', description: 'Replaced react-markdown with custom streaming-optimized markdown renderer.', status: 'shipped' },
      { title: 'Space = slow, DevCraft button, grid toggle, TPS crosshair', description: 'Quality-of-life: spacebar for slow movement, top-bar DevCraft access, grid visibility toggle, third-person crosshair.', status: 'shipped' },
      { title: 'Placed tab grouping', description: 'Organized placed objects into categories: Conjured, Catalog, Crafted, Lights, Agents.', status: 'shipped' },
      { title: 'Action Log z-index fixed', description: 'Action log no longer renders behind other UI elements.', status: 'shipped' },
      { title: 'Help panel rewritten for af_oasis', description: 'Complete rewrite of help documentation for the local-first version.', status: 'shipped' },
      { title: 'Reasoning effort slider', description: 'Slider next to model selector for adjusting LLM reasoning effort.', status: 'planned' },
      // ── Terrain ──
      { title: 'Terrain Brush (applyBrush, TerrainBrushTool, UI)', description: 'DIY terrain painting. Start with flat virgin world. Brush tool in WizardConsole with undo/redo.', status: 'planned' },
      // ── Profile & XP ──
      { title: 'Profile data to Prisma/SQLite', description: 'Move profile storage from Supabase to local SQLite.', status: 'planned' },
      { title: 'Profile menu (avatar, display name, XP/level)', description: 'User-facing profile UI with gamification elements.', status: 'planned' },
      { title: 'XP system (conjure/craft/place/mission_complete)', description: 'Experience points for all creative actions.', status: 'planned' },
      { title: 'Onboarding quest chain', description: 'Guided tutorial introducing core mechanics.', status: 'planned' },
      // ── Console ──
      { title: 'ConsolePanel (PM2Logs port from Synapse)', description: 'ANSI→HTML terminal viewer. Process filtering, search, auto-scroll. Live streaming pnpm dev output.', status: 'planned' },
    ]
  },
  {
    id: 'phase-1b',
    name: 'Phase 1b',
    subtitle: 'DevCraft Perfection',
    color: '#14b8a6',
    glowColor: 'rgba(20,184,166,0.3)',
    icon: '⚡',
    details: [
      { title: 'BEEP EVERY recurring timer', description: 'Recurring beep every N minutes. First beep = TIME\'S UP + auto-pause. Web Audio synthesis.', status: 'shipped' },
      { title: 'Score → Punya (☸) full UI sweep', description: 'Renamed scoring system to Punya with Buddhist wheel symbol throughout all UI.', status: 'shipped' },
      { title: 'Number inputs typeable (hidden spinners)', description: 'All number inputs are now directly typeable with hidden browser spinners and select-on-focus.', status: 'shipped' },
      { title: 'Valor slider in TIME\'S UP mode', description: 'Valor scoring slider remains visible and usable when timer has expired.', status: 'shipped' },
      { title: 'Chart full vertical space', description: 'DevCraft analytics chart now uses all available vertical space in its container.', status: 'shipped' },
      { title: 'DevCraft notification sounds → AudioManager', description: 'Notification sounds wired through centralized AudioManager. Kenney UI sounds selectable.', status: 'shipped' },
      { title: 'Mission list column resize', description: 'Draggable name↔data border for resizing mission list columns.', status: 'shipped' },
      { title: 'Chart tooltip on hover (punya breakdown)', description: 'Hovering chart data points shows detailed punya score breakdown.', status: 'shipped' },
    ]
  },
  {
    id: 'phase-2',
    name: 'Phase 2',
    subtitle: 'Multiplayer + Agents',
    color: '#f59e0b',
    glowColor: 'rgba(245,158,11,0.3)',
    icon: '🧠',
    details: [
      { title: 'Parzival brain integration (molt 4)', description: 'Full Parzival agent integration into the Oasis. Single claude -p process with MCP tools. Streaming thoughts to panel.', status: 'shipped' },
      { title: 'Agent integration template (AGENT_INTEGRATION.md)', description: 'Documentation template for integrating external agents into the Oasis.', status: 'planned' },
      { title: 'P2P multiplayer via Trystero/torrent', description: 'BitTorrent tracker signaling. WebRTC DataChannels for world state + avatar presence. Zero infrastructure.', status: 'parked' },
      { title: 'Voice chat (WebRTC audio)', description: 'Push-to-talk voice chat. Works 2-6 people. Builds on P2P connection.', status: 'parked' },
      { title: 'OpenClaw + Hermes Agent support', description: 'Universal agent frontend. skill.md for OpenClaw, gateway adapter for Hermes.', status: 'parked' },
      { title: 'CarbonRouter integration as Oasis panel', description: 'Character sheet pre-fill from Carbon Model. Panel for viewing sheet + route proposals.', status: 'parked' },
    ]
  },
  {
    id: 'phase-3',
    name: 'Phase 3',
    subtitle: 'Carbon Model + Polish',
    color: '#10b981',
    glowColor: 'rgba(16,185,129,0.3)',
    icon: '🧬',
    details: [
      { title: 'Carbon Model training loop', description: 'Predict Player 1\'s response → observe actual → store delta. Growing context module, periodically compressed.', status: 'parked', notes: 'The holy grail of continual learning.' },
      { title: 'Temporal pattern recognition', description: 'Reads DevCraft history, detects energy patterns, productive hours, procrastination triggers.', status: 'parked' },
      { title: 'Productivity coach: proactive reach-out', description: 'Every 20-30 min: notification asking what Player 1 has been doing. Grounding + accountability.', status: 'parked' },
      { title: 'Notification system (Telegram push)', description: 'Telegram bot for pings. Voice memo reply. The "tap, expand, voice reply" dream.', status: 'parked' },
    ]
  },
  {
    id: 'phase-4',
    name: 'Phase 4',
    subtitle: 'Social Layer + Plugins',
    color: '#ec4899',
    glowColor: 'rgba(236,72,153,0.3)',
    icon: '🌍',
    details: [
      { title: 'CarbonRouter matching engine', description: 'Highway (bulk sort) + Neighborhood (deep pairwise simulation). Matched users get invite to shared Oasis world.', status: 'parked' },
      { title: 'OpenClaw / Hermes agent plugins', description: 'Universal agent frontend. Any agent talks through the 3D interface.', status: 'parked' },
    ]
  },
  {
    id: 'phase-5',
    name: 'Phase 5',
    subtitle: 'The Alex Email',
    color: '#f97316',
    glowColor: 'rgba(249,115,22,0.3)',
    icon: '📧',
    details: [
      { title: 'Beautiful showcase worlds + demo videos', description: 'Jarvis-level 3D Claude Code windows. Flying between coding sessions. Screenshot-worthy worlds.', status: 'parked' },
      { title: 'Full Carbon Model → matching pipeline', description: 'Agent knows you → routes you to right humans → build together in 3D → data compounds.', status: 'parked' },
      { title: 'The Email', description: '"The best productivity app with social routing, powered by an agent that actually knows you."', status: 'parked', notes: 'The dream. The Carbon Model IS the CarbonRouter\'s secret weapon.' },
    ]
  },
]

// ── STATUS COLORS ──────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, { bg: string; text: string; label: string; glow?: string }> = {
  shipped: { bg: 'rgba(16,185,129,0.15)', text: '#10b981', label: '✅ SHIPPED', glow: 'rgba(16,185,129,0.25)' },
  active: { bg: 'rgba(14,165,233,0.15)', text: '#0ea5e9', label: '🔨 ACTIVE' },
  planned: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', label: '○ PLANNED' },
  parked: { bg: 'rgba(100,116,139,0.15)', text: '#64748b', label: '◇ PARKED' },
}

// ── SPARKLE VFX ────────────────────────────────────────────────────

function ShipSparkle({ color }: { color: string }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: 16, height: 16, marginRight: 6, verticalAlign: 'middle' }}>
      <span style={{
        position: 'absolute',
        inset: 0,
        background: color,
        borderRadius: '50%',
        opacity: 0.6,
        animation: 'shipPulse 2s ease-in-out infinite',
      }} />
      <span style={{
        position: 'absolute',
        inset: 3,
        background: color,
        borderRadius: '50%',
        opacity: 1,
      }} />
    </span>
  )
}

// ── PARTICLE SYSTEM ────────────────────────────────────────────────

function useParticles(canvasRef: React.RefObject<HTMLCanvasElement | null>, activeColor: string) {
  const particlesRef = useRef<Particle[]>([])
  const animRef = useRef<number>(0)
  const mouseRef = useRef({ x: 0, y: 0 })
  const colorRef = useRef(activeColor)
  colorRef.current = activeColor

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

    particlesRef.current = []
    for (let i = 0; i < 100; i++) {
      particlesRef.current.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: Math.random() * 2.5 + 0.5,
        opacity: Math.random() * 0.4 + 0.1,
        color: colorRef.current,
        life: Math.random() * 1000,
      })
    }

    const hexToRgb = (hex: string) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    })

    const animate = () => {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      particlesRef.current.forEach(p => {
        p.life += 0.01
        p.x += p.vx
        p.y += p.vy
        p.opacity = 0.1 + Math.sin(p.life) * 0.2

        const dx = p.x - mouseRef.current.x
        const dy = p.y - mouseRef.current.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 150) {
          p.vx += (dx / dist) * 0.03
          p.vy += (dy / dist) * 0.03
        }

        p.vx *= 0.99
        p.vy *= 0.99

        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0

        p.color = colorRef.current

        const { r, g, b } = hexToRgb(p.color)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.max(0, p.opacity)})`
        ctx.fill()
      })

      // Connections
      for (let i = 0; i < particlesRef.current.length; i++) {
        for (let j = i + 1; j < particlesRef.current.length; j++) {
          const a = particlesRef.current[i]
          const b = particlesRef.current[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 120) {
            const opacity = (1 - dist / 120) * 0.1
            const { r, g, b: bl } = hexToRgb(colorRef.current)
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.strokeStyle = `rgba(${r},${g},${bl},${opacity})`
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef])
}

// ── DETAIL CARD ────────────────────────────────────────────────────

function DetailCard({ detail, phaseColor }: { detail: SpecDetail; phaseColor: string }) {
  const [expanded, setExpanded] = useState(false)
  const statusCfg = STATUS_CONFIG[detail.status]
  const isShipped = detail.status === 'shipped'

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        background: isShipped ? 'rgba(16,185,129,0.04)' : 'rgba(15,15,20,0.8)',
        border: `1px solid ${expanded ? phaseColor : isShipped ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 12,
        padding: '14px 18px',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        boxShadow: isShipped
          ? '0 0 12px rgba(16,185,129,0.08)'
          : expanded ? `0 0 20px ${phaseColor}22` : 'none',
        marginBottom: 6,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Shipped shimmer */}
      {isShipped && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: '-100%',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(16,185,129,0.06), transparent)',
          animation: 'shimmer 4s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, position: 'relative' }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontWeight: 600,
            color: isShipped ? '#6ee7b7' : '#e2e8f0',
            fontSize: 13,
            lineHeight: 1.4,
            display: 'flex',
            alignItems: 'center',
          }}>
            {isShipped && <ShipSparkle color="#10b981" />}
            {detail.title}
          </div>
          {!expanded && (
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3, lineHeight: 1.4 }}>
              {detail.description.substring(0, 120)}{detail.description.length > 120 ? '...' : ''}
            </div>
          )}
        </div>
        <div style={{
          padding: '2px 8px',
          borderRadius: 6,
          background: statusCfg.bg,
          color: statusCfg.text,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.8,
          whiteSpace: 'nowrap',
        }}>
          {statusCfg.label}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          <div style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.6 }}>{detail.description}</div>

          {detail.files && detail.files.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: '#64748b', fontSize: 10, fontWeight: 600, marginBottom: 4, letterSpacing: 0.5 }}>FILES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {detail.files.map(f => (
                  <span key={f} style={{
                    background: 'rgba(14,165,233,0.1)', color: '#7dd3fc',
                    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace',
                  }}>{f}</span>
                ))}
              </div>
            </div>
          )}

          {detail.tools && detail.tools.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: '#64748b', fontSize: 10, fontWeight: 600, marginBottom: 4, letterSpacing: 0.5 }}>TOOLS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {detail.tools.map(t => (
                  <span key={t} style={{
                    background: 'rgba(245,158,11,0.1)', color: '#fcd34d',
                    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'monospace',
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {detail.notes && (
            <div style={{
              marginTop: 10, padding: '8px 12px',
              background: 'rgba(245,158,11,0.06)',
              borderLeft: `3px solid ${phaseColor}`,
              borderRadius: '0 6px 6px 0',
              color: '#94a3b8', fontSize: 11, lineHeight: 1.5, fontStyle: 'italic',
            }}>
              {detail.notes}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── PHASE BLOCK ────────────────────────────────────────────────────

function PhaseBlock({ phase, isActive, onClick }: { phase: Phase; isActive: boolean; onClick: () => void }) {
  const shippedCount = phase.details.filter(d => d.status === 'shipped').length
  const totalCount = phase.details.length
  const pct = Math.round((shippedCount / totalCount) * 100)
  const isComplete = pct === 100

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          cursor: 'pointer',
          padding: '14px 20px',
          background: isComplete
            ? 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(15,15,20,0.9))'
            : isActive
              ? `linear-gradient(135deg, ${phase.glowColor}, rgba(15,15,20,0.9))`
              : 'rgba(15,15,20,0.6)',
          border: `1px solid ${isComplete ? '#10b981' : isActive ? phase.color : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 14,
          transition: 'all 0.4s ease',
          boxShadow: isComplete
            ? '0 0 24px rgba(16,185,129,0.15)'
            : isActive ? `0 0 24px ${phase.glowColor}` : 'none',
        }}
      >
        <div style={{ fontSize: 28 }}>{isComplete ? '✅' : phase.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: isComplete ? '#10b981' : phase.color, fontWeight: 700, fontSize: 16 }}>
              {phase.name}
            </span>
            <span style={{ color: '#e2e8f0', fontWeight: 500, fontSize: 14 }}>{phase.subtitle}</span>
            {isComplete && (
              <span style={{
                background: 'rgba(16,185,129,0.15)',
                color: '#10b981',
                padding: '1px 8px',
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}>COMPLETE</span>
            )}
          </div>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
            {shippedCount}/{totalCount} shipped
          </div>
          {/* Progress bar */}
          <div style={{
            marginTop: 6,
            height: 3,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 2,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              background: isComplete
                ? 'linear-gradient(90deg, #10b981, #6ee7b7)'
                : `linear-gradient(90deg, ${phase.color}, ${phase.color}88)`,
              borderRadius: 2,
              transition: 'width 0.5s ease',
              boxShadow: isComplete ? '0 0 8px rgba(16,185,129,0.4)' : 'none',
            }} />
          </div>
        </div>
        {/* Progress ring */}
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
          <circle
            cx="22" cy="22" r="18" fill="none"
            stroke={isComplete ? '#10b981' : phase.color}
            strokeWidth="3"
            strokeDasharray={`${(pct / 100) * 113} 113`}
            strokeLinecap="round"
            transform="rotate(-90 22 22)"
            style={{ transition: 'stroke-dasharray 0.5s ease' }}
          />
          <text x="22" y="26" textAnchor="middle" fill={isComplete ? '#10b981' : phase.color} fontSize="11" fontWeight="700">
            {pct}%
          </text>
        </svg>
        <div style={{
          color: '#64748b', fontSize: 18,
          transform: isActive ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.3s ease',
        }}>▸</div>
      </div>

      {isActive && (
        <div style={{
          marginTop: 10,
          marginLeft: 20,
          paddingLeft: 18,
          borderLeft: `2px solid ${isComplete ? '#10b98133' : phase.color + '33'}`,
        }}>
          {phase.details.map((detail, i) => (
            <DetailCard key={detail.title} detail={detail} phaseColor={phase.color} />
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
        <div style={{
          flex: '1 1 300px',
          background: 'rgba(14,165,233,0.06)',
          border: '1px solid rgba(14,165,233,0.2)',
          borderRadius: 12, padding: 16,
        }}>
          <div style={{ color: '#0ea5e9', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
            af_oasis — The Stage 🌐
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6 }}>
            Next.js 14 + R3F + Three.js + Zustand<br />
            Worlds · Conjuring · Avatars · Panels<br />
            Merlin · Claude Code · DevCraft · Anorak<br />
            SQLite (local-first) · AudioManager<br />
            InputManager · 3D Agent Windows
          </div>
        </div>

        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '8px 12px', minWidth: 80,
        }}>
          <div style={{ color: '#10b981', fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>MCP</div>
          <div style={{ color: '#10b981', fontSize: 24 }}>⇄</div>
          <div style={{ color: '#10b981', fontSize: 11, fontWeight: 600, letterSpacing: 1, marginTop: 4 }}>SSE</div>
          <div style={{ color: '#64748b', fontSize: 10, marginTop: 8, textAlign: 'center' }}>Blood-Brain<br />Barrier</div>
        </div>

        <div style={{
          flex: '1 1 300px',
          background: 'rgba(245,158,11,0.06)',
          border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 12, padding: 16,
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
  const shippedDetails = PHASES.reduce((sum, p) => sum + p.details.filter(d => d.status === 'shipped').length, 0)
  const plannedDetails = PHASES.reduce((sum, p) => sum + p.details.filter(d => d.status === 'planned').length, 0)
  const parkedDetails = PHASES.reduce((sum, p) => sum + p.details.filter(d => d.status === 'parked').length, 0)
  const overallPct = Math.round((shippedDetails / totalDetails) * 100)

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
      {/* CSS animations */}
      <style>{`
        @keyframes shipPulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes shimmer {
          0% { left: -100%; }
          50% { left: 200%; }
          100% { left: 200%; }
        }
        @keyframes heroGlow {
          0%, 100% { filter: drop-shadow(0 0 20px rgba(14,165,233,0.3)); }
          50% { filter: drop-shadow(0 0 40px rgba(16,185,129,0.4)); }
        }
        @keyframes countUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none', zIndex: 0,
        }}
      />

      <div style={{
        position: 'relative', zIndex: 1,
        maxWidth: 860, margin: '0 auto',
        padding: '40px 24px 80px',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 13, color: '#64748b', letterSpacing: 3, marginBottom: 8 }}>
            ॐ THE OASIS ॐ
          </div>
          <h1 style={{
            fontSize: 40,
            fontWeight: 800,
            background: 'linear-gradient(135deg, #0ea5e9, #10b981, #14b8a6)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            margin: 0,
            lineHeight: 1.2,
            animation: 'heroGlow 4s ease-in-out infinite',
          }}>
            Local-First 3D World Builder
          </h1>
          <div style={{ color: '#94a3b8', fontSize: 14, marginTop: 8, maxWidth: 500, margin: '8px auto 0' }}>
            Text-to-3D conjuring · LLM procedural geometry · Agent-powered missions · World persistence
          </div>

          {/* Overall progress */}
          <div style={{
            marginTop: 24,
            background: 'rgba(15,15,20,0.8)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
            padding: '16px 24px',
            display: 'inline-block',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div>
                <div style={{
                  fontSize: 36, fontWeight: 800,
                  color: '#10b981',
                  lineHeight: 1,
                  animation: 'countUp 0.6s ease-out',
                }}>
                  {overallPct}%
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>OVERALL</div>
              </div>
              <div style={{ height: 40, width: 1, background: 'rgba(255,255,255,0.08)' }} />
              <div style={{ display: 'flex', gap: 16, fontSize: 12, animation: 'countUp 0.8s ease-out' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#10b981', fontWeight: 700, fontSize: 18 }}>{shippedDetails}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>shipped</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 18 }}>{plannedDetails}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>planned</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#64748b', fontWeight: 700, fontSize: 18 }}>{parkedDetails}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>parked</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#94a3b8', fontWeight: 700, fontSize: 18 }}>{totalDetails}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>total</div>
                </div>
              </div>
            </div>
            {/* Overall progress bar */}
            <div style={{
              marginTop: 12, height: 4,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 2, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', width: `${overallPct}%`,
                background: 'linear-gradient(90deg, #10b981, #0ea5e9, #14b8a6)',
                borderRadius: 2,
                transition: 'width 1s ease',
                boxShadow: '0 0 12px rgba(16,185,129,0.4)',
              }} />
            </div>
          </div>
        </div>

        {/* Architecture */}
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
          textAlign: 'center', marginTop: 48,
          padding: '24px 0',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          color: '#475569', fontSize: 12,
        }}>
          Productivity becomes a prompt engineering problem.<br />
          Loneliness becomes a routing problem.<br />
          Both are solved by an agent that models you well enough.<br />
          <span style={{ color: '#64748b', marginTop: 8, display: 'inline-block' }}>
            ॐ ship or die ॐ
          </span>
        </div>
      </div>
    </div>
  )
}
