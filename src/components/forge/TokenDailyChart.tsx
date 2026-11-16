'use client'

// ░▒▓ TOKEN DAILY CHART — the daily token burn, split by model family ▓▒░
// One bar a day (output + fresh input; cache re-reads stay out, as on the score), stacked Opus / Fable / Sonnet /
// Haiku / other so the balance between them shows. A day runs 04:20 to 04:20 like the work counter. Hover a
// bar for its numbers; the legend gives each family's total for the period. Colours: the validated dark
// categorical palette in fixed order (blue, orange, aqua, yellow, magenta), 2 px surface gaps between segments,
// the top rounded at the data end.

import { useState } from 'react'

export type Family = 'opus' | 'fable' | 'sonnet' | 'haiku' | 'other'
export interface ChartDay {
  day: string
  families: Record<Family, { output: number; input: number }>
  total: number
  future?: boolean
}

export const FAMILY_ORDER: Family[] = ['opus', 'fable', 'sonnet', 'haiku', 'other']
export const FAMILY_COLOR: Record<Family, string> = { opus: '#3987e5', fable: '#d95926', sonnet: '#199e70', haiku: '#c98500', other: '#d55181' }
export const FAMILY_LABEL: Record<Family, string> = { opus: 'Opus', fable: 'Fable', sonnet: 'Sonnet', haiku: 'Haiku', other: 'Other' }

function fmt(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 1 : 2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K`
  return String(Math.round(value))
}

function dayLabel(day: string, style: 'week' | 'month'): string {
  const d = new Date(`${day}T12:00:00`)
  return style === 'week' ? d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2) : String(d.getDate())
}

export function TokenDailyChart({ title, days, style, height = 64 }: { title: string; days: ChartDay[]; style: 'week' | 'month'; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...days.map(d => d.total))
  const totals = Object.fromEntries(FAMILY_ORDER.map(f => [f, days.reduce((sum, d) => sum + d.families[f].output + d.families[f].input, 0)])) as Record<Family, number>
  const families = FAMILY_ORDER.filter(f => totals[f] > 0)
  const periodTotal = days.reduce((sum, d) => sum + d.total, 0)
  const gap = style === 'week' ? 6 : 2
  const hovered = hover !== null ? days[hover] : null

  return (
    <div className="mt-3" data-token-chart={style}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-amber-200/80">{title}</span>
        <span className="font-mono text-[11px] text-white/70">{fmt(periodTotal)} <span className="text-white/45">· peak {fmt(max)}/day</span></span>
      </div>
      <div className="relative mt-1.5" onMouseLeave={() => setHover(null)}>
        {/* hairline at the peak, baseline below: recessive chrome */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t" style={{ borderColor: '#2c2c2a' }} />
        <div className="flex items-end" style={{ height, gap }}>
          {days.map((d, i) => {
            const shown = FAMILY_ORDER.filter(f => d.families[f].output + d.families[f].input > 0)
            return (
              <div
                key={d.day}
                className="flex h-full min-w-0 flex-1 flex-col-reverse"
                style={{ gap: 2 }}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={d.future ? -1 : 0}
                aria-label={`${d.day}: ${fmt(d.total)} tokens${shown.map(f => `, ${FAMILY_LABEL[f]} ${fmt(d.families[f].output + d.families[f].input)}`).join('')}`}
              >
                {d.future
                  ? <div className="w-full rounded-sm border border-dashed" style={{ height: 6, borderColor: '#383835' }} />
                  : shown.map((f, j) => {
                    const value = d.families[f].output + d.families[f].input
                    const top = j === shown.length - 1
                    return (
                      <div
                        key={f}
                        style={{
                          height: Math.max(1, (value / max) * (height - 2 * (shown.length - 1))),
                          background: FAMILY_COLOR[f],
                          borderRadius: top ? (style === 'week' ? '4px 4px 0 0' : '2px 2px 0 0') : 0,
                          opacity: hover === null || hover === i ? 1 : 0.55,
                        }}
                      />
                    )
                  })}
              </div>
            )
          })}
        </div>
        <div className="border-t" style={{ borderColor: '#383835' }} />
        <div className="mt-0.5 flex" style={{ gap }}>
          {days.map((d, i) => (
            <span key={d.day} className="min-w-0 flex-1 text-center font-mono text-[8.5px] text-white/45">
              {style === 'week' || [0, 4, 9, 14, 19, 24, 29].includes(i) ? dayLabel(d.day, style) : ''}
            </span>
          ))}
        </div>
        {hovered && !hovered.future && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-white/15 bg-black/95 px-2 py-1.5 text-[10px] text-white shadow-lg"
            style={{ bottom: height + 18, left: `${Math.min(36, Math.max(0, ((hover as number) / days.length) * 100 - 20))}%`, minWidth: 196 }}
            data-token-tooltip
          >
            <div className="font-bold">{new Date(`${hovered.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmt(hovered.total)}</div>
            {FAMILY_ORDER.filter(f => hovered.families[f].output + hovered.families[f].input > 0).map(f => (
              <div key={f} className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: FAMILY_COLOR[f] }} />
                <span className="w-11 text-white/80">{FAMILY_LABEL[f]}</span>
                <span className="font-mono text-white/90">{fmt(hovered.families[f].output)}</span>
                <span className="text-white/45">written · {fmt(hovered.families[f].input)} in</span>
              </div>
            ))}
            {hovered.total === 0 && <div className="mt-0.5 text-white/55">nothing that day</div>}
          </div>
        )}
      </div>
      {/* legend: always there for two or more families; the text in ink, the swatch carries the colour */}
      <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-white/70">
        {families.map(f => (
          <span key={f} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: FAMILY_COLOR[f] }} />
            {FAMILY_LABEL[f]} <span className="font-mono text-white/90">{fmt(totals[f])}</span>
          </span>
        ))}
        {!families.length && <span className="text-white/45">no tokens in this period</span>}
      </div>
    </div>
  )
}
