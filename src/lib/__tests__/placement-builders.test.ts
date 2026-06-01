import { describe, expect, it } from 'vitest'

import {
  buildAudioPlacementPending,
  buildImagePlacementPending,
  buildPortalActionForPreset,
  buildPortalPlacementPending,
  buildVideoPlacementPending,
  normalizeMediaOpacity,
  portalPlacementSubtitle,
} from '@/lib/forge/placement-builders'

describe('placement builders', () => {
  it('builds image and video placement payloads with normalized opacity', () => {
    expect(buildImagePlacementPending({
      name: 'Moon gate',
      imageUrl: '/generated-images/moon.png',
      frameStyle: 'gilded',
      frameThickness: 3,
      mediaOpacity: 0.4,
    })).toMatchObject({
      type: 'image',
      name: 'Moon gate',
      imageUrl: '/generated-images/moon.png',
      imageFrameStyle: 'gilded',
      imageFrameThickness: 3,
      mediaOpacity: 0.4,
    })

    expect(buildVideoPlacementPending({
      name: 'Loop',
      videoUrl: '/uploads/loop.mp4',
      mediaOpacity: 7,
    })).toMatchObject({
      type: 'video',
      videoUrl: '/uploads/loop.mp4',
      mediaOpacity: 1,
    })

    expect(normalizeMediaOpacity(-1)).toBe(0.05)
  })

  it('builds audio speaker placement payloads with overridable defaults', () => {
    expect(buildAudioPlacementPending({
      name: 'Song',
      audioUrl: '/uploads/song.mp3',
    })).toMatchObject({
      type: 'catalog',
      catalogId: 'kf_speaker',
      path: '/models/kenney-furniture/speaker.glb',
      defaultScale: 1,
      audioUrl: '/uploads/song.mp3',
    })
  })

  it('builds portal actions and placement payloads from presets', () => {
    const selectedTarget = { id: 'world-2', name: 'Sky Room' }
    const action = buildPortalActionForPreset({
      preset: 'load_world',
      selectedTarget,
    })

    expect(action).toEqual({
      type: 'load_world',
      worldId: 'world-2',
      worldName: 'Sky Room',
    })
    expect(portalPlacementSubtitle(action, selectedTarget)).toBe('Sky Room')

    expect(buildPortalPlacementPending({
      variant: 'stargate-vortex',
      action: action!,
      selectedTarget,
    })).toMatchObject({
      type: 'portal',
      name: 'Portal to Sky Room',
      portalVariant: 'stargate-vortex',
      portalTargetWorldId: 'world-2',
      portalTargetWorldName: 'Sky Room',
      portalDirection: 'two-way',
    })
  })

  it('keeps invalid external portal presets unplaceable', () => {
    expect(buildPortalActionForPreset({
      preset: 'external_url',
      externalUrl: '   ',
    })).toBeUndefined()
  })
})
