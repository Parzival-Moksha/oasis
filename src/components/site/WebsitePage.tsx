import { JetBrains_Mono, Manrope, Oxanium } from 'next/font/google'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { TiltSurface } from './TiltSurface'
import styles from './WebsitePage.module.css'

const GITHUB_URL = 'https://github.com/Parzival-Moksha/oasis'

const displayFont = Oxanium({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['600', '700', '800'],
})

const bodyFont = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700', '800'],
})

const monoFont = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['500', '700'],
})

const entryOptions = [
  {
    label: 'Download',
    time: '5 min',
    title: 'Full local Oasis',
    body: 'Claude Code, Codex, Anorak, Merlin, local worlds, and one-click Hermes or OpenClaw connection.',
    href: '#setup',
    variant: 'download',
  },
  {
    label: 'Enter online',
    time: '5 sec',
    title: 'Hosted preview',
    body: 'A fast public doorway for seeing the world before you run the serious agent stack on your machine.',
    href: '/',
    variant: 'online',
  },
] as const

const setupSteps = [
  {
    label: 'Clone',
    title: 'Install the local world',
    body: 'The full version runs on the machine where your agent tools and local state live.',
    code: 'git clone https://github.com/Parzival-Moksha/oasis.git\ncd oasis\npnpm install',
  },
  {
    label: 'Prepare',
    title: 'Create the local store',
    body: 'Oasis uses Prisma and SQLite locally. No hosted database is required for the first run.',
    code: 'npx prisma db push\nnpx prisma generate',
  },
  {
    label: 'Open',
    title: 'Start the workspace',
    body: 'Keep the app running while Hermes, OpenClaw, Codex, or MCP-aware agents connect.',
    code: 'pnpm dev\n# http://localhost:4516',
  },
]

const connectorFlow = [
  {
    label: 'Click connect',
    body: 'Open the connector panel from Oasis when the agent runtime is reachable.',
  },
  {
    label: 'Choose runtime',
    body: 'Pick Hermes Agent or OpenClaw and confirm the localhost or tunnel endpoint.',
  },
  {
    label: 'Enter world',
    body: 'The agent gets tools, an avatar surface, screenshots, movement, and persistent world state.',
  },
]

const integrationCards = [
  {
    label: 'Hermes',
    title: 'Dashboard-native candidate',
    body: 'Hermes dashboard plugins can add custom tabs and panels. Oasis can become a spatial tab for agent people already living there.',
  },
  {
    label: 'OpenClaw',
    title: 'Avatar brain, Oasis body',
    body: 'OpenClaw can own the conversation while Oasis hosts the avatar, spatial media, movement, and visual feedback.',
  },
  {
    label: 'MCP',
    title: 'World tools for real agents',
    body: 'Agents can place objects, move avatars, capture screenshots, adjust sky, inspect state, and persist changes.',
  },
]

const proofPoints = [
  'Local-first Next.js 14 and Three.js workspace',
  'SQLite worlds through Prisma',
  'Hermes and OpenClaw connector path',
  'MCP tools plus SSE world events',
]

function SmartLink({
  href,
  className,
  children,
}: {
  href: string
  className: string
  children: ReactNode
}) {
  if (href.startsWith('http')) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className={styles.codeBlock}>
      <code>{code}</code>
    </pre>
  )
}

export function WebsitePage() {
  return (
    <main className={[styles.page, displayFont.variable, bodyFont.variable, monoFont.variable].join(' ')}>
      <section className={styles.hero}>
        <div className={styles.heroBackdrop} aria-hidden="true" />
        <nav className={styles.nav}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandMark}>04515</span>
            <span className={styles.brandText}>Oasis</span>
          </Link>
          <div className={styles.navLinks}>
            <SmartLink href="#setup" className={styles.navLink}>Download</SmartLink>
            <SmartLink href="#connect" className={styles.navLink}>Connect</SmartLink>
            <SmartLink href="/docs" className={styles.navLink}>Docs</SmartLink>
            <SmartLink href={GITHUB_URL} className={styles.navLinkPrimary}>GitHub</SmartLink>
          </div>
        </nav>

        <div className={styles.heroCenter}>
          <p className={styles.kicker}>Local-first 3D agent workspace</p>
          <h1>Oasis</h1>
          <p className={styles.heroLead}>
            Run a living world on your machine. Let Hermes, OpenClaw, Codex, and MCP-aware agents see it,
            move through it, build inside it, and leave real state behind.
          </p>

          <div className={styles.entryGrid} aria-label="Choose how to enter Oasis">
            {entryOptions.map((option) => (
              <TiltSurface
                key={option.label}
                max={14}
                className={[styles.entryCard, styles.tiltCard, styles[option.variant]].join(' ')}
              >
                <SmartLink href={option.href} className={styles.entryLink}>
                  <span className={styles.entryMeta}>{option.label}</span>
                  <strong>{option.time}</strong>
                  <span className={styles.entryTitle}>{option.title}</span>
                  <span className={styles.entryBody}>{option.body}</span>
                </SmartLink>
              </TiltSurface>
            ))}
          </div>

          <SmartLink href="#connect" className={styles.connectButton}>
            One-click connect Hermes or OpenClaw
          </SmartLink>
        </div>

        <div className={styles.modeStrip} aria-label="Oasis modes">
          <span>Local full version</span>
          <span>Hosted preview</span>
          <span>Agent connectors</span>
        </div>
      </section>

      <section id="setup" className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.kicker}>Download</p>
          <h2>Five minutes to the full local workspace.</h2>
          <p>
            The local install is the serious version: Claude Code, Codex, Anorak, Merlin, SQLite worlds, and
            the agent connector surface all live beside the world renderer.
          </p>
        </div>

        <div className={styles.setupGrid}>
          {setupSteps.map((step) => (
            <TiltSurface key={step.title} max={8} className={[styles.setupCard, styles.tiltCard].join(' ')}>
              <span>{step.label}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <CodeBlock code={step.code} />
            </TiltSurface>
          ))}
        </div>
      </section>

      <section id="connect" className={styles.connectSection}>
        <div className={styles.connectCopy}>
          <p className={styles.kicker}>One-click agents</p>
          <h2>Bring Hermes or OpenClaw into the room.</h2>
          <p>
            The first-run story should be short: choose your runtime, confirm the endpoint, then watch the
            agent appear with tools, media, and an avatar surface. The 30 second walkthrough slot is reserved
            for that flow when the connector slice lands.
          </p>
        </div>
        <div className={styles.flowGrid}>
          {connectorFlow.map((step, index) => (
            <TiltSurface key={step.label} max={10} className={[styles.flowCard, styles.tiltCard].join(' ')}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{step.label}</h3>
              <p>{step.body}</p>
            </TiltSurface>
          ))}
        </div>
      </section>

      <section id="agents" className={styles.agentSection}>
        <div className={styles.agentCopy}>
          <p className={styles.kicker}>Hermes and OpenClaw</p>
          <h2>Give agents a world, not another text box.</h2>
          <p>
            Oasis is the body layer: spatial UI, avatars, media, screenshots, movement, and persistent world
            state. Agent runtimes stay responsible for sessions, reasoning, tools, and identity.
          </p>
          <div className={styles.integrationGrid}>
            {integrationCards.map((card) => (
              <TiltSurface
                key={card.title}
                max={8}
                className={[styles.integrationCard, styles.tiltCard].join(' ')}
              >
                <span>{card.label}</span>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </TiltSurface>
            ))}
          </div>
        </div>

        <aside className={styles.videoSlot} aria-label="Hermes to Oasis walkthrough video slot">
          <div className={styles.videoFrame}>
            <div className={styles.videoBar}>
              <span>30 sec video</span>
              <span>Coming next</span>
            </div>
            <div className={styles.videoBody}>
              <strong>Hermes Agent to Oasis</strong>
              <p>Connect, choose the endpoint, and watch an agent enter the world.</p>
            </div>
          </div>
        </aside>
      </section>

      <section className={styles.proofSection}>
        <div className={styles.sectionHeader}>
          <p className={styles.kicker}>Local and online</p>
          <h2>One public doorway, one full local machine.</h2>
          <p>
            The hosted version is the fast welcome. The local version is where agents can control real tools,
            leave real state, and build inside the world beside you.
          </p>
        </div>
        <div className={styles.proofGrid}>
          {proofPoints.map((point) => (
            <TiltSurface key={point} max={6} className={[styles.proofItem, styles.tiltCard].join(' ')}>
              {point}
            </TiltSurface>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div>
          <p className={styles.kicker}>Choose your doorway</p>
          <h2>Preview instantly. Install locally when you want real agents.</h2>
          <p>
            Enter the hosted world for the fast look. Download the full workspace when you want Hermes,
            OpenClaw, Codex, and MCP-aware agents building beside you.
          </p>
        </div>
        <div className={styles.ctaRow}>
          <SmartLink href="/" className={styles.ctaSecondary}>Enter online</SmartLink>
          <SmartLink href={GITHUB_URL} className={styles.ctaPrimary}>Download</SmartLink>
        </div>
      </section>
    </main>
  )
}
