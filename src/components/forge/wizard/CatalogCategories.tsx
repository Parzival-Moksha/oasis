'use client'

// The catalog's little categories in one wrapping row, then Portals and Functional (owner, 2026-11-19 at 13:15:
// "portals and functional could become like, you know, these little categories").
// KitTabs is the big tab bar; these are small pills. Their look sits in LOOK so Hipster can swap in a kit part.

import { useKitStyle } from '@/components/ui-kit'

const LOOK = {
  row: 'flex flex-wrap gap-1',
  pill: 'rounded-full border px-2 py-[3px] text-[11px] leading-none transition-colors',
  on: 'border-white/80 bg-white/15 text-white',
  off: 'border-white/15 bg-black/25 text-white/75 hover:border-white/45 hover:text-white',
  special: 'font-semibold',
  count: 'ml-1 tabular-nums opacity-60',
}

export interface CatalogCategory { id: string; label: string; count?: number; title?: string; special?: boolean }

export function CatalogCategories({ items, active, onChange }: { items: CatalogCategory[]; active: string; onChange: (id: string) => void }) {
  const kit = useKitStyle()
  return (
    <div className={LOOK.row} data-kit-style={kit} data-wizard-catalog-categories>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          title={item.title}
          onClick={() => onChange(item.id)}
          className={`${LOOK.pill} ${active === item.id ? LOOK.on : LOOK.off} ${item.special ? LOOK.special : ''}`}
        >
          {item.label}{item.count !== undefined && <span className={LOOK.count}>{item.count}</span>}
        </button>
      ))}
    </div>
  )
}
