import { describe, expect, it } from 'vitest'

import { galleryScenes } from '../../components/forge/CraftedGallery'
import type { CraftedScene } from '../conjure/types'

const scene = (id: string, createdAt: string, objects = 3): CraftedScene => ({
  id, name: id, prompt: id, position: [0, 0, 0], createdAt,
  objects: Array.from({ length: objects }, () => ({ type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#fff' })) as CraftedScene['objects'],
})

describe('the crafted gallery', () => {
  it('shows this world first, then the library, newest first, each scene once, none empty', () => {
    const world = [scene('south-wall', '2026-11-01'), scene('north-wall', '2026-11-03')]
    const library = [scene('tower', '2026-11-10'), scene('south-wall', '2026-11-01'), scene('empty', '2026-11-12', 0)]
    expect(galleryScenes(world, library).map(item => `${item.scene.id}${item.inWorld ? '*' : ''}`)).toEqual(['north-wall*', 'south-wall*', 'tower'])
  })
})
