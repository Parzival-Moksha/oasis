// GET /api/local/summon-defaults — what the summon menu starts from: the home folder (for the Oasis folder a
// newcomer's agents work in) and the real Hermes homes on this machine (the installer's home, HERMES_HOME, and
// each profiles/<name> with a config.yaml), so a Hermes profile is picked, never typed.
// Local requests only (the same guard as the agent routes). Reads folder names and one config line, nothing else.

import fs from 'fs'
import os from 'os'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { hermesInstallHome, hermesModelOf, oasisWorkspace, type HermesProfile } from '@/lib/village/summon-defaults'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function readProfile(name: string, dir: string): HermesProfile | null {
  try {
    const config = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8')
    return { name, path: dir, model: hermesModelOf(config.slice(0, 64_000)) }
  } catch {
    return null
  }
}

function hermesProfiles(): { home: string; profiles: HermesProfile[] } {
  const install = hermesInstallHome(process.platform, os.homedir(), process.env.LOCALAPPDATA, path)
  const home = (process.env.HERMES_HOME || '').trim() || install
  const seen = new Set<string>()
  const profiles: HermesProfile[] = []
  const add = (profile: HermesProfile | null) => {
    if (!profile || seen.has(profile.path.toLowerCase())) return
    seen.add(profile.path.toLowerCase())
    profiles.push(profile)
  }
  for (const root of [home, install]) {
    add(readProfile('main', root))
    try {
      for (const entry of fs.readdirSync(path.join(root, 'profiles'), { withFileTypes: true })) {
        if (entry.isDirectory()) add(readProfile(entry.name, path.join(root, 'profiles', entry.name)))
      }
    } catch { /* no profiles folder */ }
  }
  return { home, profiles: profiles.slice(0, 60) }
}

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const home = os.homedir()
  return NextResponse.json({ home, workspace: oasisWorkspace(home, path), platform: process.platform, hermes: hermesProfiles() })
}
