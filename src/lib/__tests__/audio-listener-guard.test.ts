import { describe, expect, it } from 'vitest'

import { guardAudioListener } from '../audio-listener-guard'

function fakeListener(state: string) {
  const log: string[] = []
  const listener = {
    context: { state },
    updateMatrixWorld: (_force?: boolean) => { log.push('original') },
    log,
  }
  return listener
}

describe('guardAudioListener', () => {
  it('skips the audio scheduling while the context is suspended, but still updates matrices', () => {
    const listener = fakeListener('suspended')
    const stats = guardAudioListener(listener, function () { this.log.push('base') }, function () { this.log.push('audio') })
    for (let i = 0; i < 5; i++) listener.updateMatrixWorld()
    expect(listener.log).toEqual(['base', 'base', 'base', 'base', 'base'])
    expect(stats).toEqual({ calls: 5, audioRuns: 0 })
  })

  it('runs the audio scheduling once per frame while running, even when called many times a frame', () => {
    const listener = fakeListener('running')
    let clock = 0
    const stats = guardAudioListener(listener, function () { this.log.push('base') }, function () { this.log.push('audio') }, { now: () => clock, sameFrameMs: 4 })
    // 20 Html elements and the renderer call it within the same frame.
    for (let i = 0; i < 21; i++) listener.updateMatrixWorld()
    clock = 16.7
    for (let i = 0; i < 21; i++) listener.updateMatrixWorld()
    expect(stats).toEqual({ calls: 42, audioRuns: 2 })
    expect(listener.log.filter(x => x === 'audio')).toHaveLength(2)
    expect(listener.log[0]).toBe('audio')
    expect(listener.log[21]).toBe('audio')
  })

  it('starts scheduling again when the context resumes', () => {
    const listener = fakeListener('suspended')
    let clock = 0
    const stats = guardAudioListener(listener, function () { this.log.push('base') }, function () { this.log.push('audio') }, { now: () => clock })
    listener.updateMatrixWorld()
    listener.context.state = 'running'
    clock = 100
    listener.updateMatrixWorld()
    expect(stats.audioRuns).toBe(1)
    expect(listener.log).toEqual(['base', 'audio'])
  })
})
