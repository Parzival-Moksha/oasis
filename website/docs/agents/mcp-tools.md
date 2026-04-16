---
sidebar_position: 7
title: MCP Tools
---

# MCP Tools

The shared Oasis tool layer is the current source of truth for agent-world actions.

## Current transport surfaces

The same tool substrate feeds three major entry points:

| Surface | Route or path | Notes |
| --- | --- | --- |
| Remote HTTP MCP | `/api/mcp/oasis` | Streamable HTTP MCP — primary surface for remote agents |
| REST fallback | `/api/oasis-tools` | Useful for direct app and script access |
| Local stdio MCP | `tools/oasis-mcp/index.js` | Good for local agents and CLI workflows |

For solo / local use, no auth is required. The SSH reverse tunnel (see [Quickstart](../getting-started/quickstart)) is already the auth boundary — only your VPS can reach port 4516.

:::info Advanced: bearer auth for shared hosts
If you're exposing Oasis to a shared network and want request-level auth, set `OASIS_MCP_KEY` in the Oasis `.env`. Remote clients must then send:

```http
Authorization: Bearer <OASIS_MCP_KEY>
```

In Hermes YAML, paste the literal token (env var expansion is not documented as supported):

```yaml
mcp_servers:
  oasis:
    url: http://127.0.0.1:4516/api/mcp/oasis?agentType=hermes
    headers:
      Authorization: "Bearer paste-the-literal-token-here"
```
:::

## Tool count

Oasis currently exposes **35 shared MCP tools**.

## Tool families

### World state and search

- `get_world_state`
- `get_world_info`
- `query_objects`
- `search_assets`
- `get_asset_catalog`

### World lifecycle

- `list_worlds`
- `load_world`
- `create_world`
- `clear_world`

### Object and scene mutation

- `place_object`
- `modify_object`
- `remove_object`
- `craft_scene`
- `get_craft_guide`
- `get_craft_job`
- `set_sky`
- `set_ground_preset`
- `paint_ground_tiles`
- `add_light`
- `modify_light`
- `set_behavior`

### Embodied agents and avatars

- `set_avatar`
- `walk_avatar_to`
- `list_avatar_animations`
- `play_avatar_animation`

### Vision and screenshots

- `screenshot_viewport`
- `screenshot_avatar`
- `avatarpic_merlin`
- `avatarpic_user`

### Forge conjuration

- `list_conjured_assets`
- `get_conjured_asset`
- `conjure_asset`
- `process_conjured_asset`
- `place_conjured_asset`
- `delete_conjured_asset`

## Important boundary

Screenshot tools are not purely server-side vision.

They depend on:

- a live Oasis browser client
- the screenshot bridge being mounted
- that browser actually being in the target world

If the browser bridge is absent, world mutation tools may still work while screenshot tools fail or time out.

## Current recommendation for agents

When an agent needs context:

1. call `get_world_state`
2. call `screenshot_viewport` only if a live browser bridge is expected
3. use exact world-aware tools instead of inventing hidden state

That keeps agents grounded in the same world humans are seeing.
