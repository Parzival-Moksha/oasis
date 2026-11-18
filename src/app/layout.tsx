import type { Metadata } from 'next'
import { Cinzel, Cormorant_Garamond, JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import { Providers } from '@/components/Providers'
import './globals.css'
import './oasis-emoji.css'
import { isHostedOasis } from '@/lib/oasis-profile'
import { LocalServiceWorkerGuard } from '@/components/LocalServiceWorkerGuard'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Root Layout
// ─═̷─═̷─🅰─═̷─═̷─ Fonts catalog mirrored in src/lib/fonts.ts ─═̷─═̷─🅰─═̷─═̷─
// Each next/font call self-hosts the font and registers a CSS variable
// on <html>. Settings.uiFont picks which variable the UI consumes —
// see src/lib/fonts.ts for the picker side of the wiring.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

const cinzel = Cinzel({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-cinzel',
  display: 'swap',
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-cormorant',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

// The manifest comes from src/app/manifest.ts (Next links it). On this computer the Oasis wears its own
// icon (the ":4516" sunset), so its tab and its installed window are easy to find.
const localOasis = !isHostedOasis()

export const metadata: Metadata = {
  title: 'Oasis',
  description: 'Text-to-3D world builder',
  icons: localOasis
    ? { icon: [{ url: '/icons/oasis-local-48.png', sizes: '48x48', type: 'image/png' }, { url: '/favicon.svg', type: 'image/svg+xml' }], apple: '/icons/oasis-local-apple-180.png' }
    : { icon: '/favicon.svg' },
  appleWebApp: {
    capable: true,
    title: 'Oasis',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const fontVars = [cinzel.variable, cormorant.variable, spaceGrotesk.variable, jetbrainsMono.variable].join(' ')
  return (
    <html lang="en" className={fontVars}>
      <body>
        <LocalServiceWorkerGuard />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
