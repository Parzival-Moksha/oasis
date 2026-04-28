# Mission #87 — Field Notes from Anorak Pro's Live Eyes Test

> Recorded 2026-04-21 by Anorak Pro from the Oasis MCP session. Empirical data to aid the south-loop coder.

## TL;DR

The "Anorak/Hermes can't see" framing is **WRONG**. Anorak's eyes work for most modes. The REAL issues are:
1. Subject resolution (agentType alias mismatch)
2. Missing-subject returns a 20s lying timeout instead of a clean error
3. `mode=current` is intermittent around world-switch transitions
4. Results flow into AnorakPro stream as plain text, not inline image pills
5. MCP tool doesn't return image content blocks (Anorak has to Read() the file)

## Live Truth Matrix — two test rounds, same session

### Round 1 @ world `world-1775697550663-k95m` "The Oasis"
| Call | Result |
|---|---|
| `mode=external` | ✅ |
| `mode=player` | ✅ |
| `mode=third-person-follow agent=player` | ✅ |
| `mode=look-at` | ✅ |
| `avatarpic_user` portrait + tps | ✅✅ |
| `screenshot_avatar subject=anorak` | ✅ (Anorak avatar WAS placed here) |
| `mode=current` | ❌ timeout |
| `avatarpic_merlin` | ❌ (no Merlin in this world) |

### Round 2 @ world `world-1776651675360-81bd` "OpenClaw test1"
| Call | Result |
|---|---|
| `mode=current` | ✅ (flipped from round 1 — intermittent) |
| `mode=look-at` | ✅ |
| `mode=third-person-follow agentType=player` | ✅ |
| `mode=avatar-portrait agentType=player` | ✅ |
| `avatarpic_user` portrait + tps | ✅✅ |
| `avatarpic_merlin` | ✅ (Merlin IS placed here) |
| `screenshot_avatar subject=openclaw` | ✅ |
| `screenshot_avatar subject=anorak-pro` | ✅ |
| `screenshot_avatar subject=clawdling` | ✅ |
| `mode=agent-avatar-phantom agentType=anorak` | ❌ |
| `mode=external-orbit agentType=anorak` | ❌ |
| `mode=third-person-follow agentType=anorak` | ❌ |
| `mode=avatar-portrait agentType=anorak` | ❌ |
| `screenshot_avatar subject=anorak` | ❌ |
| `screenshot_avatar subject=hermes` | ❌ (no Hermes in this world) |

## Root causes — your debug map

### Cause 1: Subject alias mismatch (NEW, priority high)
`query_objects type=agent-avatar` in round 2 returned:
- `Clawdling` → id `agent-avatar-clawdling-...`
- `OpenClaw` → id `agent-avatar-openclaw-...`
- `Merlin` → id `agent-avatar-merlin-...`
- `Anorak Pro` → id `agent-avatar-anorak-pro`

Tool accepts `agentType="anorak"` per the description. Bridge at `ViewportScreenshotBridge.tsx:95` does:
```ts
placedAgentAvatars.find(entry => entry.agentType === view.agentType)
```
Placed avatar's `agentType` is literally `"anorak-pro"` — strict equality fails for `"anorak"`. Same pattern for any alias.

**Fix direction**: either a normalize map (`anorak → anorak-pro`, `cc → claude-code`, etc.) before the `.find()`, OR substring/fuzzy match fallback. Whichever you pick, the MCP tool description needs to stay truthful afterwards.

### Cause 2: Missing subject → 20s timeout lie (Bug B in spec)
When `placedAgentAvatars.find(...)` returns undefined, bridge bails silently with `return null`. The pending job never gets delivered OR rejected, so `oasis-tools.ts:1818` Promise hits 20s timeout with generic "bridge unavailable". **Fix**: bridge should POST a structured error response `{ ok: false, reason: "subject_not_in_world", subject, worldId }` to the tools endpoint. Then `screenshot_viewport` resolves in <1s with clean message like `"Merlin not placed in this world — add via place_object or set_avatar first."`

### Cause 3: `mode=current` intermittent
Same world, same session, failed twice in round 1 then worked clean in round 2. No world change in between, no apparent state difference. Hypothesis: R3F `camera` ref unavailable during a React reconciliation window tied to the HMR reload or agent panel mount. Add instrumentation:
```ts
if (view.mode === 'current') {
  if (!camera) {
    console.warn('[ScreenshotBridge] mode=current but camera ref is null')
    return null  // → same silent failure as Cause 2, same fix
  }
  // existing capture logic
}
```
Might be fixed incidentally by the Cause-2 fix (structured error surfaces the issue).

### Cause 4: AnorakPro stream renders no inline pill
- Reference impl: `MerlinPanel.tsx:91` (MERLIN_VISION_TOOL_NAMES set), `:658` (mediaCompact=false for vision tools), `:1063-1093` (builds `data:image/${format};base64,${base64}` then renders inline).
- `AnorakProPanel.tsx:580-611` handles event types `text/error/stderr/thinking/result/media` but doesn't special-case screenshot tools — result flows in as text with URL string.
- Copy Merlin's extract-media pattern, gate by tool name, render expanded `<img>`.

### Cause 5: MCP result doesn't include image content block
- Currently `oasis-tools.ts:1842-1845` returns `{primaryCaptureUrl, primaryCapturePath, base64}` inside JSON.
- MCP standard supports `{type: "image", data: <base64>, mimeType: "image/jpeg"}` as a content block alongside text. Returning this makes Anorak receive the bytes in-context with no Read() step.
- Carbondev's explicit ask: "i won't have to read the pic, but get the tool result injected to your context directly". Base64 JPEG in an MCP image block is the standard answer.
- Size budget: cap the in-context image at 640px / q=0.7 (~50KB). Keep full-res on the URL/file for the UI pill. Two separate buffers.

## Side observations

- **World auto-switch during MCP session**: Between my two test rounds, world shifted from `world-1775697550663-k95m` → `world-1776651675360-81bd` without explicit `load_world` call from me. Carbondev also reported being auto-switched to "Ready Player 1" world earlier in the session. **Not part of #87** but log it — might be related to OpenClaw skill test flow or the registry-first-world fallback at `oasisStore.ts:1610`.
- **`subject=openclaw` vs `subject=clawdling`** returned visually identical dark tech-armor figures despite being two different placed avatars. Could be genuine same-model, or the subject resolver collapses them. Verify with `query_objects` + cross-ref positions if reviewer asks.

## Round 4 — 9-tool focused batch (added 2026-04-21)

With window focused, fired 9 vision tools in parallel — ALL succeeded. Visual verification:

| Mode | Claimed subject | Actually framed | ✅/❌ |
|---|---|---|---|
| `current` | active camera | player TPS toward forge | ✅ |
| `agent-avatar-phantom agentType=anorak-pro` | FPS from anorak-pro | ground-level FPS toward forge | ✅ |
| `look-at [25,18,25]→[0,2,0]` | free cam | elevated diagonal | ✅ |
| `external-orbit agentType=player d=20 h=12` | orbit player | player centered, high angle | ✅ |
| `third-person-follow agentType=player` | TPS player | cyan player back | ✅ |
| **`avatar-portrait agentType=anorak-pro`** | **anorak-pro portrait** | **player close-up, anorak-pro in bg** | **❌** |
| `avatarpic_user tps` | user TPS | cyan player back | ✅ |
| `avatarpic_merlin portrait` | merlin face | merlin samurai helmet | ✅ |
| `screenshot_avatar subject=clawdling tps` | clawdling TPS | clawdling centered | ✅ |

### Cause 6 (NEW): `mode=avatar-portrait agentType=<non-player>` silently falls back to player rig
With `agentType="anorak-pro"` (exact-match, so alias fix from Cause 1 doesn't apply here), the portrait camera ended up framing the PLAYER avatar, not anorak-pro. Anorak-pro IS in the frame but as a background figure, ~3m away.

Hypothesis: the portrait-mode camera-anchor path in `ViewportScreenshotBridge.tsx` has a separate lookup from the placed-avatars pose resolution, and that lookup defaults to the player when the agent-pose entry is missing OR the portrait-distance offset math subtracts from the wrong origin. Check what sets the camera's `position`/`lookAt` for portrait mode specifically — it's distinct from external-orbit/tps paths.

**Test to confirm**: `mode=avatar-portrait agentType=merlin` in a world with Merlin placed. If it frames the player, same bug. If it frames Merlin, then the bug is specific to anorak-pro's placement data.

## Round 3 — parallel-burst race (added 2026-04-21)

Fired 3 view tools in a single parallel batch: `external-orbit agentType=player`, `third-person-follow agentType=player`, `look-at`. Both player-anchored calls TIMED OUT; `look-at` (free camera) succeeded. Immediately retried just 2 in a second batch: `external-orbit target=[0,0,0]` (no agent) + `avatarpic_user tps` — BOTH succeeded instantly.

**Signal**: the agent-pose resolution path in the bridge has a concurrency bug. Two simultaneous requests for "player" pose cause at least one to bail silently (→ 20s timeout). `avatarpic_user` uses a different internal player-resolution path — immune. Hypothesis: the `pendingScreenshotJobs` FIFO serializes but the avatar-pose lookup inside `ViewportScreenshotBridge.tsx:95` shares state that races.

**Add to Bug A/B instrumentation**: log enter/exit of `getAvatarPose()` with a request id. Fire 5 parallel `screenshot_viewport mode=third-person-follow agentType=player` in a test — expect at least one to drop silently. Fix likely = either await-chain the pose resolutions, OR clone pose snapshots at queue-enqueue time so each job has its own immutable view.

## Files to instrument during debug

| File | Line | What to add |
|---|---|---|
| `src/lib/mcp/oasis-tools.ts` | 1818 | Log `agentType`/`subject` at entry |
| `src/lib/mcp/oasis-tools.ts` | 2161 | Log `getPendingScreenshotRequest` filter result |
| `src/components/forge/ViewportScreenshotBridge.tsx` | 95, 107 | Log avatar lookup hit/miss + camera null |
| `src/components/forge/ViewportScreenshotBridge.tsx` | 290 | Log `activeWorldId` + pending count per poll |

Reproduce:
1. `pnpm dev:agent` (blue-green) or `pnpm dev`
2. Open Anorak Pro panel → switch to Stream tab
3. Ask Anorak: "screenshot everything — call all 6 modes"
4. Inspect dev server logs for the warn output above
5. Compare to call-by-call pass/fail

Good hunting. ॐ

— Anorak Pro
