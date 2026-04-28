# AGENTS.md

This is the canonical repo instruction file for agents working in `af_oasis`.

If `CLAUDE.md`, old memory notes, or stale comments disagree with current code, prefer current repo state and fix the stale doc instead of repeating it.

## Repo

- Next.js 14 + React Three Fiber + Three.js + Zustand + Prisma/SQLite
- Local-first Oasis world builder on port `4516`
- Optimized for git-clone vibecoders, not auth-gated SaaS assumptions

## Working Rules

- Stay in the current checkout. Do not create git worktrees unless the user explicitly asks.
- If the user asks for a runnable static artifact "in builder", put the loadable file under `public/builder/`; `builder/` itself is not web-served.
- If work comes from `carbondir/oasisspec3.txt`, delete completed lines instead of marking them done.
- `ObjectInspector` is often called the "Joystick" in conversation.
- Prefer `pnpm tsc --noEmit` when the user already has `pnpm dev`, `pnpm dev:loop`, or `pnpm dev:agent` running; `pnpm build` can fight over `.next/`.

## Commands

- `pnpm dev`
- `pnpm dev:loop`
- `pnpm dev:agent`
- `pnpm tsc --noEmit`
- `pnpm test`
- `npx prisma db push`
- `npx prisma generate`

## Verification Expectations

- After non-trivial code changes, review the diff in context before declaring the task done.
- Run `pnpm tsc --noEmit` after meaningful code edits unless the user explicitly wants a lighter pass.
- Add or update tests when changed logic has a stable, testable behavior. Prefer targeted `vitest` runs over unrelated broad sweeps when the repo is busy.
- Call out any validation you could not perform, especially headed-browser or human-senses checks.
- If the user explicitly asks for delegation, Codex can use spawned agents for bounded sidecar review or verification work. Otherwise, the main agent should own implementation, self-review, and testing end to end.

## Durable Repo Truths

- `src/lib/local-auth.ts` returns `'local-user'`.
- World data is local SQLite via Prisma and lives at `prisma/data/oasis.db`.
- World persistence relies on `_worldReady` and `_loadedObjectCount` in `src/store/oasisStore.ts`, with debounced saves in `src/lib/forge/world-persistence.ts`.
- The input state machine lives in `src/lib/input-manager.ts`. Do not cite missing `project_input_state_machine.md` docs as canonical.
- 3D windows in `src/components/forge/AgentWindow3D.tsx` use `drei <Html transform>`. They are CSS overlays anchored in world space, not true WebGL depth-occluding surfaces.
- World event fanout uses SSE (`src/app/api/world-events/route.ts` and `src/lib/mcp/world-events.ts`), not Supabase Realtime.
- XP/profile/world persistence are local Prisma/SQLite codepaths in this repo.
- Current repo naming still mixes `Anorak`, `Anorak Pro`, and `Claude Code`. Do not assume rename discussions have landed.
- Each 3D Claude/Anorak window needs a unique session id.

## Anthropic Integration Notes

- Do not use `@anthropic-ai/claude-code`; use CLI subprocesses (`claude` / `claude.cmd`) for programmatic Claude Code integration.
- Claude MCP servers should be registered with `claude mcp add -s project`, not by editing JSON by hand.

## Key Files

- `src/store/oasisStore.ts`
- `src/lib/forge/world-persistence.ts`
- `src/lib/input-manager.ts`
- `src/components/forge/AgentWindow3D.tsx`
- `src/lib/local-auth.ts`
- `prisma/schema.prisma`
- `carbondir/oasisspec3.txt`

## Docs Worth Opening

- `website/docs/reference/gotchas.md`
- `website/docs/developer/input-system.md`
- `website/docs/developer/phoenix-protocol.md`
