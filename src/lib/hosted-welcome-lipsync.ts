import {
  DEFAULT_LIP_SYNC_TUNING,
  type LipSyncController,
  type LipSyncState,
  type LipSyncTuning,
} from '@/lib/lip-sync'
import {
  buildCharacterMouthTimeline,
  mapMouthWeightsToLegacyLipSyncState,
  sampleMouthTimeline,
  type ElevenLabsAlignment,
  type MouthTimeline,
} from '@/lib/lip-sync-lab'

export const HOSTED_WELCOME_TIMING_URL = '/audio/04515/welcome-sam.json'

const ZERO_LIP_SYNC_STATE: LipSyncState = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }

interface HostedWelcomeTimingPayload {
  alignment?: ElevenLabsAlignment | null
  normalizedAlignment?: ElevenLabsAlignment | null
}

let hostedWelcomeTimingPromise: Promise<ElevenLabsAlignment | null> | null = null

function isElevenLabsAlignment(value: unknown): value is ElevenLabsAlignment {
  const candidate = value as ElevenLabsAlignment | null | undefined
  return Boolean(
    candidate
      && Array.isArray(candidate.characters)
      && Array.isArray(candidate.character_start_times_seconds)
      && Array.isArray(candidate.character_end_times_seconds),
  )
}

export function resetHostedWelcomeTimingCacheForTest() {
  hostedWelcomeTimingPromise = null
}

export async function loadHostedWelcomeTiming(fetcher: typeof fetch = fetch): Promise<ElevenLabsAlignment | null> {
  if (hostedWelcomeTimingPromise) return hostedWelcomeTimingPromise

  hostedWelcomeTimingPromise = fetcher(HOSTED_WELCOME_TIMING_URL, { cache: 'force-cache' })
    .then(async response => {
      if (!response.ok) return null
      const payload = await response.json() as HostedWelcomeTimingPayload
      if (isElevenLabsAlignment(payload.normalizedAlignment)) return payload.normalizedAlignment
      if (isElevenLabsAlignment(payload.alignment)) return payload.alignment
      return null
    })
    .catch(() => null)

  return hostedWelcomeTimingPromise
}

export function createTimedLipSyncController(timeline: MouthTimeline): LipSyncController {
  let active = false
  let currentElement: HTMLMediaElement | null = null

  return {
    get isActive() {
      return active
    },
    attachAudio(el: HTMLMediaElement) {
      currentElement = el
      active = true
    },
    attachStream(_stream: MediaStream) {
      currentElement = null
      active = false
    },
    configure(_tuning: Partial<LipSyncTuning>) {
      // Timing-driven welcome audio does not use FFT tuning.
    },
    getTuning() {
      return { ...DEFAULT_LIP_SYNC_TUNING }
    },
    update(): LipSyncState {
      if (!active || !currentElement || currentElement.paused || currentElement.ended || timeline.cues.length === 0) {
        return { ...ZERO_LIP_SYNC_STATE }
      }

      const weights = sampleMouthTimeline(timeline, currentElement.currentTime, {
        intensity: 1,
        crossfadeSeconds: 0.07,
      })
      return mapMouthWeightsToLegacyLipSyncState(weights)
    },
    detach() {
      currentElement = null
      active = false
    },
  }
}

export function createHostedWelcomeTimedController(
  alignment: ElevenLabsAlignment,
): LipSyncController | null {
  const timeline = buildCharacterMouthTimeline(alignment)
  if (timeline.cues.length === 0) return null
  return createTimedLipSyncController(timeline)
}
