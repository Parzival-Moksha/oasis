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

## Spellbook + Spelltabs (current entry point for scene tools)

- `PlayerSpellbookPanel` (`src/components/forge/PlayerSpellbookPanel.tsx`) is the canonical menu for scene/build actions. The old Scene-controls block (Sky / Ground / Lights / Paint / Text 3D) was ripped out of `WorldMenu.tsx` and lives entirely in the spellbook now.
- Spell registry is `src/lib/spellbook.ts` (`SPELL_DEFS`, `SpellId`, `SpellbookPageId`). Spells are default-unlocked unless `defaultUnlocked === false`; combat spells (firebolt / lightning-bolt / ice-bolt) are also default-unlocked under the current worldbuilder-first onboarding — Quest Zero is narrative-only, not a gate.
- Spellbook cards are a responsive grid: `grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4`. Whole-card click selects/casts; hover scales; selecting pulses (`oasisSpellSelectPulse`); learning flashes (`oasisSpellLearnedPulse`).
- Spell tiles: `/ui/spellbook/tiles/<spell-id>.gpt2.webp` (and alt `.nano2.webp` under `_alternates/`). Page backgrounds: `/ui/spellbook/frame/page-bg-<chapter>.jpg`. HUD/frame art lives in `/ui/hud/` (palette PNG, alpha-keyed) and `/ui/spellbook/frame/`. Manifest: `public/ui/spellbook/manifest.json`. (Originals lived ~152 MiB; compressed pipeline cut wired assets to ~2.7 MiB.)
- Store has `selectedSpellId: SpellId | null` (`src/store/oasisStore.ts`) and `setSelectedSpellId(id)`. `selectedSpellId` is cleared on every world switch.
- Premium spelltabs live in `src/components/forge/spelltabs/` — `CraftSpellTab`, `GeneratePicSpellTab`, `GenerateMusicSpellTab`, `GenerateVideoSpellTab`, all wrapped in `SpellTabFrame`. Body components are factored into `spelltabs/bodies/` (`GeneratePicBody`, `MusicBody`, `VideoBody`, `CraftSpellBody`) so WizCon can mount the same body inside a tab.
- WizardConsole (`src/components/forge/WizardConsole.tsx`) gained Music + Video tabs; `WizardMode` is `'conjure' | 'craft' | 'world' | 'assets' | 'placed' | 'agents' | 'media' | 'music' | 'video'`. The legacy Settings tab was absorbed into the new tabbed Config menu (see ConfigMenu below). WizCon accepts an `initialTab` prop for deep-linked open (spellbook routes premium spells through it).
- The Generate Image tab includes a 4-sided-building toggle that prepends Conjure-style façade framing to the prompt — for textured building panels.

## Custom Events

- `oasis:open-spelltab` — `{ detail: { spellId } }`. Spellbook fires this for premium spells (`text-to-3d`, `text-to-pic`, `text-to-pic-building`, `text-to-music`, `text-to-video`). Standalone spelltabs listen and only open for their own id.
- `oasis:open-upload-panel` — `{ detail: { kind: 'audio' | 'video' | 'image' } }`. Fired by spellbook for `own-audio-upload`, `own-video-upload`, `own-image-upload`. Handled by `UploadPanel` (`src/components/forge/UploadPanel.tsx`).
- `oasis:cast-firebolt` / `oasis:cast-lightning-bolt` / `oasis:cast-ice-bolt` — consumed by `CombatBoltLayer`. The mobile primary-action button doesn't dispatch these directly — it synthesizes a real `PointerEvent` stack on the canvas at screen-center, which fires the same code path as a real LMB on desktop (R3F's raycaster + canvas listeners).
- `oasis:open-sky-panel`, `oasis:open-lights-panel` — fired by spellbook scene buttons.

## UploadPanel

- New panel (`src/components/forge/UploadPanel.tsx`) for focused mp3/mp4/image upload. On successful upload it enters placement mode:
  - **image** → `enterPlacementMode({ type: 'image', imageFrameStyle: 'baroque', imageFrameThickness: 7, ... })`
  - **video** → `enterPlacementMode({ type: 'video', imageFrameStyle: 'baroque', imageFrameThickness: 7, ... })`
  - **audio** → `enterPlacementMode({ type: 'catalog', catalogId: 'kf_speaker', path: '/models/kenney-furniture/speaker.glb', audioUrl, ... })`

## Placement / Image-Frame Mechanics

- `PlacementPending` and `CatalogPlacement` carry `imageFrameThickness` alongside `imageFrameStyle`.
- `imageFrameStyle === 'building'` (`WorldObjects.tsx` ~line 497) renders the image as a 4-sided textured box with a square footprint (`wallSize = h`), so each spell-generated "building façade" image becomes an in-world building.
- Placement transients preserve the player's third-person camera. `InputManager` tracks `_previousCameraState`; when `inputState` is `'placement' | 'paint'` and the prior base was `'third-person'`, `CameraController` yields to `PlayerAvatar` instead of running noclip mouse-look — players don't get flipped into a noclip-style direct camera during placement.
- The placement ghost is raycast from the canvas center (the crosshair) when pointer-locked, so it follows the crosshair instead of staying at the last hovered point (`WorldObjects.tsx` ~line 128).

## Mobile UI

- **One `MobilePrimaryActionButton`** bottom-right — always visible, contextual label (`Place` / `Fire` / spatial-web nearbyAction.label / `Select`). On tap it synthesizes a real `pointerdown` + `pointerup` + `click` PointerEvent on the canvas at screen-center coords so R3F's onClick + canvas-LMB listeners fire natively. No event-bus indirection. Spatial-web interactions are the one proximity-based exception.
- `DASH` button (formerly Run) sits above the WASD ring (`bottom-40 left-5`) so the index finger holds it while the thumb steers.
- `PlayerVitalsHud` is bottom-center on desktop, **top-center on mobile** (no overlap with thumb-zones).
- Center crosshair renders in TPS/noclip on mobile too — was pointer-lock-only before.
- `TerrainBrushPanel` on mobile pins to top-right (`right: 8, top: 64`); the texture grid is `grid-cols-4` and there is a `FULL PAINT` button that applies the selected preset to the whole ground.

## Store Surface (additions worth knowing)

- `selectedSpellId`, `setSelectedSpellId(id)` — cleared on world switch.
- `removeAgentAvatar(id)` — added to fix broken djinn / agent-avatar deletion.
- `enterPlacementMode` accepts `audioUrl` for catalog placements (speaker GLB + audio attachment).

## Anthropic Integration Notes

- Do not use `@anthropic-ai/claude-code`; use CLI subprocesses (`claude` / `claude.cmd`).
- Claude MCP servers should be registered with `claude mcp add -s project`, not by editing JSON by hand.

## Deploy (hosted)

- `pnpm deploy:openclaw` — SSH to host, pull main, install, generate, build, optional `--seed-welcome`, PM2 reload (`openclaw-oasis-web` and `openclaw-oasis-relay`).
- nginx config: `deploy/openclaw.04515.xyz.nginx.conf`.
- Deploy does NOT touch the hosted DB unless `--seed-welcome` is passed (which only reseeds Portal Zero) or the operator runs `pnpm seed:default-worlds` manually on the host.

## Key Files

- `src/store/oasisStore.ts`
- `src/lib/spellbook.ts`
- `src/lib/forge/world-persistence.ts`
- `src/lib/input-manager.ts`
- `src/lib/multiplayer-presence.ts`
- `src/lib/spatial-web.ts`
- `src/lib/google-form-spatial.ts`
- `src/lib/portal-gates.ts`
- `src/lib/portal-zero-return-gate.ts`
- `src/lib/mobile-controls.ts`
- `src/components/Scene.tsx`
- `src/components/CameraController.tsx`
- `src/components/forge/PlayerSpellbookPanel.tsx`
- `src/components/forge/PlayerVitalsHud.tsx`
- `src/components/forge/PlayerAvatar.tsx`
- `src/components/forge/UploadPanel.tsx`
- `src/components/forge/WizardConsole.tsx`
- `src/components/forge/WorldMenu.tsx`
- `src/components/forge/WorldObjects.tsx`
- `src/components/forge/TerrainBrushPanel.tsx`
- `src/components/forge/AgentWindow3D.tsx`
- `src/components/forge/MobileOasisControls.tsx`
- `src/components/forge/spelltabs/` (SpellTabFrame + 4 spelltabs + bodies/)
- `src/lib/local-auth.ts`
- `prisma/schema.prisma`
- `prisma/seed-default-worlds.ts`
- `prisma/default-worlds/portal-zero.world.json`
- `scripts/deploy-openclaw-parzival.mjs`
- `deploy/openclaw.04515.xyz.nginx.conf`
- `public/ui/spellbook/` (tiles + frame + manifest)
- `public/ui/hud/` (vials, bars, corners, backdrop)
- `carbondir/oasisspec3.txt`
- `carbondir/oasisspec4.txt`

## Docs Worth Opening

- `specs/multiplayer_spec_may4.md`
- `specs/handoff-may16-spellbook-portal-questzero.md`
- `specs/openclaw-connect-handoff-may16.md`
- `website/docs/reference/gotchas.md`
- `website/docs/developer/input-system.md`
- `website/docs/developer/phoenix-protocol.md`
