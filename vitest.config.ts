import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: 'automatic' as never,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    // ░▒▓ Exclude snapshot-of-other-repos that live under .codex-logs/ (audit
    // dumps from prior sessions). Vitest was picking up their *.test.* files
    // and reporting 197 environmental failures (missing jsdom + different
    // dep tree). .gitignore already excludes .codex-logs/ from git, but
    // vitest's default include glob still grabs it. ▓▒░
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.codex-logs/**',
      // Stale agent-worktree snapshots — vitest was scanning duplicate copies
      // of every test in `src/`, inflating the suite from ~2600 real tests to
      // ~14,751 and adding ~135 phantom failures. Exclude.
      '**/.claude/worktrees/**',
      '**/dist/**',
      '**/website/build/**',
    ],
  },
})
