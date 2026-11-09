// Generated skies (scripts/generate-skies.py, files in public/skies/): a jpg
// background drawn as-is, plus a small linear .hdr that lights the scene.
export const SKY_BACKGROUNDS = [
  { id: 'stars', name: 'Procedural Stars', path: null },
  { id: 'oasis_dusk', name: 'Oasis Dusk', path: '/skies/oasis_dusk.jpg', envPath: '/skies/oasis_dusk_env.hdr' },
  { id: 'aurora_night', name: 'Aurora Night', path: '/skies/aurora_night.jpg', envPath: '/skies/aurora_night_env.hdr' },
  { id: 'pastel_dawn', name: 'Pastel Dawn', path: '/skies/pastel_dawn.jpg', envPath: '/skies/pastel_dawn_env.hdr' },
  { id: 'cyber_dusk', name: 'Cyber Dusk', path: '/skies/cyber_dusk.jpg', envPath: '/skies/cyber_dusk_env.hdr' },
  { id: 'clear_day', name: 'Clear Day', path: '/skies/clear_day.jpg', envPath: '/skies/clear_day_env.hdr' },
  // sky-only variants: no land below the horizon, for floating worlds without a ground plane
  { id: 'aurora_night_sky', name: 'Aurora Night (sky only)', path: '/skies/aurora_night_sky.jpg', envPath: '/skies/aurora_night_sky_env.hdr' },
  { id: 'clear_day_sky', name: 'Clear Day (sky only)', path: '/skies/clear_day_sky.jpg', envPath: '/skies/clear_day_sky_env.hdr' },
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
  'oasis_dusk',
  'aurora_night',
  'pastel_dawn',
  'cyber_dusk',
  'clear_day',
  'aurora_night_sky',
  'clear_day_sky',
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
  desert: 'oasis_dusk',
  desert_sunset: 'oasis_dusk',
  dunes: 'oasis_dusk',
  oasis: 'oasis_dusk',
  aurora: 'aurora_night',
  northern_lights: 'aurora_night',
  aurora_borealis: 'aurora_night',
  pastel: 'pastel_dawn',
  pink_dawn: 'pastel_dawn',
  synthwave: 'cyber_dusk',
  retrowave: 'cyber_dusk',
  vaporwave: 'cyber_dusk',
  cyberpunk: 'cyber_dusk',
  neon: 'cyber_dusk',
  day: 'clear_day',
  daytime: 'clear_day',
  noon: 'clear_day',
  clear: 'clear_day',
  sunny: 'clear_day',
  blue_sky: 'clear_day',
  clouds: 'clear_day',
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
    'Generated Oasis skies: oasis_dusk (desert sunset over dunes), aurora_night (northern lights, stars), pastel_dawn (pink and lavender dawn, misty hills), cyber_dusk (synthwave moon, neon grid), clear_day (blue sky, cumulus); aurora_night_sky and clear_day_sky are the same skies with open sky instead of land below the horizon, for floating worlds.',
    'Useful aliases accepted by the server: dawn/sunrise -> umhlanga_sunrise; sunset/dusk -> belfast_sunset; forest/park -> sunny_vondelpark; city/arena -> stadium; night -> night007; desert -> oasis_dusk; aurora -> aurora_night; synthwave -> cyber_dusk; day/sunny -> clear_day.',
  ].join(' ')
}
