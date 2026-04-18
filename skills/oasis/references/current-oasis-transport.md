# Current Oasis Agent Transport

Snapshot of the Oasis agent-transport shape (as of the current skill version). This is a reference doc — the live setup instructions for humans live at https://parzival-moksha.github.io/oasis/ .

## Distribution

- Repo URL: `https://github.com/Parzival-Moksha/oasis`
- Skill path: `skills/oasis`
- Plugin path: `hermes-plugin/oasis`

## Current Agent Layers

Oasis has three distinct agent layers:

1. Shared world-tool substrate
   - `src/lib/mcp/oasis-tools.ts`
   - shared by REST, local stdio MCP, local agents, and remote HTTP MCP

2. Remote MCP endpoint
   - `src/app/api/mcp/oasis/route.ts`
   - Streamable HTTP MCP endpoint for remote agents

3. Optional agent plugin
   - `hermes-plugin/oasis/__init__.py`
   - injects compact world context into agent turns

## Current Remote Endpoints

- Remote MCP: `POST/GET/DELETE /api/mcp/oasis`
- REST tools fallback: `POST /api/oasis-tools`
- Screenshot delivery: `POST /api/oasis-tools`

## Current World Awareness

The shared `get_world_state` tool includes:
- catalog objects
- crafted scenes
- lights
- agent avatars
- placed conjured assets
- behaviors
- live player avatar context
- live player camera context

Important:
- live player context is refreshed when Oasis sends agent requests, not every animation frame
- screenshot tools remain browser-mediated, not server-vision-native

## Current Visual Boundary

Vision is not purely server-side.

`screenshot_viewport` and avatar screenshot tools depend on:
- a live Oasis browser client
- the screenshot bridge being mounted
- that browser actually being in the target world

If the browser bridge is absent, the world tools may still work, but screenshot tools will fail or time out.

## Current Forge Boundary

The shared tool surface exposes Forge conjuration flows:
- list
- inspect
- conjure
- post-process
- place
- delete

These tools rely on the local Oasis Forge stack and provider keys already configured on the Oasis host.

## Current Truthful Framing

When guiding users or remote agents, say:
- Oasis exposes real world-building tools over MCP
- the plugin provides compact passive context, not the full transport
- screenshot tools require a live browser bridge
- the shared tool layer is the source of truth for world actions

## Transport Note

When the agent host and Oasis are on different machines, the user is responsible for establishing network reachability between them. See the Quickstart docs for the supported topologies:
https://parzival-moksha.github.io/oasis/docs/getting-started/quickstart/
