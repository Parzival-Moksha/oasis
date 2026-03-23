// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MIGRATE oasisspec3.txt → Parzival Akasha missions
// Run: npx tsx scripts/migrate-oasisspec3.ts
// Requires: Parzival running at localhost:4517
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import * as fs from 'fs'
import * as path from 'path'

const PARZIVAL_URL = process.env.PARZIVAL_URL || 'http://localhost:4517'
const SPEC_PATH = path.resolve(import.meta.dirname, '../carbondir/oasisspec3.txt')

interface ParsedMission {
  name: string
  description: string
  questName: string
  phase: string
}

function parseOasisSpec(content: string): ParsedMission[] {
  const missions: ParsedMission[] = []
  let currentPhase = ''
  let currentQuest = ''

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // Phase headers
    const phaseMatch = trimmed.match(/^## ░▒▓█ (.+) █▓▒░$/)
    if (phaseMatch) {
      currentPhase = phaseMatch[1]
      continue
    }

    // Quest/section headers
    const questMatch = trimmed.match(/^### (.+?)(?:\s*—.*)?$/)
    if (questMatch) {
      currentQuest = questMatch[1].replace(/\s*✅$/, '').trim()
      continue
    }

    // Skip checked items
    if (trimmed.startsWith('- [x]') || trimmed.includes('✅')) continue

    // Unchecked items → missions
    const unchecked = trimmed.match(/^- \[ \] (.+)$/)
    if (unchecked) {
      const text = unchecked[1].trim()
      missions.push({
        name: text.length > 80 ? text.substring(0, 77) + '...' : text,
        description: text,
        questName: currentQuest,
        phase: currentPhase,
      })
      continue
    }

    // Bare text lines in backlog sections (no checkbox)
    if (currentPhase.includes('FEATURES') || currentPhase.includes('OLDER BUGS') || currentPhase.includes('freshbugs')) {
      const isNoise = /^[-═░▓█╔╚║╗╝╠╣│┌┐└┘─┼*>]/.test(trimmed)
        || /^\d+\./.test(trimmed) // numbered lists
        || trimmed.startsWith('#')
        || trimmed.startsWith('http')
        || trimmed.startsWith('$')
        || trimmed.length <= 5
      if (trimmed && !isNoise) {
        missions.push({
          name: trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed,
          description: trimmed,
          questName: currentPhase,
          phase: currentPhase,
        })
      }
    }
  }

  return missions
}

async function createMission(mission: ParsedMission): Promise<boolean> {
  try {
    const res = await fetch(`${PARZIVAL_URL}/api/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: mission.name,
        description: mission.description,
        maturityLevel: 0,
        assignedTo: 'dev',
        dharma: null,
        questName: mission.questName || undefined,
      }),
    })
    if (!res.ok) {
      console.error(`  ❌ Failed: ${mission.name} — ${res.status}`)
      return false
    }
    const data = await res.json()
    console.log(`  ✅ #${data.data?.id ?? data.id ?? '?'} ${mission.name}`)
    return true
  } catch (e) {
    console.error(`  ❌ Failed: ${mission.name} — ${e instanceof Error ? e.message : e}`)
    return false
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════╗')
  console.log('║  oasisspec3 → Akasha Migration                ║')
  console.log('╚═══════════════════════════════════════════════╝')

  // Check Parzival is running
  try {
    const health = await fetch(`${PARZIVAL_URL}/api/health`)
    if (!health.ok) throw new Error(`HTTP ${health.status}`)
    console.log(`\n✅ Parzival online at ${PARZIVAL_URL}`)
  } catch {
    console.error(`\n❌ Parzival offline at ${PARZIVAL_URL}`)
    console.error('   Run: cd c:/ae_parzival && pnpm dev')
    process.exit(1)
  }

  // Read and parse spec
  const content = fs.readFileSync(SPEC_PATH, 'utf-8')
  const missions = parseOasisSpec(content)

  console.log(`\n📋 Found ${missions.length} unchecked missions to migrate:\n`)

  // Group by phase for display
  const byPhase = new Map<string, ParsedMission[]>()
  for (const m of missions) {
    const phase = m.phase || 'UNPHASED'
    if (!byPhase.has(phase)) byPhase.set(phase, [])
    byPhase.get(phase)!.push(m)
  }

  for (const [phase, phaseMissions] of byPhase) {
    console.log(`\n── ${phase} (${phaseMissions.length}) ──`)
    for (const m of phaseMissions) {
      console.log(`  • ${m.name}`)
    }
  }

  // Confirm
  console.log(`\n🚀 Creating ${missions.length} missions in Akasha...\n`)

  let created = 0
  let failed = 0
  for (const m of missions) {
    const ok = await createMission(m)
    if (ok) created++
    else failed++
  }

  console.log(`\n╔═══════════════════════════════════════════════╗`)
  console.log(`║  Migration Complete                           ║`)
  console.log(`║  Created: ${created}  Failed: ${failed}                    ║`)
  console.log(`╚═══════════════════════════════════════════════╝`)
}

main().catch(console.error)
