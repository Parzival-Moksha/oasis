import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import { unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export type VoiceBackendState = 'idle' | 'loading' | 'ready' | 'error'

export interface VoiceTranscriptionBackendStatus {
  provider: 'local-faster-whisper'
  state: VoiceBackendState
  message: string
  model: string
  device: string
  computeType: string
}

interface WorkerStatusMessage {
  type: 'status'
  state: Exclude<VoiceBackendState, 'idle'>
  message?: string
  model?: string
  device?: string
  computeType?: string
}

interface WorkerResultMessage {
  type: 'result'
  id: string
  ok: boolean
  transcript?: string
  language?: string | null
  duration?: number | null
  error?: string
}

type WorkerMessage = WorkerStatusMessage | WorkerResultMessage

interface LocalTranscriptionResult {
  transcript: string
  language?: string | null
  duration?: number | null
}

interface PendingRequest {
  resolve: (result: LocalTranscriptionResult) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

interface ReadyPromiseSlot {
  promise: Promise<VoiceTranscriptionBackendStatus>
  resolve: (status: VoiceTranscriptionBackendStatus) => void
  reject: (error: Error) => void
}

const LOCAL_PROVIDER = 'local-faster-whisper' as const
const DEFAULT_MODEL = process.env.OASIS_STT_MODEL?.trim() || 'distil-large-v3'
const DEFAULT_DEVICE = process.env.OASIS_STT_DEVICE?.trim() || 'auto'
const DEFAULT_COMPUTE_TYPE = process.env.OASIS_STT_COMPUTE_TYPE?.trim() || 'float16'
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000
const WORKER_SCRIPT_PATH = join(process.cwd(), 'src', 'lib', 'voice', 'local-stt-worker.py')

function createStatus(overrides?: Partial<VoiceTranscriptionBackendStatus>): VoiceTranscriptionBackendStatus {
  return {
    provider: LOCAL_PROVIDER,
    state: 'idle',
    message: '',
    model: DEFAULT_MODEL,
    device: DEFAULT_DEVICE,
    computeType: DEFAULT_COMPUTE_TYPE,
    ...overrides,
  }
}

function createReadyPromise(): ReadyPromiseSlot {
  let resolve!: (status: VoiceTranscriptionBackendStatus) => void
  let reject!: (error: Error) => void
  const promise = new Promise<VoiceTranscriptionBackendStatus>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

class LocalSttManager {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private pending = new Map<string, PendingRequest>()
  private status = createStatus()
  private readySlot: ReadyPromiseSlot | null = null

  getStatus(): VoiceTranscriptionBackendStatus {
    return this.status
  }

  async ensureReady(): Promise<VoiceTranscriptionBackendStatus> {
    if (this.status.state === 'ready') return this.status
    if (this.status.state === 'error') {
      throw new Error(this.status.message || 'Local STT is unavailable.')
    }

    this.startWorker()
    if (!this.readySlot) {
      this.readySlot = createReadyPromise()
    }

    return this.readySlot.promise
  }

  async transcribe(audioBytes: Buffer, extension: string, language = 'auto'): Promise<LocalTranscriptionResult> {
    await this.ensureReady()

    const filePath = join(tmpdir(), `oasis-stt-${randomUUID()}${extension}`)
    await writeFile(filePath, audioBytes)

    try {
      return await this.requestTranscription(filePath, language)
    } finally {
      await unlink(filePath).catch(() => {})
    }
  }

  private requestTranscription(audioPath: string, language: string): Promise<LocalTranscriptionResult> {
    const child = this.child
    if (!child) {
      return Promise.reject(new Error('Local STT worker is not running.'))
    }

    const id = randomUUID()
    const payload = JSON.stringify({
      type: 'transcribe',
      id,
      audioPath,
      language,
    })

    return new Promise<LocalTranscriptionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Local STT timed out while transcribing audio.'))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, {
        resolve,
        reject,
        timeout,
      })

      child.stdin.write(`${payload}\n`, error => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timeout)
        this.pending.delete(id)
        reject(new Error(`Unable to send audio to the local STT worker: ${error.message}`))
      })
    })
  }

  private startWorker() {
    if (this.child || this.status.state === 'error') return

    const command = this.getPythonCommand()
    this.readySlot = createReadyPromise()
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    this.status = createStatus({
      state: 'loading',
      message: `Loading ${DEFAULT_MODEL}...`,
    })

    const child = spawn(command.executable, [...command.args, '-u', WORKER_SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        OASIS_STT_MODEL: DEFAULT_MODEL,
        OASIS_STT_DEVICE: DEFAULT_DEVICE,
        OASIS_STT_COMPUTE_TYPE: DEFAULT_COMPUTE_TYPE,
      },
    })

    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => this.handleStdout(chunk))
    child.stderr.on('data', chunk => this.handleStderr(chunk))
    child.once('error', error => {
      this.failWorker(`Local STT worker failed to start: ${error.message}`)
    })
    child.once('exit', (code, signal) => {
      const stderr = this.stderrBuffer.trim()
      const detail = stderr || (signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`)
      this.failWorker(`Local STT worker stopped unexpectedly: ${detail}`)
    })
  }

  private getPythonCommand(): { executable: string; args: string[] } {
    const override = process.env.OASIS_STT_PYTHON?.trim()
    if (override) {
      return { executable: override, args: [] }
    }

    if (process.platform === 'win32') {
      return { executable: 'py', args: ['-3.13'] }
    }

    return { executable: 'python3', args: [] }
  }

  private handleStdout(chunk: string) {
    this.stdoutBuffer += chunk
    const lines = this.stdoutBuffer.split(/\r?\n/)
    this.stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let message: WorkerMessage | null = null
      try {
        message = JSON.parse(trimmed) as WorkerMessage
      } catch {
        continue
      }
      this.handleWorkerMessage(message)
    }
  }

  private handleStderr(chunk: string) {
    this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-6000)
  }

  private handleWorkerMessage(message: WorkerMessage) {
    if (message.type === 'status') {
      this.status = createStatus({
        state: message.state,
        message: message.message?.trim() || '',
        model: message.model?.trim() || DEFAULT_MODEL,
        device: message.device?.trim() || DEFAULT_DEVICE,
        computeType: message.computeType?.trim() || DEFAULT_COMPUTE_TYPE,
      })

      if (message.state === 'ready' && this.readySlot) {
        this.readySlot.resolve(this.status)
      } else if (message.state === 'error' && this.readySlot) {
        this.readySlot.reject(new Error(this.status.message || 'Local STT failed to load.'))
        this.readySlot = null
      }
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pending.delete(message.id)

    if (!message.ok) {
      pending.reject(new Error(message.error || 'Local STT transcription failed.'))
      return
    }

    pending.resolve({
      transcript: message.transcript?.trim() || '',
      language: message.language ?? null,
      duration: typeof message.duration === 'number' ? message.duration : null,
    })
  }

  private failWorker(message: string) {
    this.child = null
    this.status = createStatus({
      state: 'error',
      message,
    })

    if (this.readySlot) {
      this.readySlot.reject(new Error(message))
      this.readySlot = null
    }

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(message))
      this.pending.delete(id)
    }
  }
}

declare global {
  var __oasisLocalSttManager: LocalSttManager | undefined
}

function getManager(): LocalSttManager {
  if (!globalThis.__oasisLocalSttManager) {
    globalThis.__oasisLocalSttManager = new LocalSttManager()
  }
  return globalThis.__oasisLocalSttManager
}

export function getLocalSttStatus(): VoiceTranscriptionBackendStatus {
  return getManager().getStatus()
}

export async function warmLocalStt(): Promise<VoiceTranscriptionBackendStatus> {
  return getManager().ensureReady()
}

export async function transcribeLocally(audioBytes: Buffer, extension: string, language = 'auto') {
  return getManager().transcribe(audioBytes, extension, language)
}
