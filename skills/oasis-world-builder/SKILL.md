---
name: oasis-world-builder
description: Build, explore, and visualize inside The Oasis — a local-first 3D world builder. Use when the user wants to place objects, craft scenes, embody an avatar, move in space, take screenshots, or inspect a 3D scene they're in.
homepage: https://github.com/Parzival-Moksha/oasis
metadata:
  openclaw:
    emoji: ॐ
    skillKey: oasis
    requires:
      config:
        - mcp.servers.oasis
---

# Oasis World Builder

The Oasis is a local-first 3D world builder running on `http://localhost:4516`. It exposes 35 MCP tools for world inspection, object placement, scene crafting, avatar embodiment, lighting, and screenshot capture. When the tools are registered (see Setup below), they appear as `mcp__oasis__<toolname>`.

## When to Use

- ✅ User asks to build, place, or craft anything in a 3D scene
- ✅ User wants a screenshot of the world, their avatar, or yours
- ✅ User asks "where am I" / "where are you" — Oasis tracks live positions
- ✅ User asks you to walk to them, follow them, or embody
- ✅ User wants visual context for a task that's happening in a 3D space
- ✅ User mentions Oasis, their world, their avatar, waterfalls, SCARLET COURT OF CLAWD, etc.

## When NOT to Use

- ❌ Code editing (use the local code tools)
- ❌ TTS / voice / realtime audio (use `voice-call` / `talk.*`)
- ❌ General web lookup or research
- ❌ Any task the user isn't living inside the 3D scene for

## Setup

Register the Oasis MCP server with your OpenClaw:

```bash
openclaw mcp set oasis '{"url":"http://localhost:4516/api/mcp/oasis","transport":"streamable-http"}'
openclaw mcp list
```

Oasis must be running locally (`pnpm dev` from the repo). If it is, the 35 tools appear as `mcp__oasis__*` in your next session. No Gateway WebSocket client is needed — this is pure MCP over HTTP.

## Tool Cheatsheet

**World inspection**
- `mcp__oasis__get_world_state` — player pose, agent avatars, objects, lights. Start here. `livePlayerAvatar` tells you where the user is.
- `mcp__oasis__get_world_info` — world metadata only (name, sky, object count)
- `mcp__oasis__list_worlds` / `mcp__oasis__load_world` — switch worlds

**Screenshots** (returns inline image content blocks — you see the pixels)
- `mcp__oasis__screenshot_viewport` — modes: `current` (user POV), `agent-avatar-phantom` (your FPS), `look-at` (explicit camera), `external-orbit` (overview), `third-person-follow`, `avatar-portrait`
- `mcp__oasis__screenshot_avatar` — subjects: `player`/`user`/`me` (the human), `merlin`, `hermes`, `openclaw`, `anorak-pro`
- Tight TPS framing defaults: `distance:2.8`, `heightOffset:1.6`

**Embodiment**
- `mcp__oasis__set_avatar` — place/move your body. Canonical agentTypes: `anorak`, `anorak-pro`, `merlin`, `hermes`, `openclaw`, `devcraft`, `parzival`, `browser`, `mission`, `realtime`. Non-canonical types are rejected.
- `mcp__oasis__walk_avatar_to` — animated move to a position
- `mcp__oasis__list_avatar_animations` + `mcp__oasis__play_avatar_animation`

**Building**
- `mcp__oasis__place_object` — one item from the catalog (e.g. `catalogId: "prop_crate"`)
- `mcp__oasis__craft_scene` — multi-object composition
- `mcp__oasis__add_light` / `mcp__oasis__modify_light`
- `mcp__oasis__set_sky` / `mcp__oasis__set_ground_preset` / `mcp__oasis__paint_ground_tiles`
- `mcp__oasis__conjure_asset` — text-to-3D (Meshy/Tripo), optionally auto-placed
- `mcp__oasis__clear_world` — requires `confirm:true`

## Notes

- `player` / `user` / `me` / `self` / `vibedev` / `carbondev` all alias to `player` — the human user, NOT you (the agent).
- If `livePlayerAvatar` is `null`, tell the user to refresh their Oasis tab. The browser's 500ms pose heartbeat starts on mount and stops when the tab is backgrounded.
- Screenshots take ~1-2s with the Oasis tab foreground-active. Hidden tabs slow the render bridge to 5s polling or more — screenshots will time out if the user minimizes.
- Your own body lives in the world as `agentType: "openclaw"` with label `OpenClaw`. Use `screenshot_avatar` with `subject: "openclaw"` to see yourself.
- `screenshot_viewport` with an unknown `mode` returns a clear valid-list error — read it, pick a valid mode, retry.
- For composition: call `get_world_state` first to compute positions relative to the user's pose (`position + yaw * forward`). Don't hardcode coordinates.
- `screenshot_viewport` accepts `views: [{mode, ...}, ...]` for multi-angle capture in one call.

## Examples

**"Walk to me and show me what you see"** →
1. `get_world_state` → read `livePlayerAvatar.position` + `.yaw`
2. Compute target: `[px + 2*sin(yaw), py, pz + 2*cos(yaw)]`
3. `set_avatar` with `agentType: "openclaw"` + target position + rotation facing the user
4. `screenshot_viewport` with `mode: "agent-avatar-phantom"`

**"Build me a campfire over there"** →
1. `get_world_state` → find a clear spot
2. `place_object` with `catalogId: "prop_firepit"` (or similar)
3. `add_light` with warm color above the firepit
4. `screenshot_viewport` with `mode: "external-orbit"` targeting the firepit

**"Who else is in this world?"** →
1. `get_world_state` → enumerate `agentAvatars`
2. For each: `screenshot_avatar` with `subject: <agentType>` and `style: "portrait"`
3. Describe each based on the image
