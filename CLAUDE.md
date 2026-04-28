# CLAUDE.md

Compatibility note: Oasis's Anthropic-facing routes still tell agents to read this file. `AGENTS.md` is the canonical repo brief for agent sessions in `af_oasis`, so keep this file aligned with it.

## Repo Snapshot

- Next.js 14 + React Three Fiber + Three.js + Zustand + Prisma/SQLite
- Local-first Oasis world builder on port `4516`
- Built for git-clone vibecoders first

## Commands

```bash
pnpm dev
pnpm dev:loop
pnpm dev:agent
pnpm tsc --noEmit
pnpm test
npx prisma db push
npx prisma generate
```

## High-Signal Truths

- `src/lib/local-auth.ts` returns `'local-user'`.
- World data is local SQLite at `prisma/data/oasis.db`.
- World saves are guarded by `_worldReady` and `_loadedObjectCount` and debounced in `src/lib/forge/world-persistence.ts`.
- The canonical input-state architecture lives in `src/lib/input-manager.ts` and `website/docs/developer/input-system.md`.
- 3D windows use `drei <Html transform>` and do not participate in the WebGL depth buffer.
- World event fanout is SSE-based now, and XP/profile/world persistence are local Prisma/SQLite.
- Repo naming still mixes `Anorak`, `Anorak Pro`, and `Claude Code`.

## Claude-Specific Notes

- Use CLI subprocesses for Claude Code integration. Do not use `@anthropic-ai/claude-code`.
- Do not create git worktrees for normal assistant sessions unless the user explicitly asks.
- If the user wants a web-loadable artifact "in builder", place it under `public/builder/`.
- If the Oasis screenshot bridge times out, first suspect window focus before assuming a code bug.

## Pointers

- `AGENTS.md`
- `website/docs/reference/gotchas.md`
- `website/docs/developer/input-system.md`
- `carbondir/oasisspec3.txt`
