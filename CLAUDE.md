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
- The canonical input-state architecture lives in `src/lib/input-manager.ts` and `website/docs/developer/input-system.md`. `InputManager` tracks `_previousCameraState` so transient `placement` / `paint` states can yield camera control back to the prior base mode (third-person etc).
- 3D windows use `drei <Html transform>` and do not participate in the WebGL depth buffer.
- Asset catalog merges baked-in TS arrays with `data/asset-catalog-extras.json` + `data/ground-presets-extras.json` overrides; UI delete via `/api/library/delete`.
- Repo naming still mixes `Anorak`, `Anorak Pro`, and `Claude Code`.

## Spellbook + Spelltabs

- `PlayerSpellbookPanel` (`src/components/forge/PlayerSpellbookPanel.tsx`) is the canonical entry for scene tools (sky/ground/lights/paint/text-3d) — the old Scene-controls block was ripped out of `WorldMenu.tsx`.
- Spell registry: `src/lib/spellbook.ts` (`SPELL_DEFS`, `SpellId`, `SpellbookPageId`). All spells default-unlocked including combat (firebolt / lightning-bolt / ice-bolt); Quest Zero is narrative-only.
- Store: `selectedSpellId: SpellId | null` in `src/store/oasisStore.ts`, cleared on world switch. `removeAgentAvatar(id)` added to fix djinn deletion.
- Standalone spelltabs in `src/components/forge/spelltabs/` (`CraftSpellTab`, `GeneratePicSpellTab`, `GenerateMusicSpellTab`, `GenerateVideoSpellTab`) wrap `SpellTabFrame`. Their body components are factored into `spelltabs/bodies/` so `WizardConsole` mounts the same body inside Music/Video tabs.
- `WizardConsole` accepts `initialTab?: WizardMode` for deep-linked open. `WizardMode` now includes `'music'` and `'video'`. The Generate Image tab has a 4-sided-building toggle that prepends Conjure-style façade framing.
- Spellbook cards: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`, whole-card click, hover scale + select pulse + learned flash.
- Spell tile art: `/ui/spellbook/tiles/<spell-id>.gpt2.webp` (alt `.nano2.webp` under `_alternates/`). Page backgrounds: `/ui/spellbook/frame/page-bg-<chapter>.jpg`. HUD art in `/ui/hud/` (PNG, palette-compressed). Manifest: `public/ui/spellbook/manifest.json`.

## Custom Events

- `oasis:open-spelltab` — `{ detail: { spellId } }`. Spellbook fires this for premium spells; standalone spelltabs only open for their own id.
- `oasis:open-upload-panel` — `{ detail: { kind: 'audio' | 'video' | 'image' } }` → `UploadPanel` (`src/components/forge/UploadPanel.tsx`).
- `oasis:cast-firebolt` / `oasis:cast-lightning-bolt` / `oasis:cast-ice-bolt` — bolt cast events consumed by `CombatBoltLayer`. The mobile primary-action button instead dispatches a synthetic `PointerEvent` on the canvas (treated like a real LMB).

## UploadPanel + Placement

- Image/video uploads enter placement with `imageFrameStyle: 'baroque'`, `imageFrameThickness: 7`. Audio uploads place a `kf_speaker` GLB with `audioUrl` attached.
- `PlacementPending` + `CatalogPlacement` carry `imageFrameThickness` alongside `imageFrameStyle`.
- `imageFrameStyle === 'building'` (in `WorldObjects.tsx`) renders the image as a 4-sided textured box with a square footprint — used for generated façade images.
- Placement transients preserve the player's third-person camera: `CameraController` yields to `PlayerAvatar` when `inputState ∈ {placement, paint}` and `_previousCameraState === 'third-person'`. No noclip-style camera hijack mid-spell.
- The placement ghost raycasts from the canvas center (crosshair) under pointer-lock, so it follows the cursor lock instead of the last hovered point.

## Mobile

- **One `MobilePrimaryActionButton`** bottom-right — always visible, label morphs by context (`Place` / `Fire` / spatial-web nearbyAction.label / `Select`). On tap it synthesizes a real `pointerdown` + `pointerup` + `click` PointerEvent on the canvas at screen-center coords, so R3F's onClick + the canvas LMB listeners fire natively (no event-bus indirection). Spatial-web actions are the one proximity-based exception.
- `DASH` button (renamed from Run) sits above the WASD ring on the left side so the index finger can hold it while the thumb steers.
- `PlayerVitalsHud` is bottom-center on desktop, top-center on mobile (no overlap with thumb-zones).
- Center crosshair renders in TPS/noclip on mobile too (was pointer-lock-only).
- `TerrainBrushPanel` on mobile pins top-right (`right: 8, top: 64`), texture grid is `grid-cols-4`, and includes a `FULL PAINT` button.

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
- **Coder → reviewer → tester reflex.** After large commits (>50 files, >1000 LOC, cross-cutting refactor, commit-soup with parallel-agent WIP, or new external surfaces), spawn reviewer subagents in parallel — one per logical unit of work. Each reviewer reads the diff for its unit and reports logic bugs / races / security holes / broken invariants. After reviewers, dispatch a tester subagent if the change has runtime surfaces (HTTP/WS/MCP/browser). Don't wait to be asked.

## Pointers

- `AGENTS.md`
- `specs/multiplayer_spec_may4.md`
- `specs/handoff-may16-spellbook-portal-questzero.md`
- `specs/openclaw-connect-handoff-may16.md`
- `website/docs/reference/gotchas.md`
- `website/docs/developer/input-system.md`
- `website/docs/developer/phoenix-protocol.md`
- `carbondir/oasisspec3.txt` and `carbondir/oasisspec4.txt`
