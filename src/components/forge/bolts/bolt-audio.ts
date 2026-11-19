// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// BOLT AUDIO — cast and impact sounds, played straight into the camera's audio listener.
// The caster hears their own cast at full volume (it is in their hand); an impact is placed
// where it happens and fades with distance (inverse law: 30 m away is still audible; the old
// linear 20-30 m cutoff made most hits silent). No React state, no per-frame work: a source,
// a panner, a gain, and they disconnect themselves when the sound ends.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import * as THREE from 'three'

import { getAudioListener } from '@/components/CameraController'
import { useAudioManager } from '@/lib/audio-manager'

const buffers = new Map<string, Promise<AudioBuffer | null>>()

function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const known = buffers.get(url)
  if (known) return known
  const promise = new Promise<AudioBuffer | null>(resolve => {
    new THREE.AudioLoader().load(url, buffer => resolve(buffer), undefined, () => resolve(null))
  })
  buffers.set(url, promise)
  return promise
}

/** Starts loading sounds ahead of the first cast, so the first bolt is not silent. */
export function preloadBoltSounds(urls: Array<string | null | undefined>): void {
  for (const url of urls) if (url) void loadBuffer(url)
}

/**
 * Plays `url`. With a position it is placed in the world; without, it plays at the listener.
 * Returns false when it could not play through the listener (the caller may fall back).
 */
export function playBoltSound(url: string | null, position: [number, number, number] | null, volume = 1): boolean {
  if (!url) return false
  const listener = getAudioListener()
  const audio = useAudioManager.getState()
  if (audio.muted || audio.volume <= 0) return true
  if (!listener) return false
  const context = listener.context
  if (context.state === 'suspended') void context.resume().catch(() => {})
  void loadBuffer(url).then(buffer => {
    if (!buffer || context.state === 'closed') return
    const source = context.createBufferSource()
    source.buffer = buffer
    const gain = context.createGain()
    gain.gain.value = Math.max(0, Math.min(1.5, audio.volume * volume))
    let panner: PannerNode | null = null
    if (position) {
      panner = context.createPanner()
      panner.panningModel = 'equalpower'
      panner.distanceModel = 'inverse'
      panner.refDistance = 4
      panner.maxDistance = 120
      panner.rolloffFactor = 1
      panner.positionX.value = position[0]
      panner.positionY.value = position[1]
      panner.positionZ.value = position[2]
      source.connect(panner).connect(gain)
    } else {
      source.connect(gain)
    }
    gain.connect(listener.getInput())
    source.onended = () => {
      source.disconnect()
      panner?.disconnect()
      gain.disconnect()
    }
    source.start()
  })
  return true
}
