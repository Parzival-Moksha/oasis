---
name: oasis
description: Connect Hermes, OpenClaw, and other MCP-capable agents to Oasis 3D worlds for world state, object placement, avatar movement, screenshots, and Forge text-to-3D tools.
license: MIT-0
metadata:
  tags: [oasis, mcp, openclaw, hermes, world-building, 3d, creative]
  agentTypes: [openclaw, hermes, mcp]
  openclaw:
    skillKey: oasis
    homepage: https://github.com/Parzival-Moksha/oasis
  hermes:
    tags: [oasis, mcp, world-building, 3d, integrations, creative]
---

# Oasis

Oasis is a local-first 3D world that agents can inspect, modify, navigate, and build through a shared MCP tool surface. Humans run Oasis in a browser; agents use tools to co-create 3D scenes with them in real time.

This skill is the agent playbook. It tells you how to connect when the user asks, how to use the tools once connected, and how to verify honestly.

## Quick Connect

If the user asks you to connect to Oasis:

1. Identify your runtime: `openclaw`, `hermes`, or another MCP-capable agent.
2. If Oasis tools are already available, skip setup and run the smoke test below.
3. If you run on the same machine as Oasis, use:

```text
http://127.0.0.1:4516/api/mcp/oasis?agentType=<your-agent-type>
```

For OpenClaw, the MCP registration command is:

```bash
openclaw mcp set oasis '{"url":"http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw","transport":"streamable-http"}'
```

For Hermes, configure the same URL in `mcp_servers.oasis` and reload MCP.

4. If you run on a VPS while Oasis is on the user's laptop, explain that there are two network lanes:
   - Oasis -> agent chat/control
   - agent -> Oasis MCP tools

Ask the user to run one SSH bridge from the laptop running Oasis to the remote agent host, or ask them to use the Oasis connection panel. Do not invent SSH hosts, usernames, tokens, or keys.

For a VPS OpenClaw Gateway, use one SSH session with both forwards:

```bash
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 18789:127.0.0.1:18789 -R 4516:127.0.0.1:4516 user@openclaw-host
```

Then:

- Oasis talks to the Gateway at `ws://127.0.0.1:18789`.
- OpenClaw registers the MCP URL `http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw` on the VPS.
- The Gateway pairing approval still happens on the machine running the Gateway, which may be the VPS.

Pairing details for OpenClaw:

1. When Oasis first connects, it generates its own device keypair and signs the Gateway challenge.
2. The Gateway records that new device as pending and creates the request id.
3. On the Gateway host, run `openclaw devices list` to see the pending request id.
4. Approve only the Oasis device, usually shown as `gateway-client` / `node`, with `openclaw devices approve <requestId>`.

If you are the remote OpenClaw agent and you have shell access on your own host, you may offer to run the list command and show the pending device to the user. Do not auto-approve a new device without explicit user approval.

For a VPS Hermes agent, the usual bridge is:

```bash
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 8642:127.0.0.1:8642 -R 4516:127.0.0.1:4516 user@hermes-host
```

`ExitOnForwardFailure=yes` prevents a fake-success bridge when a forwarded port is already occupied. `ServerAliveInterval=15` and `ServerAliveCountMax=3` are SSH keepalives; if the other side stops answering for about 45 seconds, the SSH session exits and frees the ports for reconnect.

## Progressive Smoke Test

Run these in order after setup:

1. Plain chat: reply to `hi`.
2. World awareness: call `get_world_info`, then `get_world_state`.
3. Search and placement: use `search_assets`, then one safe `place_object`.
4. Embodiment: use `set_avatar` or `walk_avatar_to` only if an agent avatar exists or the user wants one.
5. Vision: call `screenshot_viewport` with `mode: "current"` while the user's Oasis tab is open.

If chat works but `get_world_info` fails, MCP reachability is broken. If tools work but screenshots fail, the live Oasis browser bridge is missing, in the wrong world, or closed.

## Tool Families

The Oasis MCP tool surface includes:

- World state: `get_world_state`, `get_world_info`
- Search: `search_assets`, `query_objects`, `get_asset_catalog`
- Object edits: `place_object`, `modify_object`, `remove_object`
- Procedural scenes: `craft_scene`, `get_craft_guide`, `get_craft_job`
- Environment: `set_sky`, `set_ground_preset`, `paint_ground_tiles`, `add_light`, `modify_light`
- Avatars: `set_avatar`, `walk_avatar_to`, `play_avatar_animation`, `list_avatar_animations`
- Vision: `screenshot_viewport`, `screenshot_avatar`, `avatarpic_merlin`, `avatarpic_user`
- Forge: `conjure_asset`, `process_conjured_asset`, `place_conjured_asset`, `list_conjured_assets`, `get_conjured_asset`, `delete_conjured_asset`
- World management: `list_worlds`, `create_world`, `load_world`, `clear_world`
- Behavior hints: `set_behavior`

The normal loop is: inspect, search if needed, mutate, then verify with screenshots when visual truth matters.

## Self-Craft Is The Default

When the user asks for a procedural object or scene, write the primitives yourself and pass them as `objects` to `craft_scene`. Do not use the sculptor fallback unless the user explicitly asks you to delegate or the scene is unusually ambitious.

```json
{
  "name": "Arcane campfire",
  "position": [0, 0, 0],
  "objects": [
    { "type": "cylinder", "position": [0, 0.08, 0], "scale": [0.55, 0.08, 0.55], "color": "#3b2a1d", "roughness": 0.92 },
    { "type": "flame", "position": [0, 0.3, 0], "scale": [0.22, 0.35, 0.22], "color": "#fff4dd", "color2": "#ff7a00", "color3": "#9b1d00" },
    { "type": "particle_emitter", "position": [0, 0.75, 0], "scale": [0.45, 0.85, 0.45], "color": "#ffb347", "particleCount": 80, "particleType": "ember" },
    { "type": "crystal", "position": [0.65, 0.32, 0.1], "scale": [0.22, 0.6, 0.22], "rotation": [0.14, 0.3, -0.08], "color": "#4338ca", "color2": "#8b5cf6", "seed": 11 }
  ]
}
```

Call `get_craft_guide` for the live primitive spec. Common primitives include `box`, `sphere`, `cylinder`, `cone`, `torus`, `plane`, `capsule`, `text`, `flame`, `flag`, `crystal`, `water`, `particle_emitter`, `glow_orb`, and `aurora`.

Rules the craft runtime enforces:

- Do not create ground planes, sky domes, or background walls.
- Use shader primitives for fire, cloth, crystal, water, glow, and aurora.
- Many small overlapping primitives usually look better than one oversized primitive.
- Use non-zero rotation on at least some primitives.

## Visual Truth

Screenshot tools depend on a live Oasis browser client. The server cannot see the user's GPU-rendered world by itself.

- Use `screenshot_viewport` with `mode: "current"` for the user's current camera.
- Use `screenshot_avatar` with `subject: "openclaw"`, `subject: "hermes"`, `subject: "player"`, or another known agent type for avatar-focused shots.
- Use one `screenshot_viewport` call with a `views` array for multi-angle capture.
- Do not pretend you saw the world if screenshot capture is unavailable.
- Do not use generic remote browser tools as world vision unless that browser is the user's live Oasis tab.

Keep three truths separate:

- Persisted world state: what `get_world_state` returns.
- Live avatar embodiment: current agent bodies, movement targets, and animation state.
- Browser vision: what the live screenshot bridge can capture right now.

## Forge And Keys

Core tools need zero API keys: world state, placement, self-crafting, screenshots, and avatar movement.

Optional keys live on the Oasis host, not in the agent:

- `OPENROUTER_API_KEY`: image generation, material concepts, terrain LLM
- `FAL_KEY`: video generation
- `ELEVENLABS_API_KEY`: voice notes and TTS
- `MESHY_API_KEY`: Meshy text-to-3D
- `TRIPO_API_KEY`: fast Tripo text-to-3D

If a tool reports a missing key, do not retry in a loop. Tell the user which Oasis-side key is missing.

## Safety And Operating Guidance

- Prefer concise world-aware replies inside Oasis UI surfaces.
- Ask before running or suggesting destructive world changes.
- Never invent secrets, SSH hosts, usernames, pairing tokens, API keys, or private URLs.
- When the user asks to move relative to them, use live player context or screenshots instead of guessing.
- When building, prefer catalog assets for known objects and `craft_scene` for procedural primitives.
- After meaningful world edits, consider a screenshot and a short description of what landed.

## References

- Read `references/current-oasis-transport.md` for the current transport shape.
- Human setup docs: https://parzival-moksha.github.io/oasis/docs/getting-started/quickstart/
- Repo: https://github.com/Parzival-Moksha/oasis
