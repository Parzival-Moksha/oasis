// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MEDIA TOOLS TESTS — Constants, executors, dispatcher, OpenAI schemas
// Mission #25: src/lib/media-tools.ts
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  OASIS_URL,
  IMAGE_MODELS,
  VOICE_NAMES,
  VIDEO_DURATIONS,
  MEDIA_TOOL_NAMES,
  mediaToolsOpenAI,
  isMediaTool,
  execGenerateImage,
  execGenerateVoice,
  execGenerateVideo,
  execMediaTool,
} from '../media-tools'
import type { MediaToolResult } from '../media-tools'

// ═══════════════════════════════════════════════════════════════════════════
// Mock fetch globally
// ═══════════════════════════════════════════════════════════════════════════

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

beforeEach(() => {
  mockFetch.mockReset()
})

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: Constants validation
// ═══════════════════════════════════════════════════════════════════════════

describe('Constants', () => {
  it('OASIS_URL defaults to localhost:4516', () => {
    expect(OASIS_URL).toBe('http://localhost:4516')
  })

  it('IMAGE_MODELS contains expected models', () => {
    expect(IMAGE_MODELS).toContain('gemini-flash')
    expect(IMAGE_MODELS).toContain('riverflow')
    expect(IMAGE_MODELS).toContain('seedream')
    expect(IMAGE_MODELS).toContain('flux-klein')
    expect(IMAGE_MODELS).toHaveLength(4)
  })

  it('IMAGE_MODELS is a tuple (as const) with known length', () => {
    // `as const` provides compile-time immutability; at runtime it's a regular array
    expect(Array.isArray(IMAGE_MODELS)).toBe(true)
    expect(IMAGE_MODELS.length).toBeGreaterThan(0)
  })

  it('VOICE_NAMES contains expected voices', () => {
    expect(VOICE_NAMES).toContain('rachel')
    expect(VOICE_NAMES).toContain('adam')
    expect(VOICE_NAMES).toContain('sam')
    expect(VOICE_NAMES).toContain('elli')
    expect(VOICE_NAMES).toContain('merlin')
    expect(VOICE_NAMES).toHaveLength(5)
  })

  it('VIDEO_DURATIONS contains only even numbers', () => {
    for (const d of VIDEO_DURATIONS) {
      expect(d % 2).toBe(0)
    }
  })

  it('VIDEO_DURATIONS range is 6-20', () => {
    expect(VIDEO_DURATIONS[0]).toBe(6)
    expect(VIDEO_DURATIONS[VIDEO_DURATIONS.length - 1]).toBe(20)
    expect(VIDEO_DURATIONS).toHaveLength(8)
  })

  it('MEDIA_TOOL_NAMES enumerates the four tools', () => {
    expect(MEDIA_TOOL_NAMES).toEqual(['generate_image', 'generate_voice', 'generate_video', 'generate_music'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: isMediaTool type guard
// ═══════════════════════════════════════════════════════════════════════════

describe('isMediaTool', () => {
  it('returns true for generate_image', () => {
    expect(isMediaTool('generate_image')).toBe(true)
  })

  it('returns true for generate_voice', () => {
    expect(isMediaTool('generate_voice')).toBe(true)
  })

  it('returns true for generate_video', () => {
    expect(isMediaTool('generate_video')).toBe(true)
  })

  it('returns false for unknown tool names', () => {
    expect(isMediaTool('generate_unknown')).toBe(false)
    expect(isMediaTool('')).toBe(false)
    expect(isMediaTool('GENERATE_IMAGE')).toBe(false)
  })

  it('returns false for partial matches', () => {
    expect(isMediaTool('generate_')).toBe(false)
    expect(isMediaTool('image')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: resolveUrl logic (tested indirectly through executors)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveUrl (via execGenerateImage)', () => {
  it('returns absolute URL unchanged', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ url: 'https://cdn.example.com/img.png' }))
    const result = await execGenerateImage('a cat', undefined, 'http://test:4516')
    expect(result.ok).toBe(true)
    expect(result.url).toBe('https://cdn.example.com/img.png')
  })

  it('keeps relative URL relative so the browser can resolve it against the current app origin', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ url: '/uploads/img.png' }))
    const result = await execGenerateImage('a cat', undefined, 'http://test:4516')
    expect(result.ok).toBe(true)
    expect(result.url).toBe('/uploads/img.png')
  })

  it('handles http:// prefix in URL (not just https)', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ url: 'http://other.host/img.png' }))
    const result = await execGenerateImage('a cat', undefined, 'http://test:4516')
    expect(result.ok).toBe(true)
    expect(result.url).toBe('http://other.host/img.png')
  })

  it('returns undefined url when response has no url', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ }))
    const result = await execGenerateImage('a cat', undefined, 'http://test:4516')
    expect(result.ok).toBe(true)
    expect(result.url).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: execGenerateImage
// ═══════════════════════════════════════════════════════════════════════════

describe('execGenerateImage', () => {
  it('sends POST to /api/media/image with prompt and model', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ url: '/img.png' }))
    await execGenerateImage('sunset', 'riverflow', 'http://host:4516')

    expect(mockFetch).toHaveBeenCalledWith(
      'http://host:4516/api/media/image',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'sunset', model: 'riverflow' }),
      }),
    )
  })

  it('returns ok:true with resolved url on success', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ url: '/gen/sunset.png' }))
    const result = await execGenerateImage('sunset', undefined, 'http://h:4516')
    expect(result).toEqual({ ok: true, url: '/gen/sunset.png' })
  })

  it('returns ok:false with error on HTTP error', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ error: 'Rate limited' }, 429))
    const result = await execGenerateImage('sunset')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Rate limited')
  })

  it('returns ok:false with HTTP status when no error message', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}, 500))
    const result = await execGenerateImage('sunset')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('HTTP 500')
  })

  it('catches network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const result = await execGenerateImage('sunset')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Image gen error')
    expect(result.error).toContain('ECONNREFUSED')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: execGenerateVoice
// ═══════════════════════════════════════════════════════════════════════════

describe('execGenerateVoice', () => {
  it('sends POST to /api/media/voice with text and voice', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ url: '/audio.mp3' }))
    await execGenerateVoice('hello world', 'adam', 'http://h:4516', 'merlin')

    expect(mockFetch).toHaveBeenCalledWith(
      'http://h:4516/api/media/voice',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'hello world', voice: 'adam', agentType: 'merlin' }),
      }),
    )
  })

  it('returns ok:true with resolved url on success', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ url: 'https://cdn.example.com/audio.mp3' }))
    const result = await execGenerateVoice('hello', 'rachel', 'http://h:4516')
    expect(result).toEqual({ ok: true, url: 'https://cdn.example.com/audio.mp3' })
  })

  it('returns ok:false on HTTP error', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ error: 'Text too long' }, 400))
    const result = await execGenerateVoice('x'.repeat(6000))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Text too long')
  })

  it('catches network errors', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    const result = await execGenerateVoice('hello')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Voice gen error')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: execGenerateVideo
// ═══════════════════════════════════════════════════════════════════════════

describe('execGenerateVideo', () => {
  it('sends POST to /api/media/video with prompt, duration, image_url', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'completed', url: '/vid.mp4' }))
    await execGenerateVideo('a cat walking', 10, 'http://ref.png', 'http://h:4516')

    expect(mockFetch).toHaveBeenCalledWith(
      'http://h:4516/api/media/video',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ prompt: 'a cat walking', duration: 10, image_url: 'http://ref.png' }),
      }),
    )
  })

  it('returns immediately when status is completed', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'completed', url: '/vid.mp4' }))
    const result = await execGenerateVideo('test', undefined, undefined, 'http://h:4516')
    expect(result).toEqual({ ok: true, url: '/vid.mp4' })
    // Only one fetch call — no polling
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns error when no requestId and not completed', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'unknown' }))
    const result = await execGenerateVideo('test')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unexpected response')
  })

  it('polls until completed', async () => {
    // Submit returns requestId
    mockFetch.mockReturnValueOnce(jsonResponse({
      requestId: 'req-123',
      endpoint: 'ltx23',
    }))
    // First poll: processing
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'processing' }))
    // Second poll: completed
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'completed', url: '/vid.mp4' }))

    // Use fake timers to avoid real 5s waits
    vi.useFakeTimers()
    const promise = execGenerateVideo('test', 10, undefined, 'http://h:4516')

    // Advance through first poll delay
    await vi.advanceTimersByTimeAsync(5000)
    // Advance through second poll delay
    await vi.advanceTimersByTimeAsync(5000)

    const result = await promise
    expect(result.ok).toBe(true)
    expect(result.url).toBe('/vid.mp4')
    // 1 submit + 2 polls = 3 fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(3)

    vi.useRealTimers()
  })

  it('returns error when poll returns failed status', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ requestId: 'req-456', endpoint: '' }))
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'failed', error: 'GPU OOM' }))

    vi.useFakeTimers()
    const promise = execGenerateVideo('test')
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.error).toBe('GPU OOM')
    vi.useRealTimers()
  })

  it('returns default error message when poll fails without error string', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ requestId: 'req-789', endpoint: '' }))
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'failed' }))

    vi.useFakeTimers()
    const promise = execGenerateVideo('test')
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Video generation failed')
    vi.useRealTimers()
  })

  it('times out after 60 polls (5 min)', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ requestId: 'req-slow', endpoint: '' }))
    // All 60 polls return processing
    for (let i = 0; i < 60; i++) {
      mockFetch.mockReturnValueOnce(jsonResponse({ status: 'processing' }))
    }

    vi.useFakeTimers()
    const promise = execGenerateVideo('test')
    // Advance through all 60 poll intervals (60 * 5000ms = 300000ms = 5 min)
    for (let i = 0; i < 60; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Video generation timed out (5 min)')
    vi.useRealTimers()
  })

  it('includes endpoint in poll URL', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ requestId: 'req-e', endpoint: 'ltx-v2.3' }))
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'completed', url: '/v.mp4' }))

    vi.useFakeTimers()
    const promise = execGenerateVideo('test', undefined, undefined, 'http://h:4516')
    await vi.advanceTimersByTimeAsync(5000)
    await promise

    // Second call (the poll) should include endpoint
    const pollUrl = mockFetch.mock.calls[1][0] as string
    expect(pollUrl).toContain('requestId=req-e')
    expect(pollUrl).toContain('endpoint=ltx-v2.3')
    vi.useRealTimers()
  })

  it('returns ok:false on HTTP error from submit', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ error: 'Service down' }, 503))
    const result = await execGenerateVideo('test')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Service down')
  })

  it('catches network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'))
    const result = await execGenerateVideo('test')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Video gen error')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 7: execMediaTool dispatcher
// ═══════════════════════════════════════════════════════════════════════════

describe('execMediaTool', () => {
  it('routes generate_image to execGenerateImage', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ url: '/img.png' }))
    const result = await execMediaTool('generate_image', { prompt: 'a dog', model: 'flux-klein' }, 'http://h:4516')
    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://h:4516/api/media/image',
      expect.anything(),
    )
  })

  it('routes generate_voice to execGenerateVoice', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ url: '/audio.mp3' }))
    const result = await execMediaTool('generate_voice', { text: 'hello', voice: 'elli' }, 'http://h:4516')
    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://h:4516/api/media/voice',
      expect.anything(),
    )
  })

  it('routes generate_video to execGenerateVideo', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'completed', url: '/vid.mp4' }))
    const result = await execMediaTool('generate_video', { prompt: 'waves', duration: 8 }, 'http://h:4516')
    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://h:4516/api/media/video',
      expect.anything(),
    )
  })

  it('passes image_url through for video', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'completed', url: '/v.mp4' }))
    await execMediaTool('generate_video', { prompt: 'x', image_url: 'http://ref.jpg' }, 'http://h:4516')
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body)
    expect(body.image_url).toBe('http://ref.jpg')
  })

  it('returns error for unknown tool names', async () => {
    const result = await execMediaTool('generate_unknown', { prompt: 'jazz' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Unknown media tool: generate_unknown')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns error for empty tool name', async () => {
    const result = await execMediaTool('', {})
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Unknown media tool: ')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: mediaToolsOpenAI schema validation
// ═══════════════════════════════════════════════════════════════════════════

describe('mediaToolsOpenAI', () => {
  it('has exactly 4 tool definitions', () => {
    expect(mediaToolsOpenAI).toHaveLength(4)
  })

  it('all tools have type "function"', () => {
    for (const tool of mediaToolsOpenAI) {
      expect(tool.type).toBe('function')
    }
  })

  it('all tools have name, description, and parameters', () => {
    for (const tool of mediaToolsOpenAI) {
      expect(tool.function.name).toBeTruthy()
      expect(tool.function.description).toBeTruthy()
      expect(tool.function.parameters).toBeDefined()
      expect(tool.function.parameters.type).toBe('object')
      expect(tool.function.parameters.properties).toBeDefined()
      expect(Array.isArray(tool.function.parameters.required)).toBe(true)
    }
  })

  describe('generate_image schema', () => {
    const tool = mediaToolsOpenAI.find(t => t.function.name === 'generate_image')!
    const props = tool.function.parameters.properties as Record<string, any>

    it('exists', () => {
      expect(tool).toBeDefined()
    })

    it('requires prompt', () => {
      expect(tool.function.parameters.required).toContain('prompt')
    })

    it('prompt is type string', () => {
      expect(props.prompt.type).toBe('string')
    })

    it('model enum matches IMAGE_MODELS', () => {
      expect(props.model.enum).toEqual(IMAGE_MODELS)
    })

    it('model is not required', () => {
      expect(tool.function.parameters.required).not.toContain('model')
    })
  })

  describe('generate_voice schema', () => {
    const tool = mediaToolsOpenAI.find(t => t.function.name === 'generate_voice')!
    const props = tool.function.parameters.properties as Record<string, any>

    it('exists', () => {
      expect(tool).toBeDefined()
    })

    it('requires text', () => {
      expect(tool.function.parameters.required).toContain('text')
    })

    it('text is type string', () => {
      expect(props.text.type).toBe('string')
    })

    it('voice description mentions aliases and raw voice ids', () => {
      expect(props.voice.enum).toBeUndefined()
      expect(props.voice.description).toContain('merlin')
      expect(props.voice.description).toContain('raw ElevenLabs voice ID')
    })

    it('voice is not required', () => {
      expect(tool.function.parameters.required).not.toContain('voice')
    })
  })

  describe('generate_video schema', () => {
    const tool = mediaToolsOpenAI.find(t => t.function.name === 'generate_video')!
    const props = tool.function.parameters.properties as Record<string, any>

    it('exists', () => {
      expect(tool).toBeDefined()
    })

    it('requires prompt', () => {
      expect(tool.function.parameters.required).toContain('prompt')
    })

    it('prompt is type string', () => {
      expect(props.prompt.type).toBe('string')
    })

    it('duration is type number with enum matching VIDEO_DURATIONS', () => {
      expect(props.duration.type).toBe('number')
      expect(props.duration.enum).toEqual(VIDEO_DURATIONS)
    })

    it('image_url is type string and not required', () => {
      expect(props.image_url.type).toBe('string')
      expect(tool.function.parameters.required).not.toContain('image_url')
      expect(tool.function.parameters.required).not.toContain('duration')
    })
  })

  it('tool names match MEDIA_TOOL_NAMES', () => {
    const schemaNames = mediaToolsOpenAI.map(t => t.function.name)
    expect(schemaNames).toEqual([...MEDIA_TOOL_NAMES])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 9: MediaToolResult type shape
// ═══════════════════════════════════════════════════════════════════════════

describe('MediaToolResult shape', () => {
  it('success result has ok:true and url', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ url: '/img.png' }))
    const result: MediaToolResult = await execGenerateImage('test', undefined, 'http://h:4516')
    expect(result.ok).toBe(true)
    expect(typeof result.url).toBe('string')
    expect(result.error).toBeUndefined()
  })

  it('failure result has ok:false and error', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ error: 'fail' }, 500))
    const result: MediaToolResult = await execGenerateImage('test')
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.url).toBeUndefined()
  })
})
