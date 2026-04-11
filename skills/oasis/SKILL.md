---
name: oasis
description: Teach Hermes or another remote agent how to connect to Oasis as a world-building agent through the Oasis MCP endpoint, optional Oasis plugin, and live browser screenshot bridge.
version: 0.2.0
author: Levi
license: MIT
metadata:
  hermes:
    tags: [oasis, mcp, world-building, 3d, hermes]
    category: integrations
---

# Oasis

Oasis is a local-first 3D world that agents can inspect, modify, navigate, and build through a shared Oasis tool surface.

This skill is for the new reality, not the old one:
- Oasis has a shared world-tool substrate
- Oasis exposes a remote MCP endpoint at `/api/mcp/oasis`
- Oasis can inject live world context through the optional Hermes plugin
- visual tools depend on a live Oasis browser client with the screenshot bridge mounted

Use this skill when an agent needs to become world-aware inside Oasis, not merely chat through an Oasis panel.

## When To Use

Use this skill when:
- the user wants Hermes, OpenClaw, or another remote agent to work inside Oasis worlds
- the user asks how to connect an agent to Oasis through MCP
- the user wants an agent to inspect, place, remove, paint, light, move, or screenshot inside Oasis
- the user asks what a remote Oasis agent can really perceive or control
- the user wants the install path for the Oasis skill, plugin, and MCP endpoint

Do not use this skill for generic coding unless Oasis integration is part of the task.

## Quick Reference

- Repo URL: `https://github.com/Parzival-Moksha/oasis`
- Skill path: `skills/oasis`
- Plugin path: `hermes-plugin/oasis`
- Remote MCP endpoint: `http://<oasis-host>:4516/api/mcp/oasis`
- Legacy REST tools endpoint: `http://<oasis-host>:4516/api/oasis-tools`
- Optional auth header: `Authorization: Bearer <OASIS_MCP_KEY>`

## Install Path

1. Install the skill from the repo.
   - `hermes skills install Parzival-Moksha/oasis/skills/oasis`
   - or add the repo as a tap and install from there.

2. Configure the Oasis MCP server in the agent runtime.
   - Point the agent at `http://<oasis-host>:4516/api/mcp/oasis`
   - If Oasis has `OASIS_MCP_KEY` set, send the same bearer token
   - See `references/streamable-http-mcp.example.json` for a concrete starter shape

3. Optionally install the Oasis Hermes plugin.
   - Plugin folder: `hermes-plugin/oasis`
   - The plugin injects compact live world context into each turn even before tools are called

4. Keep a real Oasis browser client open in the target world when the agent needs vision.
   - `screenshot_viewport`
   - `screenshot_avatar`
   - `avatarpic_merlin`
   - `avatarpic_user`

Without the live browser bridge, screenshot tools cannot see the world.

## Recommended MCP Config

Use a remote HTTP MCP server entry that targets the Oasis endpoint. The exact config format depends on the host agent, but the important pieces are:

- URL: `/api/mcp/oasis`
- Transport: Streamable HTTP MCP
- Auth: bearer token if `OASIS_MCP_KEY` is set

If the agent also supports the Oasis plugin, use both:
- MCP for tools
- plugin for compact always-on context

That pairing gives the best result.

## What The Agent Can Do

The Oasis tool surface supports:
- world state and world summary
- object search and asset search
- placing, modifying, and removing catalog objects
- crafting procedural scenes
- sky, ground, tile paint, and lights
- embodied agent avatars
- avatar walking and animation playback
- viewport and avatar screenshots
- Forge conjuration workflows for Meshy and Tripo assets

The agent should usually:
1. call `get_world_state` or `get_world_info`
2. call `query_objects` or `search_assets` as needed
3. make a world mutation
4. use screenshot tools when visual verification matters

## Visual Truth

Oasis has three different truths the agent should keep straight:

- world state: persisted build data and live player context from Oasis
- avatar embodiment: agent avatars, movement targets, and avatar screenshots
- browser vision: what the screenshot bridge can currently capture from the live client

Important:
- screenshot tools require a live Oasis browser client
- live player avatar and camera context are refreshed per turn, not continuously every frame
- a screenshot is stronger than verbal assumption when the user is asking about what is visible right now

## Forge And Conjuration

Oasis world-building now includes Forge conjuration tools in the shared tool layer:
- `list_conjured_assets`
- `get_conjured_asset`
- `conjure_asset`
- `process_conjured_asset`
- `place_conjured_asset`
- `delete_conjured_asset`

Use them like this:
- `conjure_asset` to start Meshy or Tripo generation
- `process_conjured_asset` for texture, remesh, rig, or animate
- `place_conjured_asset` to place or reposition an existing conjured asset
- `delete_conjured_asset` to remove it from the active world and optionally from the Forge registry

If the user wants a new 3D asset rather than a catalog asset, prefer these tools over pretending the asset already exists.

## Operating Guidance

- Prefer concise world-aware answers inside Oasis UI surfaces.
- Distinguish between player view, agent view, and external view.
- Do not pretend the agent sees the world if screenshot capture is unavailable.
- Do not claim a generation is finished until the conjured asset status actually says so.
- When the user asks to move relative to them, use live player context or avatar screenshot tools instead of guessing.
- When the user asks for precise visual verification, use screenshot tools rather than narration alone.

## Limits

- The skill does not install Oasis itself.
- The skill does not by itself register MCP config in every host agent runtime.
- The plugin injects compact context, but real build power comes from the Oasis MCP tool surface.
- Screenshot tools still depend on a live Oasis browser client in the target world.
- Local Merlin and remote Hermes can share the same tool surface, but runtime UX may still differ by host client.

## Verification

After setup, verify in this order:

1. `get_world_info`
2. `get_world_state`
3. `search_assets`
4. one safe placement or walk tool
5. one screenshot tool with the live browser open

If `get_world_info` works but screenshot tools fail, the MCP transport is up and the browser bridge is the missing link.

## References

- Read `references/current-oasis-transport.md` for the current Oasis transport and runtime boundary.
- Read `references/streamable-http-mcp.example.json` for a generic remote MCP config skeleton.
