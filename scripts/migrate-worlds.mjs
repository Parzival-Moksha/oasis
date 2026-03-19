#!/usr/bin/env node
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — One-time migration: JSON file worlds → Supabase
// Run: node scripts/migrate-worlds.mjs
//
// Reads data/worlds/registry.json + each world JSON file,
// inserts them into the Supabase 'worlds' table for a given user.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

// Load .env manually (no dotenv dependency)
const envFile = readFileSync(join(process.cwd(), '.env'), 'utf-8')
for (const line of envFile.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx)
  const val = trimmed.slice(eqIdx + 1)
  if (!process.env[key]) process.env[key] = val
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Get user ID — use the first profile in the DB (you)
const { data: profiles } = await sb.from('profiles').select('id, name').limit(1)
if (!profiles || profiles.length === 0) {
  console.error('No profiles found in Supabase. Sign in first to create your profile.')
  process.exit(1)
}
const USER_ID = profiles[0].id
console.log(`Migrating worlds for user: ${profiles[0].name} (${USER_ID})`)

const DATA_DIR = join(process.cwd(), 'data', 'worlds')
const REGISTRY_PATH = join(DATA_DIR, 'registry.json')

if (!existsSync(REGISTRY_PATH)) {
  console.error('No registry.json found at', REGISTRY_PATH)
  process.exit(1)
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'))
console.log(`Found ${registry.length} worlds in registry`)

// Check which worlds already exist in Supabase (skip duplicates)
const { data: existingWorlds } = await sb
  .from('worlds')
  .select('id')
  .eq('user_id', USER_ID)
const existingIds = new Set((existingWorlds || []).map(w => w.id))

let migrated = 0
let skipped = 0

for (const meta of registry) {
  if (existingIds.has(meta.id)) {
    console.log(`  SKIP ${meta.id} "${meta.name}" (already exists)`)
    skipped++
    continue
  }

  const worldPath = join(DATA_DIR, `${meta.id}.json`)
  let worldData = null

  if (existsSync(worldPath)) {
    try {
      worldData = JSON.parse(readFileSync(worldPath, 'utf-8'))
    } catch (err) {
      console.error(`  ERROR reading ${meta.id}:`, err.message)
      continue
    }
  }

  const { error } = await sb.from('worlds').insert({
    id: meta.id,
    user_id: USER_ID,
    name: meta.name,
    icon: meta.icon || '🌍',
    data: worldData,
    created_at: meta.createdAt,
    updated_at: meta.lastSavedAt,
  })

  if (error) {
    console.error(`  ERROR inserting ${meta.id}:`, error.message)
  } else {
    console.log(`  ✓ ${meta.id} "${meta.name}" ${meta.icon}`)
    migrated++
  }
}

console.log(`\nDone! Migrated: ${migrated}, Skipped: ${skipped}, Total: ${registry.length}`)
