// The village page's copy of this machine's places (GET /api/village/settings), asked for once per page.
import { useEffect, useState } from 'react'

export interface VillageSettings {
  /** The lead agent's home folder; '' when this machine has none (the picker then offers no such entry). */
  anorakProCwd: string
  missionsDir: string
  grillFile: string
}

const EMPTY: VillageSettings = { anorakProCwd: process.env.NEXT_PUBLIC_ANORAK_PRO_CWD || '', missionsDir: '', grillFile: '' }
let known: VillageSettings | null = null
let asking: Promise<VillageSettings> | null = null

export function getVillageSettings(): Promise<VillageSettings> {
  if (known) return Promise.resolve(known)
  return (asking ??= fetch('/api/village/settings')
    .then(res => (res.ok ? res.json() : EMPTY) as Promise<Partial<VillageSettings>>)
    .then(value => {
      known = { ...EMPTY, ...value, anorakProCwd: EMPTY.anorakProCwd || value.anorakProCwd || '' }
      return known
    })
    .catch(() => {
      asking = null // the page server may not be up yet: ask again next time
      return EMPTY
    }))
}

export function useVillageSettings(): VillageSettings {
  const [settings, setSettings] = useState<VillageSettings>(known || EMPTY)
  useEffect(() => {
    let live = true
    void getVillageSettings().then(value => { if (live) setSettings(value) })
    return () => { live = false }
  }, [])
  return settings
}
