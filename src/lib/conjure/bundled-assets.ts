import { existsSync, statSync } from 'fs'
import { join } from 'path'

import type { ConjureAction, ConjuredAsset, ProviderName } from './types'

interface BundledConjuredAssetSeed {
  id: string
  prompt: string
  displayName?: string
  provider: ProviderName
  tier: string
  createdAt: string
  completedAt?: string
  sourceAssetId?: string
  action?: ConjureAction
  characterMode?: boolean
  generationTimeMs?: number
}

const BUNDLED_CONJURED_ASSET_SEEDS: BundledConjuredAssetSeed[] = [
  {
    id: 'conj_mm3uhazzrh34',
    prompt: 'buddhist shrine with maitreya sitting in the middle',
    displayName: 'Maitreya Shrine',
    provider: 'meshy',
    tier: 'refine',
    createdAt: '2026-02-26T19:16:55.919Z',
    completedAt: '2026-02-26T19:35:50.938Z',
    generationTimeMs: 43014,
  },
  {
    id: 'conj_mm6nig1zk5eo',
    prompt: 'image to 3D animated character',
    displayName: 'Walking Vibedev',
    provider: 'meshy',
    tier: 'animate',
    createdAt: '2026-02-28T18:25:10.343Z',
    completedAt: '2026-02-28T18:25:16.782Z',
    sourceAssetId: 'conj_mm6nh2esah11',
    action: 'animate',
    characterMode: true,
  },
  {
    id: 'conj_mn6ogn4ae05j',
    prompt: 'a modern stereo sound system',
    provider: 'tripo',
    tier: 'premium',
    createdAt: '2026-03-25T23:31:28.138Z',
    completedAt: '2026-03-25T23:33:55.591Z',
    generationTimeMs: 147453,
  },
]

function buildBundledAsset(seed: BundledConjuredAssetSeed): ConjuredAsset | null {
  const glbDiskPath = join(process.cwd(), 'public', 'conjured', `${seed.id}.glb`)
  if (!existsSync(glbDiskPath)) return null

  const thumbDiskPath = join(process.cwd(), 'public', 'conjured', `${seed.id}_thumb.jpg`)
  const stat = statSync(glbDiskPath)

  return {
    id: seed.id,
    prompt: seed.prompt,
    displayName: seed.displayName,
    provider: seed.provider,
    tier: seed.tier,
    providerTaskId: '',
    status: 'ready',
    progress: 100,
    glbPath: `/conjured/${seed.id}.glb`,
    thumbnailUrl: existsSync(thumbDiskPath) ? `/conjured/${seed.id}_thumb.jpg` : undefined,
    position: [0, 0, 0],
    scale: 1,
    rotation: [0, 0, 0],
    createdAt: seed.createdAt,
    completedAt: seed.completedAt,
    sourceAssetId: seed.sourceAssetId,
    action: seed.action,
    characterMode: seed.characterMode,
    metadata: {
      fileSizeBytes: stat.size,
      ...(seed.generationTimeMs ? { generationTimeMs: seed.generationTimeMs } : {}),
    },
  }
}

export function getBundledConjuredAssets(): ConjuredAsset[] {
  return BUNDLED_CONJURED_ASSET_SEEDS
    .map(buildBundledAsset)
    .filter((asset): asset is ConjuredAsset => !!asset)
}

export function getBundledConjuredAssetById(id: string): ConjuredAsset | undefined {
  const seed = BUNDLED_CONJURED_ASSET_SEEDS.find(asset => asset.id === id)
  return seed ? buildBundledAsset(seed) || undefined : undefined
}
