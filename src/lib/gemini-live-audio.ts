export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.split(',').pop() || '' : base64
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(clean, 'base64'))
  }

  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function clampSample(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

export function float32ToPcm16Base64(samples: ArrayLike<number>): string {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i += 1) {
    const sample = clampSample(samples[i])
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return bytesToBase64(bytes)
}

export function pcm16Base64ToFloat32(base64: string): Float32Array {
  const bytes = base64ToBytes(base64)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2))
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

export function resampleFloat32(input: ArrayLike<number>, fromRate: number, toRate: number): Float32Array {
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0 || input.length === 0) {
    return new Float32Array(0)
  }
  if (Math.abs(fromRate - toRate) < 1) return Float32Array.from(input)

  const outputLength = Math.max(1, Math.round(input.length * toRate / fromRate))
  const output = new Float32Array(outputLength)
  const ratio = fromRate / toRate

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio
    const left = Math.floor(sourceIndex)
    const right = Math.min(input.length - 1, left + 1)
    const frac = sourceIndex - left
    output[i] = input[left] + (input[right] - input[left]) * frac
  }

  return output
}

export function extractPcmSampleRate(mimeType: unknown, fallback: number): number {
  if (typeof mimeType !== 'string') return fallback
  const match = mimeType.match(/rate=(\d+)/i)
  if (!match) return fallback
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
