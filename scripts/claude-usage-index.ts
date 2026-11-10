// Build / refresh the Claude Code token index (prisma/data/claude-usage-index.json) outside the dev
// server: the first pass over gigabytes of transcripts takes a while. Usage: npx tsx scripts/claude-usage-index.ts
import { refreshUsageIndex, summarizeUsage, totalTokens } from '../src/lib/claude-usage-index'

async function main() {
const started = Date.now()
const index = await refreshUsageIndex()
const s = summarizeUsage(index)
console.log(JSON.stringify({
  seconds: Math.round((Date.now() - started) / 1000),
  files: Object.keys(index.files).length,
  today: totalTokens(s.today),
  week: totalTokens(s.week),
  allTime: s.allTime,
  allTimeTotal: totalTokens(s.allTime),
  firstDay: s.firstDay,
  topModels: s.byModel.slice(0, 5).map(x => [x.model, totalTokens(x.counts)]),
}))
}

void main()
