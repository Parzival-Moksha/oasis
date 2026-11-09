import { existsSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import {
  AGENT_SKY_BACKGROUND_IDS,
  SKY_BACKGROUNDS,
  SKY_TOOL_PRESET_IDS,
  resolveSkyBackgroundToolPreset,
} from '../sky-backgrounds'
import { getOasisToolSpec, prepareOasisToolArgs } from '../mcp/oasis-tool-spec.js'

const GENERATED = ['oasis_dusk', 'aurora_night', 'pastel_dawn', 'cyber_dusk', 'clear_day', 'aurora_night_sky', 'clear_day_sky']

describe('sky backgrounds', () => {
  it('ships every local sky file the registry points at', () => {
    for (const sky of SKY_BACKGROUNDS) {
      for (const file of [sky.path, 'envPath' in sky ? sky.envPath : null]) {
        if (!file) continue
        expect(existsSync(join(process.cwd(), 'public', file)), `${sky.id}: public${file}`).toBe(true)
      }
    }
  })

  it('offers every agent sky id in the picker registry', () => {
    const ids = new Set<string>(SKY_BACKGROUNDS.map(sky => sky.id))
    for (const id of AGENT_SKY_BACKGROUND_IDS) expect(ids.has(id), id).toBe(true)
  })

  it('resolves the generated skies and their aliases', () => {
    for (const id of GENERATED) expect(resolveSkyBackgroundToolPreset(id)?.id).toBe(id)
    expect(resolveSkyBackgroundToolPreset('Synthwave')?.id).toBe('cyber_dusk')
    expect(resolveSkyBackgroundToolPreset('northern lights')?.id).toBe('aurora_night')
    expect(resolveSkyBackgroundToolPreset('desert')?.id).toBe('oasis_dusk')
    expect(resolveSkyBackgroundToolPreset('sunny')?.id).toBe('clear_day')
    // existing aliases keep their old targets
    expect(resolveSkyBackgroundToolPreset('dawn')?.id).toBe('umhlanga_sunrise')
    expect(resolveSkyBackgroundToolPreset('sunset')?.id).toBe('belfast_sunset')
  })

  it('keeps the MCP set_sky schema in sync with the registry', () => {
    const schema = getOasisToolSpec('set_sky')!.inputSchema
    const newAliases = SKY_TOOL_PRESET_IDS.filter(id => ['desert', 'aurora', 'synthwave', 'neon', 'pastel', 'day', 'sunny', 'clouds'].includes(id))
    expect(newAliases.length).toBe(8)
    for (const id of [...AGENT_SKY_BACKGROUND_IDS, ...newAliases]) {
      expect(schema.safeParse({ presetId: id }).success, id).toBe(true)
    }
    expect(prepareOasisToolArgs('set_sky', { presetId: 'retrowave' }, { worldId: 'w1' })).toMatchObject({ presetId: 'cyber_dusk' })
    expect(prepareOasisToolArgs('set_sky', { presetId: 'aurora_night_sky' }, { worldId: 'w1' })).toMatchObject({ presetId: 'aurora_night_sky' })
  })
})
