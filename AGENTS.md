# AGENTS.md

This is the canonical repo instruction file for agents working in `af_oasis`.

If `CLAUDE.md`, old memory notes, or stale comments disagree with current code, prefer current repo state and fix the stale doc instead of repeating it.

## Repo

- Next.js 14 + React Three Fiber + Three.js + Zustand + Prisma/SQLite
- **Dual-target**: local dev on port `4516` AND hosted production at 04515.xyz / openclaw.04515.xyz. `OASIS_MODE=hosted` + `OASIS_PROFILE=hosted-openclaw` flips into hosted behavior.
- The hosted Oasis is the real product surface now. Imagine multiple users sharing a world via portals, presence, and (soon) auth.
- Public users land in **Portal Zero** (welcome hub, slug `portal-zero`).

## Working Rules

- Stay in the current checkout. Do not create git worktrees unless the user explicitly asks.
- If the user asks for a runnable static artifact "in builder", put the loadable file under `public/builder/`; `builder/` itself is not web-served.
- If work comes from `carbondir/oasisspec3.txt` or `carbondir/oasisspec4.txt`, delete completed lines instead of marking them done.
- `ObjectInspector` is often called the "Joystick" in conversation.
- Prefer `pnpm tsc --noEmit` when the user already has `pnpm dev`, `pnpm dev:loop`, `pnpm dev:agent`, or `pnpm dev:relay` running; `pnpm build` can fight over `.next/`.
- When GitHub/deploy is the practical hosting path, bias toward committing coherent dirty work instead of leaving useful feature batches stranded. Keep credentials, caches, logs, screenshots, runtime media, generated voice/music/video/image bloat, and private local state out of commits; update `.gitignore` for repeat offenders.
- **Default to commit-soup**: `git add -A` the whole dirty tree (including parallel agents' WIP) rather than selectively staging just your own files. The user prefers velocity over clean history. Push freely. Fix-forward if a sweep breaks the build.
- **Coder → reviewer → tester pipeline** on large commits. >50 files, >1000 LOC, cross-cutting changes, parallel-agent merges, or new external surfaces → spawn reviewer subagents in parallel (one per logical unit), then a tester. Reviewers REPORT findings; the coder applies fixes. Typecheck-clean is not the same as logic-clean.
- Time estimates default 5-20x too high. "Days of work" is usually 20-60 minutes of focused vibedev. Strip safety margin; the velocity is real.

## Commands

- `pnpm dev` (port 4516)
- `pnpm dev:loop`
- `pnpm dev:agent`
- `pnpm dev:relay` (WSS sidecar)
- `pnpm tsc --noEmit`
- `pnpm test`
- `npx prisma db push`
- `npx prisma generate`
- `pnpm seed:default-worlds`
- `pnpm seed:welcome-hub` (reseed Portal Zero)
- `pnpm deploy:openclaw` (SSH-deploy to hosted host)
- `pnpm smoke:relay-hosted` (relay smoke against hosted)

## Verification Expectations

- After non-trivial code changes, review the diff in context before declaring the task done.
- Run `pnpm tsc --noEmit` after meaningful code edits unless the user explicitly wants a lighter pass.
- Add or update tests when changed logic has a stable, testable behavior. Prefer targeted `vitest` runs over unrelated broad sweeps when the repo is busy.
- Call out any validation you could not perform, especially headed-browser or human-senses checks.
- If the user explicitly asks for delegation, Codex can use spawned agents for bounded sidecar review or verification work. Otherwise, the main agent should own implementation, self-review, and testing end to end.

## Durable Repo Truths

- Local auth: `src/lib/local-auth.ts` returns `'local-user'`. Real auth is on the 10-day roadmap (`next-auth` v5-beta in deps).
- World data: SQLite via Prisma at `prisma/data/oasis.db`. Hosted instance has its own copy.
- World saves: `_worldReady` + `_loadedObjectCount` in `src/store/oasisStore.ts`, debounced in `src/lib/forge/world-persistence.ts`.
- World event fanout: SSE (`src/app/api/world-events/route.ts`, `src/lib/mcp/world-events.ts`).
- Multiplayer presence: `src/lib/multiplayer-presence.ts`. Spec: `specs/multiplayer_spec_may4.md`.
- Relay WSS sidecar: routes at `/api/relay/*`, lib in `src/lib/relay/`. PM2 process `openclaw-oasis-relay`. Hosted nginx upgrades exact-match `/relay`.
- Portal Zero (welcome hub): seeded from `prisma/default-worlds/portal-zero.world.json`, return-gate logic in `src/lib/portal-zero-return-gate.ts`.
- Form-to-world altar: `src/lib/google-form-spatial.ts` + spatial primitives in `src/lib/spatial-web.ts`.
- Mobile: `src/components/forge/MobileOasisControls.tsx` + `src/lib/mobile-controls.ts`; per-world overrides supported.
- Asset catalog: merges baked-in TS arrays with `data/asset-catalog-extras.json` + `data/ground-presets-extras.json`; delete via `/api/library/delete`.
- Input state machine: `src/lib/input-manager.ts`. Don't cite missing `project_input_state_machine.md` docs as canonical.
- 3D windows in `src/components/forge/AgentWindow3D.tsx` use drei `<Html transform>` — CSS overlays anchored in world space, not WebGL depth-occluding.
- Repo naming still mixes `Anorak`, `Anorak Pro`, and `Claude Code`. Don't assume rename discussions have landed.
- Each 3D Claude/Anorak window needs a unique session id.

## Anthropic Integration Notes

- Do not use `@anthropic-ai/claude-code`; use CLI subprocesses (`claude` / `claude.cmd`).
- Claude MCP servers should be registered with `claude mcp add -s project`, not by editing JSON by hand.

## Deploy (hosted)

- `pnpm deploy:openclaw` — SSH to host, pull main, install, generate, build, optional `--seed-welcome`, PM2 reload (`openclaw-oasis-web` and `openclaw-oasis-relay`).
- nginx config: `deploy/openclaw.04515.xyz.nginx.conf`.
- Deploy does NOT touch the hosted DB unless `--seed-welcome` is passed (which only reseeds Portal Zero) or the operator runs `pnpm seed:default-worlds` manually on the host.

## Key Files

- `src/store/oasisStore.ts`
- `src/lib/forge/world-persistence.ts`
- `src/lib/input-manager.ts`
- `src/lib/multiplayer-presence.ts`
- `src/lib/spatial-web.ts`
- `src/lib/google-form-spatial.ts`
- `src/lib/portal-gates.ts`
- `src/lib/portal-zero-return-gate.ts`
- `src/lib/mobile-controls.ts`
- `src/components/forge/AgentWindow3D.tsx`
- `src/components/forge/MobileOasisControls.tsx`
- `src/lib/local-auth.ts`
- `prisma/schema.prisma`
- `prisma/seed-default-worlds.ts`
- `prisma/default-worlds/portal-zero.world.json`
- `scripts/deploy-openclaw-parzival.mjs`
- `deploy/openclaw.04515.xyz.nginx.conf`
- `carbondir/oasisspec3.txt`
- `carbondir/oasisspec4.txt`

## Docs Worth Opening

- `specs/multiplayer_spec_may4.md`
- `website/docs/reference/gotchas.md`
- `website/docs/developer/input-system.md`
- `website/docs/developer/phoenix-protocol.md`
