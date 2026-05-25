import type { Metadata } from 'next'
import { Cinzel, Cormorant_Garamond, JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import { Providers } from '@/components/Providers'
import './globals.css'

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

export const metadata: Metadata = {
  title: 'Oasis',
  description: 'Text-to-3D world builder',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
  },
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
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
