// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CreditsTab — sketch only. Save as data/credits-stub.tsx for now.
// ─═̷─═̷─📜─═̷─═̷─ Reads data/credits.json and renders per-category sections ─═̷─═̷─📜─═̷─═̷─
// When wiring this up: move into src/components/ and import the JSON
// directly (Next can ingest JSON via tsconfig resolveJsonModule), or
// expose via a /api/credits route if you want to hot-reload from disk.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import creditsData from '../data/credits.json'

// ═══════════════════════════════════════════════════════════════════════════
// Types — mirror the schema in data/credits.json
// ═══════════════════════════════════════════════════════════════════════════
type CategoryKey =
  | 'sound'
  | 'textures'
  | 'hdri'
  | 'models'
  | 'avatars'
  | 'animations'
  | 'fonts'
  | 'ai-generated-art'
  | 'user-generated'

interface CreditEntry {
  id: string
  title: string
  author: string
  authorUrl: string | null
  sourceUrl: string | null
  license: string
  licenseUrl: string | null
  attributionRequired: boolean
  usedIn: string[]
  notes?: string
}

interface CreditsData {
  schemaVersion: number
  generatedAt: string
  summary: {
    totalEntries: number
    thirdPartyProjects: number
    attributionStrictlyRequired: number
    notes: string
  }
  categories: Record<CategoryKey, CreditEntry[]>
}

const credits = creditsData as unknown as CreditsData

// ═══════════════════════════════════════════════════════════════════════════
// CreditsTab — renders the canonical attribution list for the in-game menu
// ═══════════════════════════════════════════════════════════════════════════
export function CreditsTab() {
  const categoryOrder: { key: CategoryKey; label: string }[] = [
    { key: 'sound', label: 'Sound' },
    { key: 'textures', label: 'Textures' },
    { key: 'hdri', label: 'HDRI' },
    { key: 'models', label: '3D Models' },
    { key: 'avatars', label: 'Avatars' },
    { key: 'animations', label: 'Animations' },
    { key: 'fonts', label: 'Fonts' },
    { key: 'ai-generated-art', label: 'AI-generated art' },
    // intentionally skip 'user-generated' in the public credits view
  ]

  return (
    <div className="credits-tab text-sm text-zinc-200 space-y-6 p-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Credits</h1>
        <p className="text-zinc-400">
          {credits.summary.totalEntries} catalog entries across{' '}
          {credits.summary.thirdPartyProjects} third-party projects. Generated{' '}
          {credits.generatedAt}.
        </p>
        <p className="text-xs text-zinc-500">{credits.summary.notes}</p>
      </header>

      {categoryOrder.map(({ key, label }) => {
        const entries = credits.categories[key] ?? []
        if (entries.length === 0) return null
        return <CategoryBlock key={key} label={label} entries={entries} />
      })}

      <footer className="pt-4 text-xs text-zinc-500 border-t border-zinc-800">
        Want to credit yourself for an asset? Edit{' '}
        <code>data/credits.json</code> and the in-game tab updates on next reload.
      </footer>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CategoryBlock — one section per category
// ═══════════════════════════════════════════════════════════════════════════
function CategoryBlock({
  label,
  entries,
}: {
  label: string
  entries: CreditEntry[]
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium text-zinc-100">{label}</h2>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <CreditRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CreditRow — one entry
// ═══════════════════════════════════════════════════════════════════════════
function CreditRow({ entry }: { entry: CreditEntry }) {
  return (
    <li className="rounded border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-zinc-100">
          {entry.sourceUrl ? (
            <a
              href={entry.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-300 hover:underline"
            >
              {entry.title}
            </a>
          ) : (
            entry.title
          )}
        </span>
        <span className="text-zinc-500">by</span>
        <span className="text-zinc-300">
          {entry.authorUrl ? (
            <a
              href={entry.authorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {entry.author}
            </a>
          ) : (
            entry.author
          )}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap gap-2 text-xs">
        <span className="text-zinc-500">License:</span>
        <span className="text-zinc-300">
          {entry.licenseUrl ? (
            <a
              href={entry.licenseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-300 hover:underline"
            >
              {entry.license}
            </a>
          ) : (
            entry.license
          )}
        </span>
        {entry.attributionRequired && (
          <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-700/40 text-amber-200">
            attribution required
          </span>
        )}
      </div>

      {entry.notes && (
        <p className="mt-1 text-xs text-zinc-400">{entry.notes}</p>
      )}

      {entry.usedIn.length > 0 && (
        <details className="mt-1 text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300">
            {entry.usedIn.length} file path{entry.usedIn.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1 ml-3 list-disc space-y-0.5">
            {entry.usedIn.map((path) => (
              <li key={path}>
                <code className="text-[10px]">{path}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

export default CreditsTab
