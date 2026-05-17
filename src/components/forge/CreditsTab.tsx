'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CREDITS TAB — reads data/credits.json, renders per-category attribution
// ─═̷─═̷─📜─═̷─═̷─ Every voice, model, texture, font on the page  ─═̷─═̷─📜─═̷─═̷─
// Edit data/credits.json to refresh — the tab re-reads on next mount.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState } from 'react'
import creditsData from '../../../data/credits.json'

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

const CATEGORY_ORDER: { key: CategoryKey; label: string }[] = [
  { key: 'sound', label: 'Sound' },
  { key: 'textures', label: 'Textures' },
  { key: 'hdri', label: 'HDRI' },
  { key: 'models', label: '3D Models' },
  { key: 'avatars', label: 'Avatars' },
  { key: 'animations', label: 'Animations' },
  { key: 'fonts', label: 'Fonts' },
  { key: 'ai-generated-art', label: 'AI-generated art' },
]

export function CreditsTab() {
  return (
    <div className="space-y-3 text-[11px] text-gray-300">
      <header className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-purple-300 font-bold">
          Attribution Manifest
        </p>
        <p className="text-gray-400 leading-relaxed">
          {credits.summary.totalEntries} entries · {credits.summary.thirdPartyProjects} third-party projects
          · {credits.summary.attributionStrictlyRequired} require attribution
        </p>
        <p className="text-[10px] text-gray-500 leading-relaxed">{credits.summary.notes}</p>
      </header>

      {CATEGORY_ORDER.map(({ key, label }) => {
        const entries = credits.categories[key] ?? []
        if (entries.length === 0) return null
        return <CategoryBlock key={key} label={label} entries={entries} />
      })}

      <footer className="pt-2 text-[9px] text-gray-500 border-t border-white/5 leading-relaxed">
        Generated {credits.generatedAt}. Edit <code className="text-gray-400">data/credits.json</code> to refresh.
      </footer>
    </div>
  )
}

function CategoryBlock({ label, entries }: { label: string; entries: CreditEntry[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded border border-white/5 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-white/[0.04] transition-colors text-left"
      >
        <span className="text-[11px] font-bold text-white/85">
          {open ? '▼' : '▸'} {label}
        </span>
        <span className="text-[9px] text-gray-500">{entries.length}</span>
      </button>
      {open && (
        <ul className="space-y-1.5 px-2 pb-2 pt-1">
          {entries.map(entry => <CreditRow key={entry.id} entry={entry} />)}
        </ul>
      )}
    </section>
  )
}

function CreditRow({ entry }: { entry: CreditEntry }) {
  return (
    <li className="rounded border border-white/5 bg-black/30 px-2 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-medium text-gray-100">
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
        <span className="text-gray-500 text-[10px]">by</span>
        <span className="text-gray-300 text-[10px]">
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

      <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5 text-[10px]">
        <span className="text-gray-500">License:</span>
        <span className="text-gray-300">
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
          <span className="px-1 py-0.5 rounded bg-amber-700/30 text-amber-200 text-[9px]">
            attribution required
          </span>
        )}
      </div>

      {entry.notes && (
        <p className="mt-0.5 text-[10px] text-gray-400 leading-relaxed">{entry.notes}</p>
      )}
    </li>
  )
}

export default CreditsTab
