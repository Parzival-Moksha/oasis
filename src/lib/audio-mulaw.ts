function clampSample(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value > 1) return 1
  if (value < -1) return -1
  return value
}

function linearToMuLawSample(sample: number): number {
  const BIAS = 0x84
  const CLIP = 32635

  let pcm = sample
  let sign = 0
  if (pcm < 0) {
    sign = 0x80
    pcm = -pcm
  }
  if (pcm > CLIP) pcm = CLIP
  pcm += BIAS

  let exponent = 7
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent -= 1) {
    expMask >>= 1
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

function muLawToLinearSample(value: number): number {
  const muLaw = (~value) & 0xff
  const sign = muLaw & 0x80
  const exponent = (muLaw >> 4) & 0x07
  const mantissa = muLaw & 0x0f
  let sample = ((mantissa << 3) + 0x84) << exponent
  sample -= 0x84
  return sign ? -sample : sample
}

export function downsampleFloat32ToPcm16(input: Float32Array, inputSampleRate: number, targetSampleRate = 8000): Int16Array {
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) return new Int16Array()
  if (targetSampleRate >= inputSampleRate) {
    const pcm = new Int16Array(input.length)
    for (let index = 0; index < input.length; index += 1) {
      const sample = clampSample(input[index])
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    }
    return pcm
  }

  const ratio = inputSampleRate / targetSampleRate
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Int16Array(outputLength)

  let offsetResult = 0
  let offsetBuffer = 0
  while (offsetResult < output.length) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio))
    let accum = 0
    let count = 0
    for (let index = offsetBuffer; index < nextOffsetBuffer; index += 1) {
      accum += clampSample(input[index])
      count += 1
    }
    const sample = count > 0 ? accum / count : 0
    output[offsetResult] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    offsetResult += 1
    offsetBuffer = nextOffsetBuffer
  }

  return output
}

export function encodePcm16ToMuLaw(pcm16: Int16Array): Uint8Array {
  const output = new Uint8Array(pcm16.length)
  for (let index = 0; index < pcm16.length; index += 1) {
    output[index] = linearToMuLawSample(pcm16[index])
  }
  return output
}

export function encodeFloat32ToMuLaw(input: Float32Array, inputSampleRate: number, targetSampleRate = 8000): Uint8Array {
  return encodePcm16ToMuLaw(downsampleFloat32ToPcm16(input, inputSampleRate, targetSampleRate))
}

export function decodeMuLawToPcm16(input: Uint8Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let index = 0; index < input.length; index += 1) {
    output[index] = muLawToLinearSample(input[index])
  }
  return output
}

export function decodePcm16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length)
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index]
    output[index] = sample < 0 ? sample / 0x8000 : sample / 0x7fff
  }
  return output
}

export function decodeMuLawToFloat32(input: Uint8Array): Float32Array {
  return decodePcm16ToFloat32(decodeMuLawToPcm16(input))
}

export function base64ToBytes(base64: string): Uint8Array {
  const raw = base64.includes(',') ? (base64.split(',').pop() || '').trim() : base64.trim()
  if (!raw) return new Uint8Array()

  if (typeof atob === 'function') {
    const binary = atob(raw)
    const output = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      output[index] = binary.charCodeAt(index)
    }
    return output
  }

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(raw, 'base64'))
  }

  return new Uint8Array()
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'function' && typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}
