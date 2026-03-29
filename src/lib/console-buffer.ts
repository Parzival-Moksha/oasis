// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CONSOLE RING BUFFER — captures ALL server-side output for live streaming
// ─═̷─═̷─ॐ─═̷─═̷─ Persists across HMR via globalThis ─═̷─═̷─ॐ─═̷─═̷─
// Intercepts: console.log/warn/error/info + process.stdout + process.stderr
// This catches Next.js internal logs, compilation messages, 404s, route timing
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export interface ConsoleLine {
  ts: number
  level: 'log' | 'warn' | 'error' | 'info'
  text: string
}

const MAX_LINES = 800
const SYMBOL = Symbol.for('oasis-console-buffer')

interface ConsoleBuffer {
  lines: ConsoleLine[]
  listeners: Set<(line: ConsoleLine) => void>
  patched: boolean
  stdioPatched: boolean
}

function getBuffer(): ConsoleBuffer {
  const g = globalThis as Record<symbol, ConsoleBuffer>
  if (!g[SYMBOL]) {
    g[SYMBOL] = { lines: [], listeners: new Set(), patched: false, stdioPatched: false }
  }
  return g[SYMBOL]
}

function push(line: ConsoleLine) {
  const buf = getBuffer()
  buf.lines.push(line)
  if (buf.lines.length > MAX_LINES * 1.25) buf.lines = buf.lines.slice(-MAX_LINES)
  for (const fn of buf.listeners) fn(line)
}

// Strip ANSI for dedup matching but preserve it for display
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

/** Dedup window: skip stdout lines that are exact copies of recent console.log output */
const DEDUP_WINDOW = 20
const _recentConsoleTexts: string[] = []

function addRecentConsoleText(text: string) {
  _recentConsoleTexts.push(stripAnsi(text))
  if (_recentConsoleTexts.length > DEDUP_WINDOW) _recentConsoleTexts.shift()
}

function isDuplicate(text: string): boolean {
  const stripped = stripAnsi(text)
  return _recentConsoleTexts.includes(stripped)
}

export function patchConsole() {
  const buf = getBuffer()
  if (buf.patched) return
  buf.patched = true

  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  }

  function wrap(level: ConsoleLine['level'], origFn: (...args: unknown[]) => void) {
    return (...args: unknown[]) => {
      origFn(...args)
      const text = args.map(a => {
        if (typeof a === 'string') return a
        if (a === undefined || a === null || typeof a === 'symbol') return String(a)
        try { return JSON.stringify(a) } catch { return String(a) }
      }).join(' ')
      addRecentConsoleText(text)
      push({ ts: Date.now(), level, text })
    }
  }

  console.log = wrap('log', orig.log)
  console.warn = wrap('warn', orig.warn)
  console.error = wrap('error', orig.error)
  console.info = wrap('info', orig.info)
}

/**
 * Patch process.stdout.write and process.stderr.write to capture ALL server output
 * including Next.js internal logs, compilation messages, route timing, 404s, etc.
 * Safe to call multiple times — idempotent via stdioPatched flag.
 */
export function patchStdio() {
  const buf = getBuffer()
  if (buf.stdioPatched) return
  // Only patch in Node.js environment (not browser)
  if (typeof process === 'undefined' || !process.stdout || !process.stderr) return
  buf.stdioPatched = true

  const origStdoutWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write
  const origStderrWrite = process.stderr.write.bind(process.stderr) as typeof process.stderr.write

  process.stdout.write = function (chunk: unknown, ...args: unknown[]): boolean {
    const text = String(chunk).trimEnd()
    // Push non-empty, non-duplicate lines
    if (text && !isDuplicate(text)) {
      // Split multi-line output into individual lines
      const lines = text.split('\n')
      for (const line of lines) {
        const trimmed = line.trimEnd()
        if (trimmed) {
          push({ ts: Date.now(), level: 'log', text: trimmed })
        }
      }
    }
    return (origStdoutWrite as Function).call(process.stdout, chunk, ...args)
  } as typeof process.stdout.write

  process.stderr.write = function (chunk: unknown, ...args: unknown[]): boolean {
    const text = String(chunk).trimEnd()
    if (text && !isDuplicate(text)) {
      const lines = text.split('\n')
      for (const line of lines) {
        const trimmed = line.trimEnd()
        if (trimmed) {
          push({ ts: Date.now(), level: 'error', text: trimmed })
        }
      }
    }
    return (origStderrWrite as Function).call(process.stderr, chunk, ...args)
  } as typeof process.stderr.write
}

export function getLines(): ConsoleLine[] {
  return getBuffer().lines
}

export function subscribe(fn: (line: ConsoleLine) => void): () => void {
  const buf = getBuffer()
  buf.listeners.add(fn)
  return () => { buf.listeners.delete(fn) }
}

export function clearBuffer() {
  getBuffer().lines = []
}
