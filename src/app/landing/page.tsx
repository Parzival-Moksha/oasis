'use client'

import { useRef, useEffect } from 'react'

// ═══════════════════════════════════════════════════════════════════
// THE OASIS — Landing Page
// Twitter-linkable. Particle BG. Hero + Features + CTA.
// localhost:4516/landing
// ═══════════════════════════════════════════════════════════════════

// ── PARTICLE BACKGROUND ────────────────────────────────────────────

function useParticleBg(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)

    const mouse = { x: -1000, y: -1000 }
    const onMouse = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY }
    window.addEventListener('mousemove', onMouse)

    const particles: { x: number; y: number; vx: number; vy: number; s: number; o: number; l: number; c: string }[] = []
    const colors = ['#0ea5e9', '#10b981', '#14b8a6', '#f59e0b']
    for (let i = 0; i < 120; i++) {
      particles.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        s: Math.random() * 2.5 + 0.5, o: Math.random() * 0.3 + 0.05,
        l: Math.random() * 100,
        c: colors[Math.floor(Math.random() * colors.length)],
      })
    }

    const colorRgb = new Map(colors.map(h => [h, {
      r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16)
    }]))

    let raf = 0
    const draw = () => {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      particles.forEach(p => {
        p.l += 0.008
        p.x += p.vx; p.y += p.vy
        p.o = 0.05 + Math.sin(p.l) * 0.15

        const dx = p.x - mouse.x, dy = p.y - mouse.y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < 180) { p.vx += (dx / d) * 0.02; p.vy += (dy / d) * 0.02 }
        p.vx *= 0.995; p.vy *= 0.995

        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0

        const { r, g, b } = colorRgb.get(p.c)!
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.max(0, p.o)})`
        ctx.fill()
      })

      // Connections
      ctx.lineWidth = 1
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j]
          const dx = a.x - b.x, dy = a.y - b.y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < 100) {
            const o = (1 - d / 100) * 0.06
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
            ctx.strokeStyle = `rgba(148,163,184,${o})`; ctx.stroke()
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouse)
      cancelAnimationFrame(raf)
    }
  }, [canvasRef])
}

// ── FEATURE CARD ───────────────────────────────────────────────────

function FeatureCard({ icon, title, desc, color }: { icon: string; title: string; desc: string; color: string }) {
  return (
    <div style={{
      background: 'rgba(15,15,20,0.7)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14,
      padding: '24px 20px',
      transition: 'all 0.3s ease',
      cursor: 'default',
      flex: '1 1 240px',
      minWidth: 240,
    }}
      onMouseEnter={e => {
        e.currentTarget.style.border = `1px solid ${color}44`
        e.currentTarget.style.boxShadow = `0 0 24px ${color}15`
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.border = '1px solid rgba(255,255,255,0.06)'
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 12 }}>{icon}</div>
      <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{title}</div>
      <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>{desc}</div>
    </div>
  )
}

// ── AGENT CARD ─────────────────────────────────────────────────────

function AgentCard({ icon, name, color, desc }: { icon: string; name: string; color: string; desc: string }) {
  return (
    <div style={{
      background: 'rgba(15,15,20,0.7)',
      border: `1px solid ${color}33`,
      borderRadius: 12,
      padding: '16px 18px',
      flex: '1 1 200px',
      minWidth: 180,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <span style={{ color, fontWeight: 700, fontSize: 14 }}>{name}</span>
      </div>
      <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>{desc}</div>
    </div>
  )
}

// ── STAT COUNTER ───────────────────────────────────────────────────

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ textAlign: 'center', flex: '1 1 100px' }}>
      <div style={{ color, fontWeight: 800, fontSize: 32, lineHeight: 1 }}>{value}</div>
      <div style={{ color: '#64748b', fontSize: 11, marginTop: 4, letterSpacing: 0.5 }}>{label}</div>
    </div>
  )
}

// ── MAIN PAGE ──────────────────────────────────────────────────────

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useParticleBg(canvasRef)

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0f',
      color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      position: 'relative',
      overflow: 'auto',
    }}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes heroGlow { 0%,100% { text-shadow: 0 0 40px rgba(14,165,233,0.3); } 50% { text-shadow: 0 0 60px rgba(16,185,129,0.4); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        .landing-btn:hover { transform: translateY(-1px) !important; box-shadow: 0 0 30px rgba(14,165,233,0.3) !important; }
      `}</style>

      <canvas ref={canvasRef} style={{
        position: 'fixed', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 0,
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ── HERO ── */}
        <section style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '0 24px',
        }}>
          <div style={{
            fontSize: 14, color: '#64748b', letterSpacing: 4, marginBottom: 16,
            animation: 'fadeUp 0.8s ease-out',
          }}>
            ॐ OPEN SOURCE ॐ
          </div>

          <h1 style={{
            fontSize: 'clamp(36px, 6vw, 72px)',
            fontWeight: 900,
            background: 'linear-gradient(135deg, #0ea5e9 0%, #10b981 40%, #14b8a6 80%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            margin: 0, lineHeight: 1.1,
            animation: 'fadeUp 1s ease-out, heroGlow 5s ease-in-out infinite',
            maxWidth: 800,
          }}>
            The Oasis
          </h1>

          <p style={{
            color: '#94a3b8',
            fontSize: 'clamp(16px, 2vw, 20px)',
            marginTop: 16,
            maxWidth: 600,
            lineHeight: 1.5,
            animation: 'fadeUp 1.2s ease-out',
          }}>
            A local-first, agent-powered 3D world builder.<br />
            Text-to-3D conjuring. LLM procedural geometry. Mission management.<br />
            Your AI agents live here.
          </p>

          {/* CTA buttons */}
          <div style={{
            display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap', justifyContent: 'center',
            animation: 'fadeUp 1.4s ease-out',
          }}>
            <a className="landing-btn" href="https://github.com/l-af/oasis" target="_blank" rel="noopener noreferrer" style={{
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
              color: '#fff', fontWeight: 700, fontSize: 15,
              padding: '14px 32px', borderRadius: 12,
              textDecoration: 'none', transition: 'all 0.3s ease',
              border: 'none', cursor: 'pointer',
            }}>
              git clone &rarr;
            </a>
            <a className="landing-btn" href="/spec" style={{
              background: 'rgba(255,255,255,0.06)',
              color: '#e2e8f0', fontWeight: 600, fontSize: 15,
              padding: '14px 32px', borderRadius: 12,
              textDecoration: 'none', transition: 'all 0.3s ease',
              border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
            }}>
              View Roadmap
            </a>
          </div>

          {/* Tech stack pills */}
          <div style={{
            display: 'flex', gap: 8, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center',
            animation: 'fadeUp 1.6s ease-out',
          }}>
            {['Next.js 14', 'React Three Fiber', 'Three.js', 'Zustand', 'Prisma/SQLite', 'Claude Code'].map(t => (
              <span key={t} style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#94a3b8', fontSize: 11,
                padding: '4px 12px', borderRadius: 8,
              }}>{t}</span>
            ))}
          </div>

          {/* Scroll indicator */}
          <div style={{
            position: 'absolute', bottom: 40,
            animation: 'float 3s ease-in-out infinite',
            color: '#475569', fontSize: 12,
          }}>
            scroll &darr;
          </div>
        </section>

        {/* ── STATS BAR ── */}
        <section style={{
          padding: '48px 24px',
          maxWidth: 700, margin: '0 auto',
        }}>
          <div style={{
            background: 'rgba(15,15,20,0.8)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16, padding: '24px 32px',
            display: 'flex', gap: 16, flexWrap: 'wrap',
            justifyContent: 'center',
          }}>
            <Stat value="565" label="3D ASSETS" color="#0ea5e9" />
            <Stat value="4" label="AI AGENTS" color="#14b8a6" />
            <Stat value="102" label="SOUNDS" color="#f59e0b" />
            <Stat value="7" label="INPUT MODES" color="#10b981" />
            <Stat value="66" label="TESTS" color="#ec4899" />
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section style={{
          padding: '32px 24px 64px',
          maxWidth: 900, margin: '0 auto',
        }}>
          <h2 style={{
            textAlign: 'center', fontSize: 28, fontWeight: 800,
            color: '#e2e8f0', marginBottom: 8,
          }}>
            What You Get
          </h2>
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13, marginBottom: 32 }}>
            git clone. pnpm install. pnpm dev. That's it.
          </p>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <FeatureCard
              icon="✨"
              title="Text-to-3D Conjuring"
              desc="Type what you want. Meshy or Tripo generates the 3D model. Drag it into your world. Done."
              color="#0ea5e9"
            />
            <FeatureCard
              icon="🧠"
              title="LLM Procedural Geometry"
              desc="Claude writes Three.js code that generates geometry. Castles, terrains, abstract sculptures — all from a prompt."
              color="#14b8a6"
            />
            <FeatureCard
              icon="🎮"
              title="Full Camera System"
              desc="Orbit, Noclip (Quake fly), Third-Person with avatar. 7-state InputManager handles all modes cleanly."
              color="#10b981"
            />
            <FeatureCard
              icon="🪟"
              title="3D Agent Windows"
              desc="Deploy AI agents as floating windows in your 3D world. Camera zooms in on Enter, Escape returns. Full streaming UI."
              color="#f59e0b"
            />
            <FeatureCard
              icon="⚡"
              title="DevCraft Missions"
              desc="Gamified productivity. Timer, valor scoring, punya system, chart analytics. Compete against yourself."
              color="#ec4899"
            />
            <FeatureCard
              icon="🔊"
              title="AudioManager"
              desc="20 event types, 102 sounds, per-event settings. Kenney UI sounds. Web Audio synthesis."
              color="#f97316"
            />
          </div>
        </section>

        {/* ── AGENTS ── */}
        <section style={{
          padding: '32px 24px 64px',
          maxWidth: 900, margin: '0 auto',
        }}>
          <h2 style={{
            textAlign: 'center', fontSize: 28, fontWeight: 800,
            color: '#e2e8f0', marginBottom: 8,
          }}>
            Agent Ecosystem
          </h2>
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13, marginBottom: 32 }}>
            Four specialized agents. All streamable. All deployable as 3D windows.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <AgentCard icon="💻" name="Claude Code" color="#38bdf8" desc="Full multi-turn Claude Code sessions via --resume. THE primary dev tool. Sky blue button." />
            <AgentCard icon="🧙" name="Merlin" color="#14b8a6" desc="World-builder agent. Real Claude Code CLI sessions with Oasis MCP tools for building, walking, and seeing the world." />
            <AgentCard icon="🔮" name="Anorak" color="#f97316" desc="Feedback portal + vibecode chat. Coding agent spawns Claude Code one-shot." />
            <AgentCard icon="⚡" name="DevCraft" color="#10b981" desc="Mission CRUD + timer + valor scoring + gamification. The productivity engine." />
          </div>
        </section>

        {/* ── ARCHITECTURE ── */}
        <section style={{
          padding: '32px 24px 64px',
          maxWidth: 900, margin: '0 auto',
        }}>
          <h2 style={{
            textAlign: 'center', fontSize: 28, fontWeight: 800,
            color: '#e2e8f0', marginBottom: 8,
          }}>
            Architecture
          </h2>
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13, marginBottom: 32 }}>
            Two symbiotic repos. The Stage renders. The Brain thinks.
          </p>

          <div style={{
            background: 'rgba(15,15,20,0.8)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16, padding: 24,
          }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
              <div style={{
                flex: '1 1 280px',
                background: 'rgba(14,165,233,0.06)',
                border: '1px solid rgba(14,165,233,0.2)',
                borderRadius: 12, padding: 20,
              }}>
                <div style={{ color: '#0ea5e9', fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
                  af_oasis — The Stage 🌐
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.7 }}>
                  Next.js 14 + React Three Fiber<br />
                  3D worlds, conjuring, avatars<br />
                  Agent panels + 3D windows<br />
                  InputManager (7 states)<br />
                  AudioManager (102 sounds)<br />
                  Prisma/SQLite (local-first)
                </div>
              </div>

              <div style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', padding: 16,
              }}>
                <div style={{ color: '#10b981', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>MCP</div>
                <div style={{ color: '#10b981', fontSize: 28, margin: '4px 0' }}>⇄</div>
                <div style={{ color: '#10b981', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>SSE</div>
              </div>

              <div style={{
                flex: '1 1 280px',
                background: 'rgba(245,158,11,0.06)',
                border: '1px solid rgba(245,158,11,0.2)',
                borderRadius: 12, padding: 20,
              }}>
                <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
                  ae_parzival — The Brain 🧠
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.7 }}>
                  Single claude -p process<br />
                  Modes: Coach · Curator · Coder<br />
                  Carbon Model (continual learning)<br />
                  Self-modifying personality<br />
                  MCP tools for everything<br />
                  SQLite (Akasha) local data
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── LOCAL FIRST MANIFESTO ── */}
        <section style={{
          padding: '32px 24px 64px',
          maxWidth: 700, margin: '0 auto',
          textAlign: 'center',
        }}>
          <h2 style={{
            fontSize: 28, fontWeight: 800,
            color: '#e2e8f0', marginBottom: 16,
          }}>
            Local-First. Zero Auth. You Own It.
          </h2>
          <div style={{
            color: '#94a3b8', fontSize: 14, lineHeight: 1.8,
            maxWidth: 550, margin: '0 auto',
          }}>
            No login. No OAuth. No sessions. No SaaS. No cloud dependency.<br />
            SQLite on your machine. Your worlds. Your agents. Your data.<br />
            git clone → pnpm dev → you're building in 3D.
          </div>

          <div style={{
            marginTop: 32,
            background: 'rgba(15,15,20,0.8)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: '20px 24px',
            fontFamily: 'monospace', fontSize: 13, color: '#94a3b8',
            textAlign: 'left', lineHeight: 1.8,
          }}>
            <span style={{ color: '#64748b' }}>$</span> <span style={{ color: '#0ea5e9' }}>git clone</span> github.com/l-af/oasis<br />
            <span style={{ color: '#64748b' }}>$</span> <span style={{ color: '#0ea5e9' }}>cd</span> oasis && <span style={{ color: '#0ea5e9' }}>pnpm install</span><br />
            <span style={{ color: '#64748b' }}>$</span> <span style={{ color: '#0ea5e9' }}>pnpm dev</span><br />
            <span style={{ color: '#10b981' }}>  ✓ ready on http://localhost:4516</span><br />
            <span style={{ color: '#64748b' }}># that's it. you're in.</span>
          </div>
        </section>

        {/* ── CTA ── */}
        <section style={{
          padding: '48px 24px 96px',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: 13, color: '#64748b', letterSpacing: 3, marginBottom: 12,
          }}>
            ॐ ship or die ॐ
          </div>
          <h2 style={{
            fontSize: 32, fontWeight: 800,
            background: 'linear-gradient(135deg, #0ea5e9, #10b981)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            margin: '0 0 24px',
          }}>
            Ready to build?
          </h2>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a className="landing-btn" href="https://github.com/l-af/oasis" target="_blank" rel="noopener noreferrer" style={{
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
              color: '#fff', fontWeight: 700, fontSize: 15,
              padding: '14px 32px', borderRadius: 12,
              textDecoration: 'none', transition: 'all 0.3s ease',
            }}>
              GitHub &rarr;
            </a>
            <a className="landing-btn" href="/spec" style={{
              background: 'rgba(255,255,255,0.06)',
              color: '#e2e8f0', fontWeight: 600, fontSize: 15,
              padding: '14px 32px', borderRadius: 12,
              textDecoration: 'none', transition: 'all 0.3s ease',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              Roadmap
            </a>
            <a className="landing-btn" href="/" style={{
              background: 'rgba(255,255,255,0.06)',
              color: '#e2e8f0', fontWeight: 600, fontSize: 15,
              padding: '14px 32px', borderRadius: 12,
              textDecoration: 'none', transition: 'all 0.3s ease',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              Enter Oasis
            </a>
          </div>

          <div style={{
            marginTop: 48, color: '#475569', fontSize: 12, lineHeight: 1.8,
          }}>
            Productivity becomes a prompt engineering problem.<br />
            Loneliness becomes a routing problem.<br />
            Both are solved by an agent that models you well enough.
          </div>
        </section>
      </div>
    </div>
  )
}
