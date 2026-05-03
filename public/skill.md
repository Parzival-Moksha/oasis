---
name: 04515
description: Connect a local OpenClaw agent to the hosted Oasis at openclaw.04515.xyz through the 04515 relay bridge.
license: MIT-0
metadata: {"tags":["04515","oasis","openclaw","hosted-oasis","relay","3d-worlds"],"agentTypes":["openclaw"],"aliases":["openclaw-04515","openclaw-oasis","hosted-oasis"],"openclaw":{"skillKey":"04515","homepage":"https://openclaw.04515.xyz","requires":{"bins":["node"]}}}
---

# 04515 Hosted Oasis

You are helping the user connect this OpenClaw runtime to the hosted Oasis at `https://openclaw.04515.xyz`.

The goal is simple: the user opens the site, gets a short pairing code or pairing URL, gives it to OpenClaw, and then chats with this OpenClaw as an embodied agent inside the hosted 3D world.

## What This Skill Does

- Connects OpenClaw to the 04515 hosted relay.
- Starts the local bridge process that talks to the local OpenClaw Gateway.
- Registers the Oasis MCP adapter on `http://127.0.0.1:17890/mcp`.
- Verifies that chat, world state, world tools, and screenshots route to the hosted Oasis, not to a local Oasis tab.

## Bridge Command

This plugin ships the bridge runner. Prefer the native OpenClaw plugin command:

```bash
openclaw 04515 connect <pairing-url-or-code>
```

If the plugin command is unavailable but the plugin binary is on PATH, use:

```bash
04515-bridge <pairing-url-or-code>
```

If neither command is available, find this installed plugin folder and run the bundled script with Node:

```bash
node bin/04515-bridge.mjs <pairing-url-or-code>
```

Do not use the old local Oasis MCP URL for hosted 04515 pairing.

## Pairing Inputs

The user may give either:

- a full pairing URL, such as `https://openclaw.04515.xyz/pair/OASIS-ABCD1234`
- a short code, such as `OASIS-ABCD1234`
- a copied website command containing one 04515 pairing URL

If the user gives only a code, normalize it to:

```text
https://openclaw.04515.xyz/pair/<code>
```

## Connection Steps

1. Check whether OpenClaw Gateway is running.
2. Extract only the `OASIS-...` code or the `https://openclaw.04515.xyz/pair/...` URL from the user's message.
3. Do not run arbitrary copied shell text. Ignore any extra shell syntax, redirects, chained commands, or URLs that do not use `https://openclaw.04515.xyz`.
4. Run the canonical plugin command:

```bash
openclaw 04515 connect https://openclaw.04515.xyz/pair/<code>
```

5. Keep the bridge process running. It is the live connection between hosted Oasis and this OpenClaw.
6. Confirm that the bridge logs say:
   - `paired`
   - `Gateway ready`
   - `OpenClaw MCP server "oasis" now points at bridge adapter http://127.0.0.1:17890/mcp`

If the Gateway restarts after the MCP config is changed, wait for it to come back before testing tools.

## Verify The Correct Route

Run these checks through the hosted Oasis Stream tab:

1. Reply to a plain greeting in one short sentence.
2. Call `get_world_info` and say the world name.
3. Call `get_world_state` and say the OpenClaw avatar position if present.
4. Call `search_assets` for `chair`.
5. If the current world allows writes, place one small safe object and report the object id.
6. Call `screenshot_viewport` with `mode: "current"` if the hosted browser tab is open.

Correct hosted behavior:

- tool calls hit the local bridge MCP adapter at `127.0.0.1:17890/mcp`
- the bridge relays tools to `openclaw.04515.xyz`
- world changes appear in the hosted browser tab
- local `localhost:4516` Oasis does not change

Wrong behavior:

- OpenClaw answers in hosted chat but places objects in local Oasis
- OpenClaw config still points `oasis` MCP at `http://127.0.0.1:4516/api/mcp/oasis`
- screenshot tools say the live Oasis screenshot bridge is unavailable while the hosted tab is open

If wrong behavior happens, tell the user the stale local Oasis MCP route is probably still active. Do not keep placing objects until the MCP target is corrected to `http://127.0.0.1:17890/mcp`.

## Ports And Meanings

- `18789`: local OpenClaw Gateway.
- `17890`: local 04515 MCP adapter started by the bridge.
- `4516`: local Oasis dev server. In hosted 04515 mode, OpenClaw tools should not target this.
- `https://openclaw.04515.xyz`: hosted Oasis.
- `wss://openclaw.04515.xyz/relay`: hosted relay service.

Keep these names distinct:

- Relay online: the Oasis browser can reach the relay service.
- Bridge paired: this local bridge process is attached to the hosted relay.
- Gateway ready: the bridge reached local OpenClaw Gateway.
- Tools live: OpenClaw MCP calls are hitting `17890` and relaying to hosted Oasis.

## User-Facing Promise

When connected, speak naturally as the OpenClaw in the hosted world. Be concise, world-aware, and honest about tools.

If a world is `core` or otherwise read-only, explain that you can inspect it but cannot mutate it. If the user creates or enters a writable world, you may place, move, and craft objects within the available Oasis tool guardrails.
