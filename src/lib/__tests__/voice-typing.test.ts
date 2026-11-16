// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { dictationUrl } from '../voice/live-dictation'
import { DEFAULT_VOICE_TYPING_ENGINE, parseVoiceTypingEngine } from '../voice/voice-typing-engine'
import { liveScribeParams, listenScribe } from '../../../packages/oasis-agent-engine/src/scribe-live.js'
import { parseRange } from '../../../packages/oasis-agent-engine/src/files.js'

describe('voice typing choice', () => {
  it('defaults to ElevenLabs and keeps local', () => {
    expect(DEFAULT_VOICE_TYPING_ENGINE).toBe('elevenlabs')
    expect(parseVoiceTypingEngine('local')).toBe('local')
    expect(parseVoiceTypingEngine('elevenlabs')).toBe('elevenlabs')
    expect(parseVoiceTypingEngine(null)).toBe('elevenlabs')
    expect(parseVoiceTypingEngine('whisper')).toBe('elevenlabs')
  })

  it('tells the engine which one in the dictation URL', () => {
    expect(dictationUrl('en', 'local')).toBe('ws://127.0.0.1:4530/listen?lang=en&engine=local')
    expect(dictationUrl('hu', 'elevenlabs')).toBe('ws://127.0.0.1:4530/listen?lang=hu&engine=elevenlabs')
  })

  it('asks ElevenLabs for 16 kHz PCM, pauses as line ends, the language, and the names', () => {
    const params = liveScribeParams('en')
    expect(params.get('audio_format')).toBe('pcm_16000')
    expect(params.get('commit_strategy')).toBe('vad')
    expect(params.get('language_code')).toBe('en')
    expect(params.getAll('keyterms')).toEqual(['Anorak', 'Oasis'])
    expect(liveScribeParams('auto').has('language_code')).toBe(false)
  })
})

describe('voice message files answer byte ranges (the player jumps around)', () => {
  it('reads the ranges a browser asks for', () => {
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=200-299', 1000)).toEqual({ start: 200, end: 299 })
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=1000-', 1000)).toBe('bad')
    expect(parseRange(undefined, 1000)).toBeNull()
    expect(parseRange('bytes=1-2,5-6', 1000)).toBeNull()
  })
})

// ─── the /listen protocol over a fake ElevenLabs ─────────────────────────────

type Msg = { t: string; line?: number; text?: string; audio_s?: number }

const servers: WebSocketServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise(r => s.close(() => r(null)))))
})

function listenOn(server: WebSocketServer): Promise<number> {
  return new Promise(resolve => server.on('listening', () => resolve((server.address() as { port: number }).port)))
}

/** A fake ElevenLabs, the engine's /listen in front of it, and a page talking to that. */
async function rig(fake: (socket: WebSocket, seen: { chunks: Array<{ audio_base_64: string; commit: boolean; sample_rate: number }>; key: string | undefined; url: string }) => void) {
  const upstream = new WebSocketServer({ port: 0 })
  servers.push(upstream)
  const seen = { chunks: [] as Array<{ audio_base_64: string; commit: boolean; sample_rate: number }>, key: undefined as string | undefined, url: '' }
  upstream.on('connection', (socket, req) => {
    seen.key = req.headers['xi-api-key'] as string | undefined
    seen.url = req.url || ''
    socket.on('message', raw => seen.chunks.push(JSON.parse(String(raw))))
    fake(socket, seen)
  })
  const upstreamPort = await listenOn(upstream)
  const engine = new WebSocketServer({ port: 0 })
  servers.push(engine)
  engine.on('connection', (ws, req) => {
    listenScribe(ws, new URL(req.url || '/', 'http://x'), undefined, { key: 'test-key', endpoint: `ws://127.0.0.1:${upstreamPort}/v1/speech-to-text/realtime` })
  })
  const enginePort = await listenOn(engine)
  const page = new WebSocket(`ws://127.0.0.1:${enginePort}/listen?lang=en&engine=elevenlabs`)
  const got: Msg[] = []
  const closed = new Promise<void>(resolve => page.on('close', () => resolve()))
  page.on('message', raw => got.push(JSON.parse(String(raw))))
  await new Promise(resolve => page.on('open', resolve))
  return { page, got, closed, seen }
}

describe('ElevenLabs voice typing in the engine', () => {
  it('turns partials and commits into lines, and stop into the last line and "stopped"', async () => {
    const { page, got, closed, seen } = await rig((socket, seenNow) => {
      socket.send(JSON.stringify({ message_type: 'session_started', session_id: 's1', config: {} }))
      socket.on('message', raw => {
        const m = JSON.parse(String(raw))
        const audio = seenNow.chunks.filter(c => c.audio_base_64).length
        if (audio === 1) socket.send(JSON.stringify({ message_type: 'partial_transcript', text: 'hello' }))
        if (audio === 2) {
          socket.send(JSON.stringify({ message_type: 'partial_transcript', text: 'hello there' }))
          socket.send(JSON.stringify({ message_type: 'committed_transcript', text: 'Hello there.' }))
        }
        if (audio === 3 && !m.commit) socket.send(JSON.stringify({ message_type: 'partial_transcript', text: 'second' }))
        if (m.commit) socket.send(JSON.stringify({ message_type: 'committed_transcript', text: 'Second line.' }))
      })
    })
    await new Promise(r => setTimeout(r, 100))
    for (let i = 0; i < 3; i++) {
      page.send(Buffer.alloc(3200, i + 1))
      await new Promise(r => setTimeout(r, 60))
    }
    page.send(JSON.stringify({ t: 'stop' }))
    await closed

    expect(seen.key).toBe('test-key')
    expect(seen.url).toContain('audio_format=pcm_16000')
    expect(seen.chunks.filter(c => c.audio_base_64)).toHaveLength(3)
    expect(seen.chunks.every(c => c.sample_rate === 16000)).toBe(true)
    expect(seen.chunks[seen.chunks.length - 1]).toMatchObject({ audio_base_64: '', commit: true })
    const lines = got.filter(m => m.t === 'partial' || m.t === 'final').map(m => `${m.t}:${m.line}:${m.text}`)
    expect(lines).toEqual(['partial:0:hello', 'partial:0:hello there', 'final:0:Hello there.', 'partial:1:second', 'final:1:Second line.'])
    expect(got[0].t).toBe('status')
    expect(got.some(m => m.t === 'ready')).toBe(true)
    expect(got[got.length - 1]).toMatchObject({ t: 'stopped', audio_s: 0.3 })
  })

  it('says what went wrong when ElevenLabs refuses, and still ends', async () => {
    const { got, closed } = await rig(socket => {
      socket.send(JSON.stringify({ message_type: 'quota_exceeded', error: 'You have exceeded your usage quota' }))
      socket.close()
    })
    await closed
    expect(got.find(m => m.t === 'error')?.text).toContain('exceeded your usage quota')
    expect(got[got.length - 1].t).toBe('stopped')
  })

  it('ElevenLabs going away mid-sentence keeps the words and opens a new session: the dictation goes on', async () => {
    let connections = 0
    const { page, got, closed } = await rig((socket, seenNow) => {
      connections += 1
      const mine = connections
      socket.send(JSON.stringify({ message_type: 'session_started', session_id: `s${mine}`, config: {} }))
      socket.on('message', raw => {
        const m = JSON.parse(String(raw))
        if (mine === 1 && m.audio_base_64) {
          socket.send(JSON.stringify({ message_type: 'partial_transcript', text: 'half a thought' }))
          setTimeout(() => socket.close(), 30)
        }
        if (mine === 2 && m.audio_base_64) socket.send(JSON.stringify({ message_type: 'partial_transcript', text: 'and the rest' }))
        if (mine === 2 && m.commit) socket.send(JSON.stringify({ message_type: 'committed_transcript', text: 'And the rest.' }))
        void seenNow
      })
    })
    await new Promise(r => setTimeout(r, 100))
    page.send(Buffer.alloc(3200, 1))
    await new Promise(r => setTimeout(r, 600)) // the first session drops, a second one opens
    page.send(Buffer.alloc(3200, 2))
    await new Promise(r => setTimeout(r, 150))
    page.send(JSON.stringify({ t: 'stop' }))
    await closed
    expect(connections).toBe(2)
    expect(got.filter(m => m.t === 'final').map(m => `${m.line}:${m.text}`)).toEqual(['0:half a thought', '1:And the rest.'])
    expect(got.filter(m => m.t === 'ready')).toHaveLength(1)
    expect(got.some(m => m.t === 'error')).toBe(false)
  })

  it('a throttled commit or a warning is not the end of the dictation', async () => {
    const { page, got, closed } = await rig(socket => {
      socket.send(JSON.stringify({ message_type: 'session_started', session_id: 's1', config: {} }))
      socket.on('message', raw => {
        const m = JSON.parse(String(raw))
        if (m.audio_base_64) {
          socket.send(JSON.stringify({ message_type: 'commit_throttled', error: 'too many commits' }))
          socket.send(JSON.stringify({ message_type: 'warning', warning: 'slow down' }))
          socket.send(JSON.stringify({ message_type: 'partial_transcript', text: 'still here' }))
        }
        if (m.commit) socket.send(JSON.stringify({ message_type: 'committed_transcript', text: 'Still here.' }))
      })
    })
    await new Promise(r => setTimeout(r, 100))
    page.send(Buffer.alloc(3200, 1))
    await new Promise(r => setTimeout(r, 150))
    page.send(JSON.stringify({ t: 'stop' }))
    await closed
    expect(got.some(m => m.t === 'error')).toBe(false)
    expect(got.filter(m => m.t === 'final').map(m => m.text)).toEqual(['Still here.'])
  })
})
