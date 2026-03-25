// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CURATOR RL — Reinforcement Learning Context Generator
// Regenerates context/curator-rl.md from done missions in oasis.db.
// Called when a mission completes the full south loop (coder → reviewer → tester → done).
// The curator reads this file for in-context reinforcement learning.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import * as fs from 'fs/promises'
import * as path from 'path'

// Types matching the Mission model in prisma/schema.prisma
interface MissionForRL {
  id: number
  name: string
  description: string | null       // carbonDescription
  urgency: number
  easiness: number
  impact: number
  priority: number | null
  valor: number | null
  score: number | null
  actualSeconds: number | null
  reviewerScore: number | null
  testerScore: number | null
  flawlessPercent: number | null
  dharmaPath: string | null
  history: string | null
  createdAt: Date | string
}

export interface HistoryEntry {
  timestamp?: string
  actor?: string
  action?: string
  curatorMsg?: string
  silicondevMsg?: string
  silicondevConfidence?: number
  flawlessPercent?: number
  fromLevel?: number
  toLevel?: number
  verdict?: string
  rating?: number
  carbondevMsg?: string
  mature?: boolean
  carbonSeconds?: number
  comment?: string
  durationMs?: number
  reviewerScore?: number
  testerScore?: number
  testerValor?: number
}

export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function formatThread(entries: HistoryEntry[]): string {
  return entries
    .filter(e => e.actor === 'curator' || e.actor === 'carbondev')
    .map(e => {
      if (e.actor === 'curator') {
        const curator = e.curatorMsg ?? e.comment ?? e.action ?? ''
        const silicon = e.silicondevMsg ?? ''
        const conf = e.silicondevConfidence != null ? ` [conf:${e.silicondevConfidence}]` : ''
        const flawless = e.flawlessPercent != null ? ` [flawless:${e.flawlessPercent}%]` : ''
        return `  📋 curator: "${curator}"${flawless}\n  🤖 silicondev: "${silicon}"${conf}`
      }
      if (e.actor === 'carbondev') {
        const verdict = e.verdict ? `[${e.verdict.toUpperCase()}]` : ''
        const rating = e.rating != null ? `rating:${e.rating}` : ''
        const matured = e.mature != null ? (e.mature ? 'BUMP' : 'REFINE') : ''
        const secs = e.carbonSeconds != null ? `${e.carbonSeconds}s` : ''
        const msg = e.carbondevMsg ? ` "${e.carbondevMsg}"` : ''
        return `  👤 carbondev: ${verdict} ${rating} | ${matured} | ${secs}${msg}`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function formatMission(m: MissionForRL): string {
  const entries = parseHistory(m.history)
  const thread = formatThread(entries)

  const totalCarbonSec = entries
    .filter(e => e.actor === 'carbondev' && e.carbonSeconds != null)
    .reduce((sum, e) => sum + (e.carbonSeconds ?? 0), 0)

  const maturationRounds = entries.filter(e => e.actor === 'curator' && e.action === 'mature').length

  const created = typeof m.createdAt === 'string' ? m.createdAt.split('T')[0] : m.createdAt.toISOString().split('T')[0]

  const lines = [
    `### #${m.id}: "${m.name}"`,
    `- UEI: U${m.urgency} E${m.easiness} I${m.impact} | Pri: ${m.priority?.toFixed(2) ?? '?'} | Valor: ${m.valor ?? '?'} | Score: ${m.score?.toFixed(1) ?? '?'}`,
  ]

  if (m.dharmaPath) lines.push(`- Dharma: ${m.dharmaPath}`)

  lines.push(`- Carbon: "${m.description ?? ''}"`)
  lines.push(`- Flawless: ${m.flawlessPercent ?? '?'}% | Reviewer: ${m.reviewerScore ?? '?'}/100 | Tester: ${m.testerScore ?? '?'}% | CarbonSec: ${totalCarbonSec}`)
  lines.push(`- Maturation: ${maturationRounds} round${maturationRounds !== 1 ? 's' : ''} | Created: ${created}`)

  if (thread) {
    lines.push('- Thread:')
    lines.push(thread)
  }

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════
// REGENERATE — called on mission completion
// ═══════════════════════════════════════════════════════════════════════════

export async function regenerateCuratorRL(
  missions: MissionForRL[],
  outputDir: string = path.resolve(process.cwd(), 'context'),
): Promise<{ missionsIncluded: number; tokensEstimate: number }> {
  await fs.mkdir(outputDir, { recursive: true })
  const rlFile = path.join(outputDir, 'curator-rl.md')

  if (missions.length === 0) {
    await fs.writeFile(rlFile, '## RL Signal — No Done Missions Yet\n\nComplete missions through the full pipeline (coder → reviewer → tester) to build reinforcement context.\n', 'utf-8')
    return { missionsIncluded: 0, tokensEstimate: 0 }
  }

  const formatted = missions.map(formatMission)

  const content = `## RL Signal — Last ${missions.length} Done Missions

These are completed missions with full lifecycle data. Use them to:
- Feel patterns in what makes carbondev accept vs refine
- Calibrate flawless% predictions against actual reviewer/tester scores
- Match your silicondev voice to what carbondev actually says
- Understand which codebase areas have higher failure rates

${formatted.join('\n\n')}
`

  await fs.writeFile(rlFile, content, 'utf-8')
  const tokensEstimate = Math.round(content.length / 4)

  return { missionsIncluded: missions.length, tokensEstimate }
}
