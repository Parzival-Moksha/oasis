import { JetBrains_Mono, Manrope, Oxanium } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'

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

const flow = [
  {
    title: 'Connect an agent',
    body: 'Use the streamable HTTP MCP endpoint, the local stdio MCP server, or the Hermes panel. The world becomes tool-addressable.',
  },
  {
    title: 'Build in-place',
    body: 'Search the catalog, place assets, craft procedural scenes, paint tiles, set sky presets, and add lights without leaving the world.',
  },
  {
    title: 'See what changed',
    body: 'Agent windows and screenshot tools let you inspect outcomes from the browser side instead of trusting blind tool output.',
  },
  {
    title: 'Persist everything',
    body: 'Worlds live in JSON files, profile and mission state live in SQLite, and the whole stack stays local-first by default.',
  },
]

const features = [
  {
    tag: 'MCP',
    title: 'Streamable HTTP plus local stdio',
    body: 'The same tool substrate powers remote MCP at /api/mcp/oasis, REST fallback at /api/oasis-tools, and the local oasis-mcp server.',
  },
  {
    tag: 'Forge',
    title: 'Conjure, craft, light, and paint',
    body: 'Text-to-3D, procedural scene generation, tile painting, sky control, lights, behavior presets, and embodied avatar actions all share one world model.',
  },
  {
    tag: 'Hermes',
    title: 'Remote bridge with tunnel support',
    body: 'Pair local or remote Hermes, store SSH tunnel commands, and keep the world-aware chat panel inside Oasis instead of juggling separate terminals.',
  },
  {
    tag: 'Agents',
    title: '3D windows for specialized agents',
    body: 'Deploy Anorak, Anorak Pro, Merlin, DevCraft, and Parzival as physical windows in the scene while keeping Hermes as a first-class chat surface.',
  },
  {
    tag: 'Input',
    title: 'One input state machine',
    body: 'Orbit, noclip, third-person, placement, paint, agent-focus, and ui-focused all route through a single capability model.',
  },
  {
    tag: 'Local',
    title: 'Files you can own and move',
    body: 'World saves live in data/worlds, conjured assets and generated media stay on disk, and nothing requires a hosted backend to be useful.',
  },
]

const tutorials = [
  {
    meta: 'Start here',
    title: 'Run Oasis locally',
    body: 'Clone the repo, install dependencies, open localhost:4516, and get straight into the forge.',
    href: '/docs',
  },
  {
    meta: 'Docs',
    title: 'Connect Hermes and MCP',
    body: 'Pair Hermes, wire the tunnel if it lives on another machine, and expose the shared Oasis tool surface to agents.',
    href: '/docs',
  },
  {
    meta: 'Guide',
    title: 'Build your first world',
    body: 'Place assets, craft a scene, set a sky, paint the ground, and inspect the result with an agent-aware camera.',
    href: '/docs',
  },
]

const resources = [
  {
    title: 'Read the docs',
    body: 'Architecture, API routes, MCP tooling, Hermes setup, and the current product surface map.',
    href: '/docs',
    label: 'Read handbook',
  },
  {
    title: 'Browse the code',
    body: 'See the exact routes, tool specs, scene components, and store logic behind the Oasis world model.',
    href: GITHUB_URL,
    label: 'Open GitHub',
  },
  {
    title: 'Tutorial paths',
    body: 'The handbook should grow around first-world builds, Hermes pairing, MCP connection, and visual walkthroughs.',
    href: '/docs',
    label: 'Open tutorials',
  },
  {
    title: 'Media and demos',
    body: 'This front door should eventually carry short videos, world galleries, and visual explainers instead of dense internal status pages.',
    href: '/docs',
    label: 'Shape the showcase',
  },
]

function SmartLink({
  href,
  className,
  children,
}: {
  href: string
  className: string
  children: React.ReactNode
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

export function WebsitePage() {
  return (
    <main className={[styles.page, displayFont.variable, bodyFont.variable, monoFont.variable].join(' ')}>
      <div className={styles.frame}>
        <nav className={styles.nav}>
          <div className={styles.brand}>
            <div className={styles.brandBadge}>04515</div>
            <div>
              <p className={styles.brandTitle}>The Oasis</p>
              <p className={styles.brandMeta}>The gamer's agent interface.</p>
            </div>
          </div>
          <div className={styles.navLinks}>
            <SmartLink href="/docs" className={styles.navLink}>Docs</SmartLink>
            <SmartLink href={GITHUB_URL} className={styles.navLinkPrimary}>GitHub</SmartLink>
          </div>
        </nav>

        <section className={styles.hero}>
          <div className={styles.heroCard}>
            <div className={styles.eyebrow}>The gamer's agent interface</div>
            <h1 className={styles.heroTitle}>Meet your agents face-to-face and build worlds together.</h1>
            <p className={styles.heroLead}>
              Oasis is a local-first 3D builder where agents can search assets, place objects, craft scenes,
              move avatars, capture screenshots, and work against the same persistent world you are seeing.
            </p>
            <div className={styles.ctaRow}>
              <SmartLink href="/docs" className={styles.ctaPrimary}>Read docs</SmartLink>
              <SmartLink href={GITHUB_URL} className={styles.ctaSecondary}>Browse repo</SmartLink>
            </div>
            <div className={styles.heroFoot}>
              <div className={styles.footStat}>
                <span className={styles.footLabel}>Tool surface</span>
                <span className={styles.footValue}>35 MCP tools</span>
              </div>
              <div className={styles.footStat}>
                <span className={styles.footLabel}>World controls</span>
                <span className={styles.footValue}>23 sky presets, 7 input states</span>
              </div>
              <div className={styles.footStat}>
                <span className={styles.footLabel}>Persistence</span>
                <span className={styles.footValue}>JSON worlds + SQLite</span>
              </div>
            </div>
          </div>

          <aside className={styles.visualCard}>
            <Image
              src="/oasislogo.jpg"
              alt="Oasis identity"
              width={200}
              height={200}
              className={styles.identityImage}
              priority
            />
          </aside>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionCard}>
            <div className={styles.sectionHead}>
              <div>
                <h2>How the Oasis loop works</h2>
                <p>The website should explain the product in motion, not just list components.</p>
              </div>
              <span className={styles.pill}>Explainer</span>
            </div>
            <div className={styles.flowGrid}>
              {flow.map((step, index) => (
                <article key={step.title} className={styles.flowStep}>
                  <span className={styles.stepIndex}>0{index + 1}</span>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionCard}>
            <div className={styles.sectionHead}>
              <div>
                <h2>Core capabilities worth highlighting</h2>
                <p>These are the stable stories to tell on the website and in the docs homepage.</p>
              </div>
              <span className={styles.pill}>Website copy</span>
            </div>
            <div className={styles.featureGrid}>
              {features.map((feature) => (
                <article key={feature.title} className={styles.featureCard}>
                  <span className={styles.featureTag}>{feature.tag}</span>
                  <strong>{feature.title}</strong>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionCard}>
            <div className={styles.sectionHead}>
              <div>
                <h2>Tutorials and entry points</h2>
                <p>These should become the front door: quickstart, Hermes pairing, first-world build, and MCP connection.</p>
              </div>
              <span className={styles.pill}>Onboarding</span>
            </div>
            <div className={styles.tutorialGrid}>
              {tutorials.map((tutorial) => (
                <article key={tutorial.title} className={styles.tutorialCard}>
                  <div className={styles.tutorialMeta}>{tutorial.meta}</div>
                  <strong>{tutorial.title}</strong>
                  <p>{tutorial.body}</p>
                  <SmartLink href={tutorial.href} className={styles.resourceLink}>Follow this path</SmartLink>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionCard}>
            <div className={styles.sectionHead}>
              <div>
                <h2>What else belongs on the website</h2>
                <p>GitHub and docs are the spine. Around them, the site should surface demos, tutorials, media, and visual explainers.</p>
              </div>
              <span className={styles.pill}>Structure</span>
            </div>
            <div className={styles.resourceGrid}>
              {resources.map((resource) => (
                <article key={resource.title} className={styles.resourceCard}>
                  <strong>{resource.title}</strong>
                  <p>{resource.body}</p>
                  <SmartLink href={resource.href} className={styles.resourceLink}>{resource.label}</SmartLink>
                </article>
              ))}
            </div>
          </div>
        </section>

        <footer className={styles.footer}>
          The cleanest long-term shape is: GitHub for source, GitHub Pages for the public handbook, and an app-level
          <code> /website </code>
          route for the local-facing marketing surface.
        </footer>
      </div>
    </main>
  )
}
