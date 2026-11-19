'use client'

// ░▒▓ RENAME — a new name for an agent the Oasis runs ▓▒░
// The engine's `rename` (index.js): the roster, its tag, its card's name line and Telegram follow the new name; its
// session, desk, home, voice, skin, schedule and history stay. Another agent's name is refused. An engine older than
// this page says so in plain words (agent-engine-client.ts).

import { useEffect, useState } from 'react'

import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { showNotice } from '../forge/GlobalNotice'

const HEADING = 'mb-1 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-white/55'
export const RENAME_MAX = 40

export function RenameSection({ agentId, name }: { agentId: string; name: string }) {
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Renamed elsewhere (Anorak, another tab): show the new name.
  useEffect(() => { setDraft(name) }, [name])

  const next = draft.replace(/\s+/g, ' ').trim()
  const changed = next.length > 0 && next !== name

  const save = async () => {
    if (!changed || saving) return
    setSaving(true)
    setError(null)
    try {
      await getAgentEngineClient().rename(agentId, next)
      showNotice(`${name} is now called ${next}.`, 'info')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-3" data-agent-rename>
      <div className={HEADING}>Name</div>
      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          maxLength={RENAME_MAX}
          aria-label="Agent name"
          data-agent-rename-input
          onChange={event => { setDraft(event.target.value); setError(null) }}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); void save() }
            if (event.key === 'Escape' && changed) { event.preventDefault(); event.stopPropagation(); setDraft(name) }
          }}
          className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[12px] text-white outline-none focus:border-cyan-300/60"
        />
        <button
          type="button"
          data-agent-rename-save
          disabled={!changed || saving}
          onClick={() => void save()}
          className="shrink-0 rounded-md border border-cyan-300/40 bg-cyan-400/15 px-2 py-1 text-[11px] font-bold text-cyan-50 transition hover:bg-cyan-400/30 disabled:opacity-40"
          title="Give this agent the new name: its session, desk, voice, look and history stay"
        >
          {saving ? '…' : 'Rename'}
        </button>
      </div>
      {error && <div data-agent-rename-error className="mt-1 text-[10.5px] text-red-200">{error}</div>}
    </div>
  )
}
