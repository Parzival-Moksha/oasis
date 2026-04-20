// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TESTS — Anorak Pro voice recap after mission completion
// Mission #29: recapSend pattern, text threshold, truncation, error
// swallowing, voice URL detection in anorak-renderers
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// 1. recapSend — wraps send, captures text while forwarding all events
// ═══════════════════════════════════════════════════════════════════════════

// Mirror the recapSend pattern from execute/route.ts for pure unit testing
function createRecapSend(send: (type: string, data: Record<string, unknown>) => void) {
  let recapText = ''
  const recapSend = (type: string, data: Record<string, unknown>) => {
    if (type === 'text' && typeof data.content === 'string') recapText += data.content
    send(type, data)
  }
  return { recapSend, getRecapText: () => recapText }
}

describe('recapSend — text capture wrapper', () => {
  let send: (type: string, data: Record<string, unknown>) => void

  beforeEach(() => {
    send = vi.fn<(type: string, data: Record<string, unknown>) => void>()
  })

  it('forwards all events unchanged to the inner send', () => {
    const { recapSend } = createRecapSend(send)
    recapSend('text', { content: 'hello' })
    recapSend('status', { content: 'working...' })
    recapSend('error', { content: 'oops' })
    recapSend('tool_use', { name: 'Read', input: {} })

    expect(send).toHaveBeenCalledTimes(4)
    expect(send).toHaveBeenNthCalledWith(1, 'text', { content: 'hello' })
    expect(send).toHaveBeenNthCalledWith(2, 'status', { content: 'working...' })
    expect(send).toHaveBeenNthCalledWith(3, 'error', { content: 'oops' })
    expect(send).toHaveBeenNthCalledWith(4, 'tool_use', { name: 'Read', input: {} })
  })

  it('captures ONLY text events with string content', () => {
    const { recapSend, getRecapText } = createRecapSend(send)
    recapSend('text', { content: 'The mission was epic.' })
    recapSend('status', { content: 'This is a status, not text.' })
    recapSend('text', { content: ' Reviewer scored 95.' })
    recapSend('error', { content: 'This should not be captured.' })

    expect(getRecapText()).toBe('The mission was epic. Reviewer scored 95.')
  })

  it('ignores text events where content is not a string', () => {
    const { recapSend, getRecapText } = createRecapSend(send)
    recapSend('text', { content: 42 as unknown as string })
    recapSend('text', { content: null as unknown as string })
    recapSend('text', { content: undefined as unknown as string })
    recapSend('text', { content: { nested: true } as unknown as string })

    expect(getRecapText()).toBe('')
  })

  it('accumulates text from multiple chunks', () => {
    const { recapSend, getRecapText } = createRecapSend(send)
    recapSend('text', { content: 'chunk1' })
    recapSend('text', { content: 'chunk2' })
    recapSend('text', { content: 'chunk3' })

    expect(getRecapText()).toBe('chunk1chunk2chunk3')
  })

  it('handles empty string content without error', () => {
    const { recapSend, getRecapText } = createRecapSend(send)
    recapSend('text', { content: '' })
    recapSend('text', { content: 'real text' })
    recapSend('text', { content: '' })

    expect(getRecapText()).toBe('real text')
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('does not mutate the data object', () => {
    const { recapSend } = createRecapSend(send)
    const data = { content: 'immutable check' }
    recapSend('text', data)

    expect(data).toEqual({ content: 'immutable check' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Voice threshold — skip if recapText.trim().length <= 10
// ═══════════════════════════════════════════════════════════════════════════

// Mirror the threshold logic from execute/route.ts
function shouldGenerateVoice(recapText: string): boolean {
  return recapText.trim().length > 10
}

describe('voice threshold — recapText length check', () => {
  it('returns false for empty string', () => {
    expect(shouldGenerateVoice('')).toBe(false)
  })

  it('returns false for whitespace-only string', () => {
    expect(shouldGenerateVoice('     ')).toBe(false)
  })

  it('returns false for exactly 10 characters after trim', () => {
    expect(shouldGenerateVoice('1234567890')).toBe(false)
  })

  it('returns true for 11 characters after trim', () => {
    expect(shouldGenerateVoice('12345678901')).toBe(true)
  })

  it('trims before checking length', () => {
    // 10 chars surrounded by whitespace — after trim, still 10
    expect(shouldGenerateVoice('  1234567890  ')).toBe(false)
    // 11 chars surrounded by whitespace — after trim, 11
    expect(shouldGenerateVoice('  12345678901  ')).toBe(true)
  })

  it('returns false for short recap like "ok done"', () => {
    expect(shouldGenerateVoice('ok done')).toBe(false)
  })

  it('returns true for a real recap sentence', () => {
    expect(shouldGenerateVoice('Mission #42 shipped with flying colors! Reviewer 98, Tester 100, valor 1.5')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Text truncation — slice(0, 5000) before voice API call
// ═══════════════════════════════════════════════════════════════════════════

// Mirror the truncation logic from execute/route.ts
function prepareVoiceText(recapText: string): string {
  return recapText.trim().slice(0, 5000)
}

describe('voice text truncation — slice(0, 5000)', () => {
  it('leaves short text unchanged', () => {
    const text = 'Ship it!'
    expect(prepareVoiceText(text)).toBe('Ship it!')
  })

  it('trims whitespace before slicing', () => {
    expect(prepareVoiceText('  hello world  ')).toBe('hello world')
  })

  it('truncates text longer than 5000 characters', () => {
    const longText = 'A'.repeat(7000)
    const result = prepareVoiceText(longText)
    expect(result.length).toBe(5000)
    expect(result).toBe('A'.repeat(5000))
  })

  it('preserves exactly 5000 characters when input is exactly 5000', () => {
    const exact = 'B'.repeat(5000)
    expect(prepareVoiceText(exact).length).toBe(5000)
  })

  it('does not truncate at 4999 characters', () => {
    const short = 'C'.repeat(4999)
    expect(prepareVoiceText(short).length).toBe(4999)
  })

  it('handles unicode characters in truncation boundary', () => {
    // Unicode chars can be multi-byte but JS slice works on code units
    const text = '\u{1F525}'.repeat(3000) // fire emoji, 3000 chars
    const result = prepareVoiceText(text)
    expect(result.length).toBeLessThanOrEqual(5000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Voice API call — fetch mock, payload, fire-and-forget error handling
// ═══════════════════════════════════════════════════════════════════════════

// Mirror the full voice generation block from execute/route.ts
async function generateVoiceRecap(
  recapText: string,
  send: (type: string, data: Record<string, unknown>) => void,
  fetchFn: any,
): Promise<void> {
  if (recapText.trim().length > 10) {
    try {
      const voiceRes = await fetchFn('http://localhost:4516/api/media/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: recapText.trim().slice(0, 5000), voice: 'rachel' }),
      })
      if (voiceRes.ok) {
        const voiceData = await voiceRes.json() as { url?: string }
        if (voiceData.url) {
          send('media', {
            mediaType: 'audio',
            url: voiceData.url,
            prompt: 'Anorak Pro recap voice note',
            lobe: 'anorak-pro',
          })
        }
      }
    } catch { /* voice is best-effort — never blocks pipeline */ }
  }
}

describe('voice API call — fetch, payload, fire-and-forget', () => {
  let send: (type: string, data: Record<string, unknown>) => void
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    send = vi.fn<(type: string, data: Record<string, unknown>) => void>()
    mockFetch = vi.fn()
  })

  it('calls voice API with correct URL, method, and content-type', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/generated-voices/test.mp3' }),
    })

    await generateVoiceRecap('This is a proper recap text.', send, mockFetch)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('http://localhost:4516/api/media/voice')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')
  })

  it('sends voice: "rachel" in the request body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/generated-voices/recap.mp3' }),
    })

    await generateVoiceRecap('Enough text for voice generation.', send, mockFetch)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.voice).toBe('rachel')
  })

  it('sends trimmed and truncated text in body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/generated-voices/recap.mp3' }),
    })

    const longText = '  ' + 'X'.repeat(6000) + '  '
    await generateVoiceRecap(longText, send, mockFetch)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.text.length).toBe(5000)
    expect(body.text).toBe('X'.repeat(5000))
  })

  it('emits voice recap as an audio media event with lobe: anorak-pro', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/generated-voices/mission42-recap.mp3' }),
    })

    await generateVoiceRecap('Voice recap for mission 42.', send, mockFetch)

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('media', {
      mediaType: 'audio',
      url: '/generated-voices/mission42-recap.mp3',
      prompt: 'Anorak Pro recap voice note',
      lobe: 'anorak-pro',
    })
  })

  it('does NOT emit if response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'TTS failed' }),
    })

    await generateVoiceRecap('Valid recap text for testing.', send, mockFetch)

    expect(send).not.toHaveBeenCalled()
  })

  it('does NOT emit if response has no url field', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'no voice generated' }),
    })

    await generateVoiceRecap('Valid recap text for testing.', send, mockFetch)

    expect(send).not.toHaveBeenCalled()
  })

  it('does NOT emit if url is empty string', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: '' }),
    })

    await generateVoiceRecap('Valid recap text for testing.', send, mockFetch)

    expect(send).not.toHaveBeenCalled()
  })

  it('does NOT call fetch when text is too short', async () => {
    await generateVoiceRecap('short', send, mockFetch)

    expect(mockFetch).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('does NOT call fetch when text is whitespace only', async () => {
    await generateVoiceRecap('          ', send, mockFetch)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('swallows fetch network errors (fire-and-forget)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    // Should NOT throw
    await expect(
      generateVoiceRecap('This recap should not crash on network error.', send, mockFetch)
    ).resolves.toBeUndefined()

    expect(send).not.toHaveBeenCalled()
  })

  it('swallows JSON parse errors (fire-and-forget)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token') },
    })

    await expect(
      generateVoiceRecap('This recap should not crash on bad JSON.', send, mockFetch)
    ).resolves.toBeUndefined()

    expect(send).not.toHaveBeenCalled()
  })

  it('swallows timeout errors (fire-and-forget)', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'))

    await expect(
      generateVoiceRecap('This recap should not crash on timeout.', send, mockFetch)
    ).resolves.toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. Voice URL format in text event — embedded with newlines
// ═══════════════════════════════════════════════════════════════════════════

describe('voice recap media event format', () => {
  it('emits audio media payload with the generated voice URL', async () => {
    const send = vi.fn<(type: string, data: Record<string, unknown>) => void>()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/generated-voices/abc123.mp3' }),
    })

    await generateVoiceRecap('Enough text to trigger voice.', send, mockFetch)

    expect(send).toHaveBeenCalledWith('media', {
      mediaType: 'audio',
      url: '/generated-voices/abc123.mp3',
      prompt: 'Anorak Pro recap voice note',
      lobe: 'anorak-pro',
    })
  })

  it('preserves voice URLs with query params', async () => {
    const send = vi.fn<(type: string, data: Record<string, unknown>) => void>()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/generated-voices/recap.mp3?v=2&t=1234' }),
    })

    await generateVoiceRecap('Enough text to trigger voice gen.', send, mockFetch)

    expect(send).toHaveBeenCalledWith('media', expect.objectContaining({
      mediaType: 'audio',
      url: '/generated-voices/recap.mp3?v=2&t=1234',
    }))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. MEDIA_URL_RE and detectMediaType — voice URL auto-detection
// ═══════════════════════════════════════════════════════════════════════════

// Mirror the regex and detection logic from anorak-renderers.tsx
const MEDIA_URL_RE = /((?:https?:\/\/(?:localhost|127\.0\.0\.1|fal\.media|fal-cdn\.|oaidalleapiprodscus\.|replicate\.delivery)[^\s]+)|(?:\/generated-(?:images|voices|videos)\/[^\s]+))/i

function detectMediaType(url: string): 'image' | 'audio' | 'video' | null {
  if (/\/generated-images\/|\.(?:png|jpg|jpeg|gif|webp)(?:\?|$)/i.test(url)) return 'image'
  if (/\/generated-voices\/|\.(?:mp3|wav|ogg)(?:\?|$)/i.test(url)) return 'audio'
  if (/\/generated-videos\/|\.(?:mp4|webm)(?:\?|$)/i.test(url)) return 'video'
  return null
}

describe('MEDIA_URL_RE — voice URL pattern matching', () => {
  it('matches /generated-voices/ paths', () => {
    const match = '/generated-voices/recap-abc123.mp3'.match(MEDIA_URL_RE)
    expect(match).not.toBeNull()
    expect(match![0]).toBe('/generated-voices/recap-abc123.mp3')
  })

  it('matches /generated-voices/ with query params', () => {
    const match = '/generated-voices/recap.mp3?v=1'.match(MEDIA_URL_RE)
    expect(match).not.toBeNull()
  })

  it('matches /generated-images/ paths', () => {
    const match = '/generated-images/test.png'.match(MEDIA_URL_RE)
    expect(match).not.toBeNull()
  })

  it('matches /generated-videos/ paths', () => {
    const match = '/generated-videos/clip.mp4'.match(MEDIA_URL_RE)
    expect(match).not.toBeNull()
  })

  it('matches localhost URLs', () => {
    const match = 'http://localhost:4516/api/something'.match(MEDIA_URL_RE)
    expect(match).not.toBeNull()
  })

  it('matches fal.media URLs', () => {
    const match = 'https://fal.media/files/output.png'.match(MEDIA_URL_RE)
    expect(match).not.toBeNull()
  })

  it('does NOT match arbitrary URLs', () => {
    const match = 'https://example.com/something'.match(MEDIA_URL_RE)
    expect(match).toBeNull()
  })

  it('does NOT match plain text', () => {
    const match = 'no urls here'.match(MEDIA_URL_RE)
    expect(match).toBeNull()
  })

  it('extracts URL from surrounding text', () => {
    const line = 'Here is the audio: /generated-voices/recap.mp3 enjoy!'
    const match = line.match(MEDIA_URL_RE)
    expect(match).not.toBeNull()
    expect(match![0]).toBe('/generated-voices/recap.mp3')
  })
})

describe('detectMediaType — voice URL classification', () => {
  it('returns "audio" for /generated-voices/ paths', () => {
    expect(detectMediaType('/generated-voices/recap.mp3')).toBe('audio')
  })

  it('returns "audio" for .mp3 extension', () => {
    expect(detectMediaType('http://localhost:4516/some/file.mp3')).toBe('audio')
  })

  it('returns "audio" for .wav extension', () => {
    expect(detectMediaType('/some/path/file.wav')).toBe('audio')
  })

  it('returns "audio" for .ogg extension', () => {
    expect(detectMediaType('/file.ogg')).toBe('audio')
  })

  it('returns "audio" for .mp3 with query params', () => {
    expect(detectMediaType('/generated-voices/recap.mp3?v=2')).toBe('audio')
  })

  it('returns "image" for /generated-images/ paths', () => {
    expect(detectMediaType('/generated-images/pic.png')).toBe('image')
  })

  it('returns "image" for .png extension', () => {
    expect(detectMediaType('/some/file.png')).toBe('image')
  })

  it('returns "image" for .jpg extension', () => {
    expect(detectMediaType('/some/file.jpg')).toBe('image')
  })

  it('returns "image" for .webp extension', () => {
    expect(detectMediaType('/some/file.webp')).toBe('image')
  })

  it('returns "video" for /generated-videos/ paths', () => {
    expect(detectMediaType('/generated-videos/clip.mp4')).toBe('video')
  })

  it('returns "video" for .mp4 extension', () => {
    expect(detectMediaType('/some/file.mp4')).toBe('video')
  })

  it('returns "video" for .webm extension', () => {
    expect(detectMediaType('/some/file.webm')).toBe('video')
  })

  it('returns null for unrecognized paths', () => {
    expect(detectMediaType('/api/data.json')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(detectMediaType('')).toBeNull()
  })

  it('returns null for path without media extension or generated- prefix', () => {
    expect(detectMediaType('/uploads/document.pdf')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. Source code structural checks — ensure voice recap block exists
// ═══════════════════════════════════════════════════════════════════════════

describe('execute/route.ts — voice recap block structure', () => {
  const routeSrc = fs.readFileSync(
    path.join(__dirname, '../../app/api/anorak/pro/execute/route.ts'), 'utf-8'
  )

  it('defines recapSend wrapper inside the RECAP section', () => {
    expect(routeSrc).toContain('const recapSend')
    expect(routeSrc).toContain("type === 'text' && typeof data.content === 'string'")
  })

  it('accumulates recapText from text events', () => {
    expect(routeSrc).toContain('recapText += data.content')
  })

  it('forwards all events via send(type, data)', () => {
    // recapSend calls send(type, data) unconditionally
    expect(routeSrc).toMatch(/recapSend[\s\S]*?send\(type, data\)/)
  })

  it('passes recapSend to spawnAgent for recap phase', () => {
    expect(routeSrc).toContain("recapSend, request.signal")
  })

  it('checks threshold: recapText.trim().length > 10', () => {
    expect(routeSrc).toContain('recapText.trim().length > 10')
  })

  it('truncates to 5000 chars: .slice(0, 5000)', () => {
    expect(routeSrc).toContain('.slice(0, 5000)')
  })

  it('uses voice "rachel"', () => {
    expect(routeSrc).toContain("voice: 'rachel'")
  })

  it('POSTs to /api/media/voice', () => {
    expect(routeSrc).toContain('/api/media/voice')
  })

  it('emits a media event with lobe: anorak-pro', () => {
    expect(routeSrc).toContain("send('media'")
    expect(routeSrc).toContain("mediaType: 'audio'")
    expect(routeSrc).toContain("lobe: 'anorak-pro'")
  })

  it('wraps voice block in try/catch (fire-and-forget)', () => {
    // The voice block is inside try/catch with empty catch
    expect(routeSrc).toMatch(/try\s*\{[\s\S]*?\/api\/media\/voice[\s\S]*?\}\s*catch\s*\{/)
  })

  it('checks voiceRes.ok before emitting URL', () => {
    expect(routeSrc).toContain('voiceRes.ok')
  })

  it('checks voiceData.url before emitting', () => {
    expect(routeSrc).toContain('voiceData.url')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. anorak-renderers.tsx — structural checks for media detection
// ═══════════════════════════════════════════════════════════════════════════

describe('anorak-renderers.tsx — voice media detection structure', () => {
  const rendererSrc = fs.readFileSync(
    path.join(__dirname, '../anorak-renderers.tsx'), 'utf-8'
  )

  it('MEDIA_URL_RE matches /generated-voices/ pattern', () => {
    expect(rendererSrc).toContain('generated-(?:images|voices|videos)')
  })

  it('detectMediaType returns "audio" for /generated-voices/', () => {
    // In the raw source, forward slashes are escaped inside regex literals: \/generated-voices\/
    expect(rendererSrc).toContain('generated-voices')
    expect(rendererSrc).toMatch(/generated-voices.*?return 'audio'/)
  })

  it('renderMarkdownLine uses MEDIA_URL_RE for auto-detection', () => {
    expect(rendererSrc).toContain('line.match(MEDIA_URL_RE)')
  })

  it('renderMarkdownLine calls detectMediaType on matched URL', () => {
    expect(rendererSrc).toContain('detectMediaType(matchedUrl)')
  })

  it('uses MediaBubble component for detected media', () => {
    expect(rendererSrc).toContain('MediaBubble')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. End-to-end flow simulation — recap → threshold → voice → emit
// ═══════════════════════════════════════════════════════════════════════════

describe('end-to-end voice recap flow', () => {
  it('full flow: accumulate chunks → threshold pass → fetch → emit URL', async () => {
    const send = vi.fn<(type: string, data: Record<string, unknown>) => void>()
    const { recapSend, getRecapText } = createRecapSend(send)

    // Simulate streamed recap chunks
    recapSend('text', { content: 'Mission #42 was legendary. ' })
    recapSend('text', { content: 'Reviewer scored 98/100. ' })
    recapSend('text', { content: 'Tester scored 100/100. Valor: 2.0!' })
    recapSend('status', { content: 'recap complete' })

    // All 4 events forwarded
    expect(send).toHaveBeenCalledTimes(4)

    // Text accumulated
    const text = getRecapText()
    expect(text).toBe('Mission #42 was legendary. Reviewer scored 98/100. Tester scored 100/100. Valor: 2.0!')
    expect(shouldGenerateVoice(text)).toBe(true)

    // Voice fetch
    const voiceSend = vi.fn<(type: string, data: Record<string, unknown>) => void>()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/generated-voices/mission42.mp3' }),
    })

    await generateVoiceRecap(text, voiceSend, mockFetch)

    expect(voiceSend).toHaveBeenCalledWith('media', {
      mediaType: 'audio',
      url: '/generated-voices/mission42.mp3',
      prompt: 'Anorak Pro recap voice note',
      lobe: 'anorak-pro',
    })

    // And the URL would be auto-detected by renderers
    const emittedUrl = '/generated-voices/mission42.mp3'
    expect(detectMediaType(emittedUrl)).toBe('audio')
    expect(emittedUrl.match(MEDIA_URL_RE)).not.toBeNull()
  })

  it('full flow: short recap → threshold fail → no voice call', async () => {
    const send = vi.fn<(type: string, data: Record<string, unknown>) => void>()
    const { recapSend, getRecapText } = createRecapSend(send)

    recapSend('text', { content: 'Done.' })

    const text = getRecapText()
    expect(shouldGenerateVoice(text)).toBe(false)

    const mockFetch = vi.fn()
    await generateVoiceRecap(text, send, mockFetch)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('full flow: voice API fails → no crash, no URL emitted', async () => {
    const send = vi.fn<(type: string, data: Record<string, unknown>) => void>()
    const { recapSend, getRecapText } = createRecapSend(send)

    recapSend('text', { content: 'A recap long enough to pass the threshold check.' })

    const voiceSend = vi.fn<(type: string, data: Record<string, unknown>) => void>()
    const mockFetch = vi.fn().mockRejectedValue(new Error('Voice service down'))

    await expect(
      generateVoiceRecap(getRecapText(), voiceSend, mockFetch)
    ).resolves.toBeUndefined()

    expect(voiceSend).not.toHaveBeenCalled()
  })
})
