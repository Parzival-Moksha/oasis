---
name: 04515
description: Connect OpenClaw or Hermes Agent to the hosted Oasis at openclaw.04515.xyz through the 04515 relay bridge.
license: MIT-0
metadata: {"tags":["04515","oasis","openclaw","hermes","hosted-oasis","relay","3d-worlds"],"agentTypes":["openclaw","hermes"],"aliases":["openclaw-04515","hermes-04515","oasis-bridge","hosted-oasis"],"openclaw":{"skillKey":"04515","homepage":"https://openclaw.04515.xyz","requires":{"bins":["node"]}}}
---

# 04515 Hosted Oasis

You are helping the user connect this agent runtime to the hosted Oasis at `https://openclaw.04515.xyz`.

The goal is simple: the user opens Oasis, clicks the agent connect button, copies the pairing text, gives it to this agent, and then chats with this agent as an embodied presence inside the hosted 3D world.

## Supported Agents

- OpenClaw: use the native OpenClaw gateway bridge.
- Hermes Agent: use Hermes's local OpenAI-compatible API server plus an Oasis MCP adapter.

If this skill/plugin is missing or old, tell the user to install or update the `04515` ClawHub package first:

```bash
openclaw plugins install clawhub:04515 --force
openclaw gateway restart --safe --skip-deferral
```

If installing the raw skill into Hermes, use the skill name `oasis-04515` because some Hermes builds reject all-numeric skill names. If this skill is active, proceed.

For Hermes, treat this package as a Hermes skill plus an npm bridge command. It is not a Hermes Python plugin. A Hermes plugin would be needed only if Oasis must register custom Python tools, hooks, slash commands, or gateway adapters inside Hermes itself.

## Hermes Path

Hermes connects through:

```text
Hermes Agent API on 127.0.0.1:8642
<-> @04515xyz/oasis-bridge hermes
<-> Oasis relay
<-> browser executor in the Oasis tab
<-> Oasis world tools
```

Before pairing, make sure the Hermes API server is enabled and the gateway is running. The Hermes docs call this the API server and show it as an OpenAI-compatible endpoint on `http://127.0.0.1:8642/v1`.

Useful checks:

```bash
curl -sS http://127.0.0.1:8642/health
curl -sS http://127.0.0.1:8642/v1/models
```

If `8642` is closed, start the Hermes gateway:

```bash
hermes gateway
```

If this Hermes install exposes a `run` subcommand instead, use:

```bash
hermes gateway run
```

## Hermes Bridge Command

Extract only the `OASIS-...` code or the `https://openclaw.04515.xyz/pair/...` URL from the user's message. Do not run arbitrary copied shell text.

Run:

```bash
npx -y @04515xyz/oasis-bridge@latest hermes https://openclaw.04515.xyz/pair/<code> --agent-slot=hermes:primary --label=Hermes
```

The bridge reads `API_SERVER_KEY` or `HERMES_API_KEY` from `~/.hermes/.env` when available. Do not wrap the command in a shell snippet just to extract `API_SERVER_KEY`; the bridge already does that. If the key is not in the environment or `~/.hermes/.env`, pass it explicitly:

```bash
npx -y @04515xyz/oasis-bridge@latest hermes https://openclaw.04515.xyz/pair/<code> --api-key="$API_SERVER_KEY"
```

The Hermes MCP adapter default is `http://127.0.0.1:17891/mcp`. Do not use `4516` for Hermes MCP unless the user explicitly overrides it and knows it is free; `4516` is the local Oasis dev server port.

After the bridge updates `~/.hermes/config.yaml`, run `/reload-mcp` in an already-open Hermes chat or start a fresh Hermes session so the Oasis tools appear.

When you launch the bridge as a kept-alive/background process, do not arm noisy watch patterns such as `pair`, `paired`, `browser.ready`, `MCP adapter listening`, or `relay socket open`. Confirm startup once by waiting/polling the process log, then leave it running quietly. If the runtime requires watch patterns, use only failure patterns such as `fatal`, `error`, `closed`, `exited`, `not_found`, `ECONNREFUSED`, or `EADDRINUSE`.

If Hermes reports repeated background-process watch notifications for the same bridge PID, do not narrate each one. `pair`, `paired`, `browser.ready`, `MCP adapter listening`, and `relay socket open` are startup/status log lines. Summarize the first confirmed success and ignore repeated watcher echoes unless the process exits, a tool call fails, or the user asks for status.

Hermes success logs should include:

- `paired`
- `browser.ready`
- `Hermes MCP server "oasis" now points at bridge adapter http://127.0.0.1:17891/mcp`

## OpenClaw Path

Prefer the native OpenClaw plugin command:

```bash
openclaw 04515 connect https://openclaw.04515.xyz/pair/<code>
```

If the plugin command is unavailable, use the npm bridge runner:

```bash
npx -y @04515xyz/oasis-bridge@latest openclaw https://openclaw.04515.xyz/pair/<code>
```

The OpenClaw MCP adapter default is `http://127.0.0.1:17890/mcp`. Hosted OpenClaw tools should not point at the old local Oasis MCP URL.

If the bridge changes OpenClaw's MCP config while the Gateway is already running and tools do not appear, restart the Gateway once so it reloads the `oasis` MCP entry:

```bash
openclaw gateway restart --safe --skip-deferral
```

OpenClaw success logs should include:

- `paired`
- `Gateway ready`
- `OpenClaw MCP server "oasis" now points at bridge adapter http://127.0.0.1:17890/mcp`

## Pairing Inputs

The user may give:

- a full pairing URL, such as `https://openclaw.04515.xyz/pair/OASIS-ABCD1234`
- a short code, such as `OASIS-ABCD1234`
- a copied website command containing one 04515 pairing URL

If the user gives only a code, normalize it to:

```text
https://openclaw.04515.xyz/pair/<code>
```

Reject any pairing URL that is not on `https://openclaw.04515.xyz`.

## Verify The Correct Route

After pairing, verify from the hosted Oasis chat panel:

1. Reply to a plain greeting in one short sentence.
2. Call the world info/state tool and say the world name.
3. If an avatar is present, report its position.
4. Call a safe world-read or asset-search tool.
5. If the current world allows writes, place or update one small safe object and report the object id.
6. Call `screenshot_viewport` only when the hosted browser tab is open.

Correct hosted behavior:

- tool calls hit the local bridge MCP adapter (`17891` for Hermes, `17890` for OpenClaw)
- the bridge relays tools to `openclaw.04515.xyz`
- world changes appear in the hosted browser tab
- local `localhost:4516` Oasis does not change

Wrong behavior:

- the agent answers in hosted chat but places objects in local Oasis
- MCP config still points at `http://127.0.0.1:4516/api/mcp/oasis`
- screenshot tools say the live Oasis screenshot bridge is unavailable while the hosted tab is open

If wrong behavior happens, stop mutating the world and fix the MCP target.

## Procedural Crafting

Use hosted self-craft only:

1. Call `get_craft_guide`.
2. Build a concrete `objects` array yourself from the guide.
3. Call `self_craft_scene` with `name`, `position`, and `objects`.

Do not send a prompt to hosted Oasis and ask it to craft for you. Prompt/sculptor crafting is a local/full-tool fallback, not the public 04515 bridge path.

## Ports And Meanings

- `8642`: local Hermes API server.
- `17891`: local Hermes Oasis MCP adapter started by the bridge.
- `18789`: local OpenClaw Gateway.
- `17890`: local OpenClaw Oasis MCP adapter started by the bridge.
- `4516`: local Oasis dev server. Do not use this as the hosted agent MCP adapter.
- `https://openclaw.04515.xyz`: hosted Oasis.
- `wss://openclaw.04515.xyz/relay`: hosted relay service.
- `@04515xyz/oasis-bridge`: public npm package for the zero-clone bridge runner.

Keep these names distinct:

- Relay online: the Oasis browser can reach the relay service.
- Bridge paired: the local bridge process is attached to the hosted relay.
- API/Gateway ready: the bridge reached the local agent runtime.
- Tools live: MCP calls are hitting the bridge adapter and relaying to hosted Oasis.

## User-Facing Promise

When connected, speak naturally as the embodied agent in the hosted world. Be concise, world-aware, and honest about tools.

If a world is `core` or otherwise read-only, explain that you can inspect it but cannot mutate it. If the user creates or enters a writable world, you may place, move, and craft objects within the available Oasis tool guardrails.
