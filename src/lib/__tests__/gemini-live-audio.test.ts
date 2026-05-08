import { describe, expect, it } from 'vitest'

import {
  extractPcmSampleRate,
  float32ToPcm16Base64,
  pcm16Base64ToFloat32,
  resampleFloat32,
} from '../gemini-live-audio'

describe('gemini live audio helpers', () => {
  it('round-trips PCM16 base64 audio samples', () => {
    const input = new Float32Array([-1, -0.5, 0, 0.5, 1])
    const encoded = float32ToPcm16Base64(input)
    const decoded = pcm16Base64ToFloat32(encoded)

    expect(decoded).toHaveLength(input.length)
    expect(decoded[0]).toBeCloseTo(-1, 4)
    expect(decoded[2]).toBeCloseTo(0, 4)
    expect(decoded[4]).toBeCloseTo(0.9999, 3)
  })

  it('resamples browser mic chunks to Gemini input rate', () => {
    const input = new Float32Array([0, 1, 0, -1])
    const output = resampleFloat32(input, 48000, 16000)

    expect(output).toHaveLength(1)
    expect(output[0]).toBeCloseTo(0)
  })

  it('extracts PCM rates from Gemini mime types', () => {
    expect(extractPcmSampleRate('audio/pcm;rate=24000', 16000)).toBe(24000)
    expect(extractPcmSampleRate('audio/pcm', 16000)).toBe(16000)
  })
})
