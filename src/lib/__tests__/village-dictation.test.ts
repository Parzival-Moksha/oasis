// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lip-sync', () => ({ registerLipSync: vi.fn(), unregisterLipSync: vi.fn(), resumeLipSyncContext: vi.fn(async () => {}) }))
vi.mock('../wlipsync-driver', () => ({ createWLipSyncLegacyController: vi.fn(() => ({ attachStream: vi.fn(), detach: vi.fn() })) }))
vi.mock('../player-avatar-runtime', () => ({ PLAYER_AVATAR_LIPSYNC_ID: 'player' }))

const saved = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => { saved.set(k, v) } } })

const {
  __setDictationStarterForTest, dictationView, draftText, lastWords, runningDictations, setDraftText, startDictation, stopDictation, takeDraftForSend, toggleDictation,
} = await import('../voice/village-dictation')
import type { LiveDictationHandlers } from '../voice/live-dictation'

/** A dictation driven by hand: say() sends lines, end() is the engine's "stopped". */
function fakeEngine() {
  const runs: Array<{ handlers: LiveDictationHandlers; stopped: number; cancelled: number }> = []
  __setDictationStarterForTest(async handlers => {
    const run = { handlers, stopped: 0, cancelled: 0 }
    runs.push(run)
    return { stop: () => { run.stopped++ }, cancel: () => { run.cancelled++ } }
  })
  const last = () => runs[runs.length - 1]
  return {
    runs,
    say: (line: number, text: string, final = false) => last().handlers.onLine?.({ line, text, final }),
    end: () => last().handlers.onDone?.({ firstWordsS: null, settleS: null, audioS: null }),
    fail: (text: string) => { last().handlers.onError?.(text); last().handlers.onDone?.({ firstWordsS: null, settleS: null, audioS: null }) },
  }
}

describe('dictation never loses the owner\'s words', () => {
  let engine: ReturnType<typeof fakeEngine>
  beforeEach(() => { engine = fakeEngine() })

  it('shows lines as they grow and keeps the last words when the mic stops without a settled version', async () => {
    setDraftText('a', 'Before.')
    await startDictation('a')
    expect(dictationView('a').listening).toBe(true)
    engine.say(0, 'hello')
    engine.say(0, 'Hello there.', true)
    engine.say(1, 'and the last')
    expect(draftText('a')).toBe('Before. Hello there. and the last')
    stopDictation('a')
    expect(engine.runs[0].stopped).toBe(1)
    expect(dictationView('a').settling).toBe(true)
    engine.end() // no final for line 1
    expect(draftText('a')).toBe('Before. Hello there. and the last')
    expect(dictationView('a').phase).toBe('idle')
  })

  it('an empty update never wipes a line, and a session that fails keeps every word', async () => {
    await startDictation('a')
    engine.say(0, 'words that matter')
    engine.say(0, '')
    expect(draftText('a')).toBe('words that matter')
    engine.fail('ElevenLabs closed the voice typing connection.')
    expect(draftText('a')).toBe('words that matter')
    expect(dictationView('a').error).toMatch(/closed/)
  })

  it('typing while the mic is on keeps everything, and new lines go after it', async () => {
    await startDictation('a')
    engine.say(0, 'first line', true)
    engine.say(1, 'second li')
    setDraftText('a', 'first line second li, typed')
    engine.say(1, 'second line settled', true) // a line already in the box: not added again
    engine.say(2, 'third line')
    expect(draftText('a')).toBe('first line second li, typed third line')
  })

  it('a send takes the box: the mic stops, settling words are not added again, words typed after the send stay', async () => {
    await startDictation('a')
    engine.say(0, 'send this')
    const take = takeDraftForSend('a')
    expect(take.text).toBe('send this')
    expect(engine.runs[0].stopped).toBe(1)
    engine.say(0, 'Send this.', true)
    engine.end()
    expect(draftText('a')).toBe('send this')
    setDraftText('a', 'send this and more')
    take.sent()
    expect(draftText('a')).toBe('and more')
  })

  it('a failed send leaves the box as it was', async () => {
    setDraftText('a', 'keep me')
    takeDraftForSend('a')
    expect(draftText('a')).toBe('keep me')
  })

  it('one mic at a time: starting another agent stops the first, keeping its words', async () => {
    await startDictation('a')
    engine.say(0, 'for a')
    await startDictation('b')
    expect(engine.runs[0].stopped).toBe(1)
    engine.runs[0].handlers.onDone?.({ firstWordsS: null, settleS: null, audioS: null })
    expect(draftText('a')).toBe('for a')
    engine.say(0, 'for b')
    expect(draftText('b')).toBe('for b')
  })

  it('toggle starts and stops; a stop asked before the mic is up stops it when it is', async () => {
    toggleDictation('a')
    toggleDictation('a') // stop requested while starting
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(engine.runs[0].stopped).toBe(1)
  })

  it('drafts are saved, so a page reload keeps the text', async () => {
    setDraftText('a', 'saved for later')
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(JSON.parse(saved.get('oasis.village.drafts.v1') || '{}')).toMatchObject({ a: 'saved for later' })
  })

  it('the voice widget: the running dictation, who it is for, and the last few words', async () => {
    setDraftText('a', 'one two three four five six seven')
    await startDictation('a')
    engine.say(0, 'eight nine ten')
    const [running] = runningDictations()
    expect(running).toMatchObject({ agentId: 'a', phase: 'listening' })
    expect(typeof running.startedAt).toBe('number')
    expect(lastWords('a', 4)).toBe('…seven eight nine ten')
    expect(lastWords('a', 20)).toBe('one two three four five six seven eight nine ten')
    stopDictation('a')
    engine.end()
    expect(runningDictations()).toEqual([])
  })
})
