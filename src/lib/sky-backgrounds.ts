export const SKY_BACKGROUNDS = [
  { id: 'stars', name: 'Procedural Stars', path: null },
  { id: 'night001', name: 'Night Sky 001', path: '/hdri/NightSkyHDRI001_4K_TONEMAPPED.jpg' },
  { id: 'night004', name: 'Night Sky 004', path: '/hdri/NightSkyHDRI004_4K_TONEMAPPED.jpg' },
  { id: 'night007', name: 'Night Sky 007', path: '/hdri/NightSkyHDRI007_4K_TONEMAPPED.jpg' },
  { id: 'night008', name: 'Night Sky 008', path: '/hdri/NightSkyHDRI008_4K_TONEMAPPED.jpg' },
  { id: 'alps_field', name: 'Alps Field', path: '/hdri/alps_field_2k.hdr' },
  { id: 'autumn_ground', name: 'Autumn Ground', path: '/hdri/autumn_ground_2k.hdr' },
  { id: 'belfast_sunset', name: 'Belfast Sunset', path: '/hdri/belfast_sunset_puresky_2k.hdr' },
  { id: 'blue_grotto', name: 'Blue Grotto', path: '/hdri/blue_grotto_2k.hdr' },
  { id: 'evening_road', name: 'Evening Road', path: '/hdri/evening_road_01_puresky_2k.hdr' },
  { id: 'outdoor_umbrellas', name: 'Outdoor Umbrellas', path: '/hdri/outdoor_umbrellas_2k.hdr' },
  { id: 'stadium', name: 'Stadium', path: '/hdri/stadium_01_2k.hdr' },
  { id: 'sunny_vondelpark', name: 'Sunny Vondelpark', path: '/hdri/sunny_vondelpark_2k.hdr' },
  { id: 'umhlanga_sunrise', name: 'Umhlanga Sunrise', path: '/hdri/umhlanga_sunrise_2k.hdr' },
  { id: 'city', name: 'City (Potsdamer Platz)', path: null, preset: 'city' },
  { id: 'dawn', name: 'Dawn', path: null, preset: 'dawn' },
  { id: 'forest', name: 'Forest', path: null, preset: 'forest' },
  { id: 'sunset', name: 'Sunset (Venice)', path: null, preset: 'sunset' },
  { id: 'park', name: 'Park', path: null, preset: 'park' },
  { id: 'night_preset', name: 'Night (Dikhololo)', path: null, preset: 'night' },
  { id: 'studio', name: 'Studio', path: null, preset: 'studio' },
  { id: 'warehouse', name: 'Warehouse', path: null, preset: 'warehouse' },
  { id: 'apartment', name: 'Apartment (Lobby)', path: null, preset: 'apartment' },
  { id: 'lobby', name: 'Lobby (St Fagans)', path: null, preset: 'lobby' },
] as const

export const AGENT_SKY_BACKGROUND_IDS = [
  'stars',
  'night001',
  'night004',
  'night007',
  'night008',
  'alps_field',
  'autumn_ground',
  'belfast_sunset',
  'blue_grotto',
  'evening_road',
  'outdoor_umbrellas',
  'stadium',
  'sunny_vondelpark',
  'umhlanga_sunrise',
] as const

const SKY_TOOL_ALIASES: Record<string, (typeof AGENT_SKY_BACKGROUND_IDS)[number]> = {
  morning: 'umhlanga_sunrise',
  sunrise: 'umhlanga_sunrise',
  dawn: 'umhlanga_sunrise',
  warm_sunrise: 'umhlanga_sunrise',
  sunset: 'belfast_sunset',
  dusk: 'belfast_sunset',
  golden_hour: 'belfast_sunset',
  orange_sky: 'belfast_sunset',
  evening: 'evening_road',
  road: 'evening_road',
  forest: 'sunny_vondelpark',
  green: 'sunny_vondelpark',
  nature: 'sunny_vondelpark',
  park: 'sunny_vondelpark',
  vondelpark: 'sunny_vondelpark',
  autumn: 'autumn_ground',
  fall: 'autumn_ground',
  blue: 'blue_grotto',
  grotto: 'blue_grotto',
  cave: 'blue_grotto',
  city: 'stadium',
  urban: 'stadium',
  arena: 'stadium',
  studio: 'outdoor_umbrellas',
  warehouse: 'stadium',
  apartment: 'outdoor_umbrellas',
  lobby: 'outdoor_umbrellas',
  night: 'night007',
  night_preset: 'night007',
  stars: 'stars',
  starfield: 'stars',
}

export const SKY_TOOL_PRESET_IDS = [
  ...AGENT_SKY_BACKGROUND_IDS,
  ...Object.keys(SKY_TOOL_ALIASES).filter(key => !AGENT_SKY_BACKGROUND_IDS.includes(key as never)),
] as const

const AGENT_SKY_BACKGROUND_ID_SET = new Set<string>(AGENT_SKY_BACKGROUND_IDS)

function normalizeSkyToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

export function resolveSkyBackgroundToolPreset(value: unknown): {
  id: (typeof AGENT_SKY_BACKGROUND_IDS)[number]
  requestedId: string
  normalizedId: string
} | null {
  if (typeof value !== 'string') return null
  const requestedId = value.trim()
  if (!requestedId) return null
  const normalizedId = normalizeSkyToken(requestedId)
  if (AGENT_SKY_BACKGROUND_ID_SET.has(normalizedId)) {
    return { id: normalizedId as (typeof AGENT_SKY_BACKGROUND_IDS)[number], requestedId, normalizedId }
  }
  const alias = SKY_TOOL_ALIASES[normalizedId]
  return alias ? { id: alias, requestedId, normalizedId } : null
}

export function formatAgentSkyPresetGuide(): string {
  return [
    `Stable presetId values: ${AGENT_SKY_BACKGROUND_IDS.join(', ')}.`,
    'Useful aliases accepted by the server: dawn/sunrise -> umhlanga_sunrise; sunset/dusk -> belfast_sunset; forest/park -> sunny_vondelpark; city/arena -> stadium; night -> night007.',
  ].join(' ')
}
