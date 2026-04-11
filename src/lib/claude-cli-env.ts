const STRIP_EXACT_KEYS = new Set([
  'NODE_OPTIONS',
  'NEXT_RUNTIME',
  'NEXT_PHASE',
])

const STRIP_PREFIXES = [
  '__NEXT',
  'NEXT_PRIVATE_',
  'TURBO',
  'TURBOPACK',
  'WEBPACK_',
]

export function buildClaudeCliEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  for (const key of Object.keys(env)) {
    if (STRIP_EXACT_KEYS.has(key) || STRIP_PREFIXES.some(prefix => key.startsWith(prefix))) {
      delete env[key]
    }
  }

  return {
    ...env,
    ...extra,
  }
}
