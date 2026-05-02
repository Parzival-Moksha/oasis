import { describe, expect, it } from 'vitest'

import { collectOpenclawMediaReferences } from '../openclaw-media-references'

describe('OpenClaw media reference collection', () => {
  it('renders screenshot captures from inline base64 instead of unreachable local URLs', () => {
    const media = collectOpenclawMediaReferences({
      format: 'jpeg',
      captureCount: 1,
      captures: [
        {
          viewId: 'current',
          format: 'jpeg',
          url: 'http://127.0.0.1:4516/merlin/screenshots/local-only.jpg',
          filePath: 'C:\\Users\\l\\.openclaw\\screenshots\\local-only.jpg',
          base64: 'abc123',
        },
      ],
      primaryCaptureUrl: 'http://127.0.0.1:4516/merlin/screenshots/local-only.jpg',
    })

    expect(media).toEqual([
      {
        mediaType: 'image',
        path: 'data:image/jpeg;base64,abc123',
      },
    ])
  })

  it('keeps existing MCP image content blocks working', () => {
    const media = collectOpenclawMediaReferences({
      type: 'image',
      mimeType: 'image/png',
      data: 'pngbase64',
    })

    expect(media).toEqual([
      {
        mediaType: 'image',
        path: 'data:image/png;base64,pngbase64',
      },
    ])
  })
})
