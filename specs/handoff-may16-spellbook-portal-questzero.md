# Handoff - Spellbook, portal prewarm, and Quest Zero polish (2026-05-16)

For the next agent picking up `af_oasis`. This handoff covers the May 16 pass that turned the spell substrate into a visible menu, smoothed portal materialization, tightened realtime NPC teardown, and tested native-alpha image generation for future UI texture work.

## TL;DR

Commit `78091a8` (`Add spellbook chapters and portal prewarm`) is pushed to `origin/main` and deployed to hosted `openclaw.04515.xyz`.

The Oasis now has a real `SPELLS` rail menu with the seven oasisspec4 chapters. Firebolt, Lightning Bolt, and Ice Bolt are locked quest/combat spells; the rest of the spell paths are visible and treated as available for this first spellbook pass. Firebolt still becomes learned through the Fire Guardian target trial.

Portal reveal now preloads the starry portal texture and hidden portal visuals before Q/P materialization, then plays a procedural no-light spawn burst. This is intended to reduce the 1-2 second portal hitch without repeating the Firebolt dynamic-light freeze issue.

Fire Guardian completion now exclaims `WELL DONE!`, opens the spellbook to Firebolt, and explicitly disconnects the realtime NPC voice line shortly after. Realtime sessions also tear down on `pagehide` / `beforeunload`.

## What landed

### Spellbook registry

`src/lib/spellbook.ts` now holds the first full spell registry:

- `recipe-catalog`: `Place`
- `premium`: `Text to 3D`, `Text to Pic`, `Text to Pic Building`, `Text to Music`, `Text to Video`, `Text to Object`, `Text to Character`
- `world-root`: `Portal Craft`, `Background`, `Ground Texture`, `Ground Elevation`, `Lights`
- `creative`: `Brush Wand`, `3D Text`
- `own-spells`: `Own MP3`, `Own MP4`, `Own Image`
- `combat`: `Firebolt`, `Lightning Bolt`, `Ice Bolt`
- `agent`: `Summon Djinn`, `Summon Custom NPC`, `Summon Fighter NPC`, `Summon OpenClaw`, `Summon Hermes`

New spell metadata:

- `defaultUnlocked?: boolean`
- `actionId?: SpellActionId`
- `lockedSummary?: string`

`isSpellDefaultUnlocked()` is the current simple rule: everything defaults available except combat bolts, which must be learned.

### Spellbook UI

`src/components/forge/PlayerSpellbookPanel.tsx` is now a controlled menu panel:

- Opened by the new rail `Spells` button or `B`.
- Uses seven horizontal tabs.
- Shows all registered spells, not just learned spells.
- Highlights newly learned Firebolt when Quest Zero completes.
- Routes known actions into existing Oasis panels:
  - Place -> old placement palette
  - Brush Wand -> paint wand panel
  - Background -> sky panel
  - Ground Texture -> terrain texture brush
  - Ground Elevation -> terrain sculpt brush
  - Lights -> lights panel
  - 3D Text -> text panel
  - Merlin/OpenClaw/Hermes summons -> agent placement mode
  - premium/media/portal paths -> Wizard Console for now

`src/components/forge/PlaceMenu.tsx` was renamed from `Spells` to `Place`, and it listens for `oasis:open-place-menu` so the spellbook can open it.

### Portal prewarm and reveal VFX

`src/components/forge/PortalGateVisual.tsx` now exports `preloadPortalGateVisualAssets()`, which touches the shared starry HDRI texture loader.

`src/components/forge/PortalGateLayer.tsx` now:

- Calls portal asset preload on active-world changes and gate changes.
- Renders tiny offscreen warmup copies of hidden gates so first reveal has less material/texture work to do.
- Emits a short procedural burst on `oasis:portal-gate-reveal`.
- Uses `meshBasicMaterial` only; no dynamic point lights.

This should help the Q/P portal reveal hitch. It is not a guarantee against every GPU stall because browser/GPU shader compilation can still choose awkward moments, but it moves the obvious portal texture/material work earlier.

### Fire Guardian and realtime teardown

`src/components/forge/FireboltLayer.tsx` now dispatches `oasis:realtime-disconnect-npc` after Firebolt unlock, delayed so the `WELL DONE!` exclamation can land first.

`src/components/forge/RealtimePanel.tsx` now:

- Disconnects when the panel unmounts, as before.
- Also disconnects on `pagehide` / `beforeunload`.
- Listens for `oasis:realtime-disconnect-npc` and tears down matching NPC sessions.

Practical meaning: closing the tab should stop mic/audio/WebRTC, and the Fire Guardian should not continue consuming OpenAI realtime credits after the quest completion moment.

### Native-alpha UI texture experiment

`gpt-image-1.5` was tested through the OpenAI Images API with transparent PNG output. It produced real alpha:

- `public/ui/wizard-textures/generated/oasis-ui-native-alpha-lab/gpt-image-15-native-alpha-spellbook-runes.png`
- `public/ui/wizard-textures/generated/oasis-ui-native-alpha-lab/gpt-image-15-native-alpha-vials-command.png`
- `public/ui/wizard-textures/generated/oasis-ui-native-alpha-lab/contact-sheet.jpg`
- `public/ui/wizard-textures/generated/oasis-ui-native-alpha-lab/manifest.json`

These generated files are intentionally ignored and were not committed.

Quick model scan result:

- Confirmed: `gpt-image-1.5` can produce true-alpha PNG.
- Confirmed from OpenAI docs: `gpt-image-2` does not currently support transparent background.
- Likely useful but not native-alpha-confirmed in this scan: Nano Banana 2 / Gemini image models.
- Not native-alpha-confirmed in this scan: Seedream v4.
- Promising non-OpenAI route: fal Ideogram V3 transparent endpoint.

## Deploy and validation

Validated locally:

```powershell
pnpm tsc --noEmit
pnpm vitest run src/lib/__tests__/quest-zero-npc-pipeline.test.ts src/lib/__tests__/player-progression.test.ts
```

Results:

- TypeScript passed.
- Vitest passed: 2 files, 7 tests.

Committed and pushed:

```text
78091a8 Add spellbook chapters and portal prewarm
```

Hosted deploy:

```powershell
pnpm deploy:openclaw
```

Deploy finished successfully:

- `openclaw-oasis-web` reloaded.
- `openclaw-oasis-relay` reloaded.
- `openclaw-oasis-room` reloaded.
- Hosted health returned ok.

Hosted relay smoke passed when run with explicit hosted URLs:

```powershell
$env:OASIS_URL='https://openclaw.04515.xyz'
$env:RELAY_URL='wss://openclaw.04515.xyz'
pnpm smoke:relay-hosted
```

Note: running `pnpm smoke:relay-hosted` without env vars defaults to localhost and failed because the local relay socket was not healthy. Hosted relay was healthy.

## Carbon tests for the user

1. Hard refresh `https://openclaw.04515.xyz`.
2. Confirm the rail shows `Spells` and the old object palette says `Place`.
3. Open `Spells`; verify seven tabs and that Firebolt/Lightning/Ice are locked on a fresh identity.
4. In an editable world, test World tab actions: Background, Ground Texture, Ground Elevation, Lights.
5. In Rookie Wizard, hit `Q` or `P` near Merlin; portal reveal should feel smoother and show the new burst.
6. Complete the Fire Guardian target trial; expect `WELL DONE!`, Firebolt learned toast, spellbook opening to Combat, and the realtime line dropping idle shortly after.
7. Start any realtime conversation, then close the tab. Browser mic/audio activity should stop.

## Known risks and gotchas

- The spellbook lists future spell paths before all of them have dedicated final tools. Premium/media/portal paths currently open Wizard Console as the best available route.
- Firebolt casting still depends on RP1 / FireboltLayer enablement. The spellbook can display Firebolt, but combat UX still belongs to RP mode.
- Portal prewarm reduces likely hitch points but does not eliminate every possible browser/GPU shader compile stall.
- Generated UI alpha images are experimental scratch outputs, not committed product assets.
- `toggleOpenclawPanel` was already an unused lint warning in `Scene.tsx`; build still passes with warnings.

## Next steps

1. Make the spellbook the source of truth for scene tools. Remove duplicated Sky/Ground/Lights/Paint/Text entry points from WorldMenu once the spellbook feels good on desktop and mobile.
2. Add icons and first-pass art per spell. Use native-alpha `gpt-image-1.5` or fal Ideogram transparent, then slice/export individual PNG sprites.
3. Add a `spellbookStatus` or `implemented` flag so future spells can be visually distinct from wired spells without hiding them.
4. Make Firebolt castable from the spellbook by putting the player into RP1/combat mode if needed, or showing a crisp "enter RP1" command.
5. Add spell achievements for `learn-first-spell`, `learn-3-spells`, `learn-5-spells`, `first-world-root-spell`, and `first-agent-summon`.
6. Convert Fire Guardian teardown into a general NPC quest-completion behavior: exclaim, optionally speak one final line, record memory/progression, hang up voice, keep avatar present.
7. Profile portal reveal in Brave/Chrome/Firefox with devtools performance. If the hitch remains, precompile portal shaders after world load using a tiny visible warmup pass or renderer compile hook.
8. Start the real visual spellbook pass: 7 chapter tabs now, later an actual book with alpha-textured page frames, spell cards, vials, and chapter dividers.

