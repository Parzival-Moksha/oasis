'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Login Gate
// The door to the Oasis. Google + Discord + GitHub OAuth. Wallet connect later.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { signIn, useSession } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useEffect } from 'react'

function LoginContent() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  const error = searchParams.get('error')
  const { status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'authenticated') router.replace('/')
  }, [status, router])

  if (status === 'authenticated') return null

  return (
    <main className="w-full h-screen bg-black flex items-center justify-center">
      {/* Neon glow keyframes */}
      <style>{`
        @keyframes neonPulse {
          0%, 100% { text-shadow: 0 0 10px #00ff88, 0 0 20px #00ff88, 0 0 40px #00ff8855, 0 0 80px #00ff8822; }
          50% { text-shadow: 0 0 5px #00ff88, 0 0 15px #00ff88, 0 0 30px #00ff8844, 0 0 60px #00ff8811; }
        }
        @keyframes logoFadeIn {
          0% { opacity: 0; transform: scale(0.9); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <div className="flex flex-col items-center gap-8 max-w-sm w-full px-6">
        {/* Logo with faded edges */}
        <div className="flex flex-col items-center gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/oasislogo.jpg"
            alt=""
            width={140}
            height={140}
            className="rounded-2xl"
            style={{
              filter: 'brightness(1.3)',
              boxShadow: '0 0 30px rgba(0,255,136,0.2), 0 0 60px rgba(0,255,136,0.08)',
              animation: 'logoFadeIn 1.2s ease-out',
            }}
          />
          <h1
            className="text-4xl font-black tracking-[0.3em] text-[#00ff88]"
            style={{
              fontFamily: "'Courier New', 'Lucida Console', monospace",
              animation: 'neonPulse 3s ease-in-out infinite',
              letterSpacing: '0.3em',
            }}
          >
            04515
          </h1>
          <p
            className="text-sm text-center leading-relaxed tracking-wider"
            style={{
              fontFamily: "'Courier New', 'Lucida Console', monospace",
              color: '#88ddaa',
              textShadow: '0 0 12px rgba(0,255,136,0.25)',
            }}
          >
            open source, community co-vibecoded metaverse
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="w-full p-3 border border-red-500/50 rounded bg-red-500/10 text-red-400 text-sm text-center">
            {error === 'OAuthSignin' ? 'Could not start sign-in. Check OAuth config.' :
             error === 'OAuthCallback' ? 'Sign-in callback failed.' :
             error === 'OAuthAccountNotLinked' ? 'Email already linked to another account.' :
             'Something went wrong. Try again.'}
          </div>
        )}

        {/* Actions */}
        <div className="w-full flex flex-col gap-3">
          {/* Explore — the hero action for visitors */}
          <button
            onClick={() => router.push('/explore')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded border border-[#00ff88]/30 bg-[#00ff88]/10 hover:bg-[#00ff88]/20 hover:border-[#00ff88]/50 transition-all text-[#00ff88] text-sm font-bold cursor-pointer tracking-wide"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
            </svg>
            Explore Worlds
          </button>

          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 border-t border-gray-800" />
            <span className="text-[10px] text-gray-600 uppercase tracking-widest">sign in to build</span>
            <div className="flex-1 border-t border-gray-800" />
          </div>

          <button
            onClick={() => signIn('google', { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded border border-gray-700 bg-gray-900 hover:bg-gray-800 hover:border-gray-500 transition-all text-white text-sm cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <button
            onClick={() => signIn('discord', { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded border border-indigo-800/50 bg-[#5865F2]/10 hover:bg-[#5865F2]/20 hover:border-indigo-600/50 transition-all text-white text-sm cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#5865F2">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            Continue with Discord
          </button>

          <button
            onClick={() => signIn('github', { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded border border-gray-700 bg-gray-900 hover:bg-gray-800 hover:border-gray-500 transition-all text-white text-sm cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Continue with GitHub
          </button>

          {/* Wallet connect — coming soon */}
          <button
            disabled
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded border border-gray-800 bg-gray-950 text-gray-600 text-sm cursor-not-allowed"
            title="Coming soon — Solana + Base wallet connect"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="2"/>
              <path d="M16 12h.01"/>
            </svg>
            Connect Wallet (coming soon)
          </button>
        </div>

        {/* Footer */}
        <p className="text-gray-700 text-xs text-center" style={{ fontFamily: "'Courier New', monospace" }}>
          04515.xyz
        </p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="w-full h-screen bg-black flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </main>
    }>
      <LoginContent />
    </Suspense>
  )
}
