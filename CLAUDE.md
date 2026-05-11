# CLAUDE.md

Compatibility note: Oasis's Anthropic-facing routes still tell agents to read this file. `AGENTS.md` is the canonical repo brief for agent sessions in `af_oasis`, so keep this file aligned with it.

## Repo Snapshot

- Next.js 14 + React Three Fiber + Three.js + Zustand + Prisma/SQLite
- **Dual-target**: local dev on port `4516` AND hosted production at **04515.xyz** (and openclaw.04515.xyz). `OASIS_MODE=hosted` + `OASIS_PROFILE=hosted-openclaw` flips into hosted behavior.
- The hosted Oasis is the real product surface now. Don't write for "local-first only" — imagine multiple users sharing a world via portals, presence, and (soon) auth.
- Public users land in **Portal Zero** (the welcome hub world, slug `portal-zero`).

## Commands

```bash
pnpm dev                       # local dev on :4516
pnpm dev:loop
pnpm dev:agent
pnpm dev:relay                 # local WSS relay sidecar (Hermes/OpenClaw bridges)
pnpm tsc --noEmit
pnpm test
npx prisma db push
npx prisma generate
pnpm seed:default-worlds       # seed Portal Zero + any default worlds
pnpm seed:welcome-hub          # reseed Portal Zero with a fresh snapshot
pnpm deploy:openclaw           # SSH-deploy to 04515.xyz host (pulls main, builds, PM2 reload)
pnpm smoke:relay-hosted        # WSS relay smoke test against hosted
```

## High-Signal Truths

- Local auth: `src/lib/local-auth.ts` returns `'local-user'`. Real auth is on the 10-day roadmap (`next-auth` v5-beta is already in deps).
- World data: SQLite via Prisma at `prisma/data/oasis.db`. Hosted instance has its own copy on the host machine. Deploy does NOT touch the DB unless `--seed-welcome` flag is passed.
- World saves: guarded by `_worldReady` + `_loadedObjectCount`, debounced in `src/lib/forge/world-persistence.ts`.
- World event fanout: SSE via `/api/world-events`.
- Multiplayer presence: lightweight, in `src/lib/multiplayer-presence.ts`. Spec: `specs/multiplayer_spec_may4.md`.
- Spatial web objects (buttons, sliders, selectors, text, output panels): `src/lib/spatial-web.ts`.
- Form-to-world altar: `src/lib/google-form-spatial.ts`. Test altar with Gemini tutor scoring is shipped.
- Mobile: real surface in `src/components/forge/MobileOasisControls.tsx` + `src/lib/mobile-controls.ts`. Per-world overrides supported.
- Relay sidecar (Hermes/OpenClaw WSS): routes under `/api/relay/`, lib in `src/lib/relay/`. Hosted nginx upgrades exact-match `/relay` to the relay process.
- The canonical input-state architecture lives in `src/lib/input-manager.ts` and `website/docs/developer/input-system.md`.
- 3D windows use `drei <Html transform>` and do not participate in the WebGL depth buffer.
- Asset catalog merges baked-in TS arrays with `data/asset-catalog-extras.json` + `data/ground-presets-extras.json` overrides; UI delete via `/api/library/delete`.
- Repo naming still mixes `Anorak`, `Anorak Pro`, and `Claude Code`.

## Deploy

- `pnpm deploy:openclaw` — SSH to host (`parzival-us` by default), `git pull --ff-only origin main`, `pnpm install --frozen-lockfile`, `npx prisma generate`, `pnpm build`, optional `pnpm seed:welcome-hub`, PM2 reload.
- PM2 process names on host: `openclaw-oasis-web`, `openclaw-oasis-relay`.
- nginx config: `deploy/openclaw.04515.xyz.nginx.conf` (covers `04515.xyz` + `openclaw.04515.xyz`).
- Portal Zero seed: `prisma/default-worlds/portal-zero.world.json` + `manifest.json`.

## Claude-Specific Notes

- Use CLI subprocesses for Claude Code integration. Do not use `@anthropic-ai/claude-code`.
- Do not create git worktrees for normal assistant sessions unless the user explicitly asks. If the harness opens you in a worktree, merge to main before declaring done.
- If the user wants a web-loadable artifact "in builder", place it under `public/builder/`.
- If the Oasis screenshot bridge times out, first suspect window focus before assuming a code bug.
- When the user already has `pnpm dev` (or `dev:loop` / `dev:agent`) running, prefer `pnpm tsc --noEmit` over `pnpm build`.
- Your time estimates for code changes default 5-20x too high. What you'd frame as "days of work" is usually 20-60 minutes of focused vibedev. Strip safety margin; trust the velocity.
- **Commit-soup is the default**, not selective staging. When committing, `git add -A` the dirty tree (including parallel agents' WIP). GitHub is hosting/state-sync, not clean history. Push freely. Fix-forward if the soup breaks the build. Hold back only secrets, credentials, .env, generated runtime media bloat, or files >10MB.

## Pointers

- `AGENTS.md`
- `specs/multiplayer_spec_may4.md`
- `website/docs/reference/gotchas.md`
- `website/docs/developer/input-system.md`
- `website/docs/developer/phoenix-protocol.md`
- `carbondir/oasisspec3.txt` and `carbondir/oasisspec4.txt`
