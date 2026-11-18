'use client'

// Settings > Agents > Wake-ups: quiet hours and the daily cap for every agent's schedule (engine schedule.js).
// Each agent's own rhythm and prompt are in its settings menu (Schedule). The engine keeps these, next to the roster,
// because it is the one that wakes the agents, with the page open or not.

import { useEffect, useState } from 'react'
import { getAgentEngineClient } from '@/lib/agent-engine-client'
import type { EngineScheduleSettings } from '@/lib/agent-engine-types'

export function WakeUpSettings() {
  const [settings, setSettings] = useState<EngineScheduleSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAgentEngineClient().scheduleSettings()
      .then(reply => setSettings((reply as { data?: { settings?: EngineScheduleSettings } })?.data?.settings || null))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const save = (patch: { quiet?: EngineScheduleSettings['quiet']; dailyCap?: number }) => {
    getAgentEngineClient().scheduleSettings(patch)
      .then(reply => { setSettings((reply as { data?: { settings?: EngineScheduleSettings } })?.data?.settings || null); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <section data-wake-settings>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Wake-ups</div>
      <div className="text-[10px] text-gray-500 mb-2">
        Agents with a schedule (their settings menu: Schedule) wake up on their own and look at what is theirs to do.
        Every wake-up spends the plan&apos;s tokens. Appointments (the Council at 16:20) always happen at their time.
      </div>
      {error && <div className="text-[11px] text-amber-300 mb-2">{error}</div>}
      {settings && (
        <>
          <label className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-sm text-gray-300">Quiet hours</span>
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={settings.quiet !== null}
                onChange={event => save({ quiet: event.target.checked ? { from: '01:00', to: '08:00' } : null })}
                aria-label="Quiet hours on"
                data-wake-quiet-on
              />
              {settings.quiet && (
                <>
                  <input type="time" value={settings.quiet.from} onChange={event => event.target.value && save({ quiet: { from: event.target.value, to: settings.quiet!.to } })} className="rounded border border-white/15 bg-black/40 px-1 py-0.5 text-white" aria-label="Quiet from" data-wake-quiet-from />
                  to
                  <input type="time" value={settings.quiet.to} onChange={event => event.target.value && save({ quiet: { from: settings.quiet!.from, to: event.target.value } })} className="rounded border border-white/15 bg-black/40 px-1 py-0.5 text-white" aria-label="Quiet until" data-wake-quiet-to />
                </>
              )}
            </span>
          </label>
          <div className="text-[10px] text-gray-500 -mt-1 mb-1">No scheduled wake-ups in these hours; one that was due goes out when they end.</div>
          <label className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-sm text-gray-300">Wake-ups per agent per day, at most</span>
            <input
              type="number"
              min={0}
              max={200}
              value={settings.dailyCap}
              onChange={event => { const n = Math.round(Number(event.target.value)); if (Number.isFinite(n) && n >= 0 && n <= 200) save({ dailyCap: n }) }}
              className="w-16 rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-right text-white"
              data-wake-cap
            />
          </label>
          <div className="text-[10px] text-gray-500 -mt-1">Counts recurring wake-ups and appointments; only the recurring ones are held back by it.</div>
        </>
      )}
    </section>
  )
}
