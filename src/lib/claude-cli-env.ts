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

// When the Oasis itself was started from a Claude Code session (desktop app,
// terminal, an agent), the parent injects CLAUDECODE=1, CLAUDE_CODE_ENTRYPOINT,
// session ids and messaging sockets. A child that inherits them behaves like a
// nested session, so drop them and keep only user-level configuration.
const KEEP_CLAUDE_KEYS = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_GIT_BASH_PATH',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
])

export function buildClaudeCliEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  for (const key of Object.keys(env)) {
    if (STRIP_EXACT_KEYS.has(key) || STRIP_PREFIXES.some(prefix => key.startsWith(prefix))) {
      delete env[key]
    } else if ((key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) && !KEEP_CLAUDE_KEYS.has(key)) {
      delete env[key]
    }
  }

  return {
    ...env,
    ...extra,
  }
}
