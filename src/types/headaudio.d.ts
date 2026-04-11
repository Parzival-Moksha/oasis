declare module '@met4citizen/headaudio/modules/headaudio.mjs' {
  export class HeadAudio extends AudioWorkletNode {
    constructor(audioCtx: AudioContext, options?: {
      processorOptions?: Record<string, unknown>
      parameterData?: Record<string, number>
    })
    onvalue: ((key: string, value: number) => void) | null
    onstarted: ((data: { event: string; t: number }) => void) | null
    onended: ((data: { event: string; t: number }) => void) | null
    loadModel(url: string, reset?: boolean): Promise<void>
    update(dt: number): void
    start(): void
    stop(): void
    calibrate(): void
    visemeNames: string[]
    visemeAlphas: number[]
    visemeActive: number
    isRunning: boolean
  }
}
