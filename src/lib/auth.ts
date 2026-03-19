// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Auth Config (NextAuth v5)
// JWT sessions. Google + Discord + GitHub OAuth. Supabase user sync.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import Discord from 'next-auth/providers/discord'
import GitHub from 'next-auth/providers/github'
import { getServerSupabase } from './supabase'
// Local mode — no pricing, unlimited credits

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      // Only request identity — skip email scope (not all Discord users verify email)
      authorization: 'https://discord.com/api/oauth2/authorize?scope=identify',
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    // Middleware uses this to decide: allow or redirect to login
    authorized({ auth: session, request }) {
      const isLoggedIn = !!session?.user
      const { pathname, searchParams } = request.nextUrl
      const isOnLogin = pathname.startsWith('/login')

      if (isOnLogin) {
        if (isLoggedIn) return Response.redirect(new URL('/', request.nextUrl))
        return true
      }

      // Root page: allow without auth — page.tsx handles routing
      // (anon + ?view= → view mode, anon + no param → redirect to /explore)
      // Safe: all mutations are server-gated with session checks
      if (pathname === '/') {
        return true
      }

      return isLoggedIn
    },
    // On every sign-in: upsert user to Supabase profiles table
    async signIn({ user, account, profile }) {
      try {
        const sb = getServerSupabase()
        // Google uses profile.sub, Discord/GitHub use profile.id
        const rawId = profile?.sub || String(profile?.id || user.id)
        // Namespace non-Google IDs to avoid cross-provider collisions
        const userId = account?.provider === 'google' ? rawId : `${account?.provider}_${rawId}`
        // Check if user already exists — don't overwrite credits on re-login
        const { data: existing } = await sb.from('profiles').select('id').eq('id', userId).single()
        if (existing) {
          // Returning user — update provider fields only
          // DON'T overwrite avatar_url (user may have uploaded a custom one)
          await sb.from('profiles').update({
            email: user.email,
            name: user.name,
            provider: account?.provider,
            updated_at: new Date().toISOString(),
          }).eq('id', userId)
        } else {
          // New user — local mode: unlimited credits
          const freeCredits = 99999
          await sb.from('profiles').insert({
            id: userId,
            email: user.email,
            name: user.name,
            avatar_url: user.image,
            provider: account?.provider,
            credits: freeCredits || 3,
            updated_at: new Date().toISOString(),
          })
        }
      } catch (err) {
        // Don't block sign-in if DB is down — graceful degradation
        console.error('[Auth] Supabase user sync failed:', err)
      }
      return true
    },
    // Attach user id to the session so client components can use it
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const rawId = profile.sub || String(profile.id)
        // Must match the userId logic in signIn callback
        token.id = account.provider === 'google' ? rawId : `${account.provider}_${rawId}`
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string
      }
      return session
    },
  },
})
