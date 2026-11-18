// Session-list helpers for the village picker. Pure: the engine's listSessions rows in, rows out.
import type { EngineSessionMeta } from '../agent-engine-types'

/** No lead-agent folder unless this machine names one (the `anorakProCwd` setting, GET /api/village/settings). */
export const DEFAULT_ANORAK_PRO_CWD = ''

export function normalizeCwd(cwd: string | null | undefined): string {
  return (cwd || '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** Every whitespace-separated term must appear in the title, folder, prompts, id, branch or entrypoint. */
export function filterSessions(sessions: EngineSessionMeta[], query: string): EngineSessionMeta[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return sessions
  return sessions.filter(session => {
    const haystack = [
      session.title,
      session.cwd,
      session.projectDir,
      session.firstPrompt,
      session.lastPrompt,
      session.sessionId,
      session.gitBranch,
      session.entrypoint,
    ].filter(Boolean).join(' ').toLowerCase()
    return terms.every(term => haystack.includes(term))
  })
}

/** Picker suggestions: Anorak Pro (newest session in its folder) and the 5 most recent sessions. */
export function pickSuggestions(
  sessions: EngineSessionMeta[],
  anorakCwd: string = DEFAULT_ANORAK_PRO_CWD,
): { anorak: EngineSessionMeta | null; recent: EngineSessionMeta[] } {
  const target = normalizeCwd(anorakCwd)
  if (!target) return { anorak: null, recent: [...sessions].sort((a, b) => b.mtime - a.mtime).slice(0, 5) }
  const sorted = [...sessions].sort((a, b) => b.mtime - a.mtime)
  return {
    anorak: sorted.find(session => normalizeCwd(session.cwd) === target) || null,
    recent: sorted.slice(0, 5),
  }
}
