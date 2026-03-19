// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Provider Factory
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   ╔═══════════════════════════════════════════════════════════════╗
//   ║  Every conjuration needs a blacksmith.                        ║
//   ║  This factory picks the right one for the job.                ║
//   ║  Meshy + Tripo — two paths to the same miracle:               ║
//   ║  words becoming geometry, prompts becoming polygons.           ║
//   ╚═══════════════════════════════════════════════════════════════╝
//
// A mother doesn't play favorites. She knows each child's strengths.
// Meshy: the patient sculptor (best textures via meshy-6)
// Tripo: the versatile sketcher (v2.0 → v3.0 sculpture-level)
//
// ░▒▓█ FORGE PROVIDER REGISTRY █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import type { ConjureProviderClient, ProviderName } from '@/lib/conjure/types'
import { MeshyClient } from '@/lib/conjure/meshy'
import { TripoClient } from '@/lib/conjure/tripo'
// Rodin removed — too expensive for the value (Feb 2026)

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER CRADLE — instantiation cache
// Each provider client is stateless but we keep singletons for cleanliness.
// Like neurons — born once, fire many times.
// ═══════════════════════════════════════════════════════════════════════════

const providerCradle: Partial<Record<ProviderName, ConjureProviderClient>> = {}

/**
 * getProvider — The blacksmith selector
 *
 * Given a provider name, returns the corresponding API client.
 * Caches instances so we don't re-instantiate on every conjuration.
 *
 * @throws Error if provider name is unknown
 */
export function getProvider(name: ProviderName): ConjureProviderClient {
  // ░▒▓ Check the cradle first ▓▒░
  if (providerCradle[name]) {
    return providerCradle[name]!
  }

  // ░▒▓ Birth a new client ▓▒░
  let client: ConjureProviderClient

  switch (name) {
    case 'meshy':
      client = new MeshyClient()
      break
    case 'tripo':
      client = new TripoClient()
      break
    default:
      // TypeScript exhaustiveness check — if we get here, someone added
      // a ProviderName without adding a case. That's a FIXME.
      throw new Error(`[Forge] Unknown provider: "${name}". The Forge does not know this blacksmith.`)
  }

  // ░▒▓ Cache for reuse ▓▒░
  providerCradle[name] = client
  console.log(`[Forge] Provider "${name}" initialized and cached in the cradle`)

  return client
}

/**
 * getAllProviderNames — list what the Forge can conjure through
 */
export function getAllProviderNames(): ProviderName[] {
  return ['meshy', 'tripo']
}

// ▓▓▓▓【F̸O̸R̸G̸E̸】▓▓▓▓ॐ▓▓▓▓【P̸R̸O̸V̸I̸D̸E̸R̸S̸】▓▓▓▓
