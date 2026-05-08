import { describe, expect, it } from 'vitest'

import {
  A2UI_V09_BASIC_CATALOG_ID,
  materializeA2UIToSpatialWeb,
  parseA2UIEnvelopes,
} from '../a2ui-spatial-adapter'

const officialStyleStream = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 'rsvp',
      catalogId: A2UI_V09_BASIC_CATALOG_ID,
      theme: { primaryColor: '#22c55e' },
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: 'rsvp',
      path: '/',
      value: {
        name: 'Lina',
        vibe: ['code-jam'],
        coming: true,
        headcount: 2,
      },
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'rsvp',
      components: [
        { id: 'root', component: 'Column', children: ['title', 'name', 'coming', 'vibe', 'headcount', 'submit'] },
        { id: 'title', component: 'Text', text: 'Medellin coffee RSVP', variant: 'h2' },
        { id: 'name', component: 'TextField', label: 'Name', value: { path: '/name' } },
        { id: 'coming', component: 'CheckBox', label: 'Can come?', value: { path: '/coming' } },
        {
          id: 'vibe',
          component: 'ChoicePicker',
          label: 'Vibe',
          variant: 'mutuallyExclusive',
          options: [
            { label: 'Chill', value: 'chill' },
            { label: 'Code jam', value: 'code-jam' },
          ],
          value: { path: '/vibe' },
        },
        { id: 'headcount', component: 'Slider', label: 'Headcount', min: 1, max: 8, value: { path: '/headcount' } },
        { id: 'submit-label', component: 'Text', text: 'Send RSVP' },
        { id: 'submit', component: 'Button', child: 'submit-label', action: { event: { name: 'submit_rsvp' } } },
      ],
    },
  },
]

describe('parseA2UIEnvelopes', () => {
  it('parses JSONL A2UI messages', () => {
    const jsonl = officialStyleStream.map(entry => JSON.stringify(entry)).join('\n')

    expect(parseA2UIEnvelopes(jsonl)).toHaveLength(3)
  })

  it('normalizes legacy surfaceUpdate/dataModelUpdate envelopes', () => {
    const envelopes = parseA2UIEnvelopes([
      { surfaceUpdate: { surfaceId: 'legacy', components: [{ id: 'root', component: 'Text', text: 'Hi' }] } },
      { dataModelUpdate: { surfaceId: 'legacy', path: '/', contents: { ok: true } } },
    ])

    expect(envelopes[0]).toHaveProperty('updateComponents')
    expect(envelopes[1]).toHaveProperty('updateDataModel')
  })
})

describe('materializeA2UIToSpatialWeb', () => {
  it('maps core A2UI controls to Oasis spatial web objects', () => {
    const result = materializeA2UIToSpatialWeb(officialStyleStream)

    expect(result.surfaceId).toBe('rsvp')
    expect(result.unsupportedComponents).toEqual([])
    expect(result.spatialWebObjects.map(object => object.type)).toEqual([
      'output',
      'text',
      'toggle',
      'select',
      'slider',
      'button',
    ])
    expect(result.spatialWebObjects.find(object => object.id.endsWith('name'))).toMatchObject({
      label: 'Name',
      value: 'Lina',
    })
    expect(result.spatialWebObjects.find(object => object.id.endsWith('submit'))?.action).toMatchObject({
      type: 'submit_form',
    })
  })

  it('maps media components to existing Oasis media placements', () => {
    const result = materializeA2UIToSpatialWeb([
      {
        createSurface: { surfaceId: 'media', catalogId: A2UI_V09_BASIC_CATALOG_ID },
      },
      {
        updateComponents: {
          surfaceId: 'media',
          components: [
            { id: 'root', component: 'Column', children: ['hero', 'clip', 'track', 'glyph'] },
            { id: 'hero', component: 'Image', url: 'https://example.com/coffee.png' },
            { id: 'clip', component: 'Video', url: 'https://example.com/demo.mp4' },
            { id: 'track', component: 'AudioPlayer', url: 'https://example.com/song.mp3' },
            { id: 'glyph', component: 'Icon', name: 'coffee' },
          ],
        },
      },
    ])

    expect(result.unsupportedComponents).toEqual([])
    expect(result.catalogPlacements).toHaveLength(3)
    expect(result.catalogPlacements.map(placement => placement.catalogId)).toEqual(['a2ui-image', 'a2ui-video', 'a2ui-audio'])
    expect(result.catalogPlacements[0]).toMatchObject({ imageUrl: 'https://example.com/coffee.png' })
    expect(result.catalogPlacements[1]).toMatchObject({ videoUrl: 'https://example.com/demo.mp4' })
    expect(result.catalogPlacements[2]).toMatchObject({ audioUrl: 'https://example.com/song.mp3' })
    expect(result.behaviors[result.catalogPlacements[2].id]).toMatchObject({
      audioUrl: 'https://example.com/song.mp3',
      audioState: 'paused',
    })
    expect(result.spatialWebObjects.find(object => object.id.endsWith('glyph'))).toMatchObject({
      type: 'output',
      value: 'coffee',
    })
  })
})
