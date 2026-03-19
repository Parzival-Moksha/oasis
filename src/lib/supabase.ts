// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Supabase Client
// Two clients: server (god-mode, service role) and browser (anon, RLS)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ═══════════════════════════════════════════════════════════════════════════
// SERVER CLIENT — uses service_role key, bypasses Row Level Security.
// ONLY use in API routes / server components. Never expose to browser.
// ═══════════════════════════════════════════════════════════════════════════

let _serverClient: SupabaseClient | null = null

export function getServerSupabase(): SupabaseClient {
  if (_serverClient) return _serverClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  _serverClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _serverClient
}

// ═══════════════════════════════════════════════════════════════════════════
// BROWSER CLIENT — uses anon key, respects Row Level Security.
// Safe to use in client components.
// ═══════════════════════════════════════════════════════════════════════════

let _browserClient: SupabaseClient | null = null

export function getBrowserSupabase(): SupabaseClient {
  if (_browserClient) return _browserClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  _browserClient = createClient(url, key)
  return _browserClient
}
