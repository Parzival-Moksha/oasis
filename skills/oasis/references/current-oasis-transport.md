# Current Oasis Agent Transport

This is the compact transport reference for agents using the Oasis skill.

## Distribution

- Repo: `https://github.com/Parzival-Moksha/oasis`
- Skill path: `skills/oasis`
- Remote MCP endpoint: `http://127.0.0.1:4516/api/mcp/oasis?agentType=<agent-type>`

Use `agentType=openclaw` for OpenClaw and `agentType=hermes` for Hermes. Other MCP-capable agents may use their own stable lowercase agent type.

## The Two Directions

Remote agents need two independent lanes:

1. Oasis to agent chat/control
   - OpenClaw: Oasis opens the OpenClaw Gateway WebSocket.
   - Hermes: Oasis calls the Hermes API.

2. Agent to Oasis tools
   - The agent calls the Oasis streamable HTTP MCP endpoint.
   - Tool calls land at `/api/mcp/oasis`.

Local setup hides this because both endpoints are on `127.0.0.1`. Remote setup must make both lanes reachable.

## Local Same-Machine Setup

Use the local MCP URL:

```text
http://127.0.0.1:4516/api/mcp/oasis?agentType=<agent-type>
```

OpenClaw command:

```bash
openclaw mcp set oasis '{"url":"http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw","transport":"streamable-http"}'
```

Hermes config:

```yaml
mcp_servers:
  oasis:
    url: http://127.0.0.1:4516/api/mcp/oasis?agentType=hermes
```

## VPS Tunnel Setup

When the agent runs on a VPS and Oasis runs on the user's laptop, use one SSH session with both forwards.

OpenClaw Gateway on the VPS:

```bash
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 18789:127.0.0.1:18789 -R 4516:127.0.0.1:4516 user@openclaw-host
```

- `-L 18789` lets the local Oasis browser reach the remote OpenClaw Gateway at `ws://127.0.0.1:18789`.
- `-R 4516` lets the remote OpenClaw process reach the local Oasis MCP endpoint at `http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw`.
- `ExitOnForwardFailure=yes` makes SSH fail immediately if either forwarded port cannot bind.
- `ServerAliveInterval=15` and `ServerAliveCountMax=3` are SSH keepalives; after about 45 seconds without replies, SSH exits and releases the ports.

Hermes on the VPS:

```bash
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 8642:127.0.0.1:8642 -R 4516:127.0.0.1:4516 user@hermes-host
```

- `-L 8642` lets local Oasis reach the Hermes API.
- `-R 4516` lets remote Hermes reach Oasis MCP.

## Suggested OpenClaw Config UI

Keep one OpenClaw config tab with a local/remote mode switch.

For remote mode, show two lane cards and one copyable combined command:

1. Gateway WS lane: local Oasis connects to `ws://127.0.0.1:18789`.
2. Oasis MCP lane: remote OpenClaw connects to `http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw`.

The two lane fields make failures understandable, while the one combined SSH command keeps the user flow short.

## OpenClaw Pairing Request Ids

The pairing request id is created by the OpenClaw Gateway when a new Oasis device connects and signs the Gateway challenge.

For a local Gateway, Oasis can inspect local pending devices. For a VPS Gateway, the pending device list lives on the VPS, so the user or the remote OpenClaw agent must run:

```bash
openclaw devices list
openclaw devices approve <requestId>
```

Approve only the expected Oasis device, usually `gateway-client` / `node`. Do not auto-approve a new device without explicit user approval.

## Hosted Relay Direction

For a deployed Oasis app, do not ask normal users to run SSH. The product-grade shape is:

- User logs into Oasis.
- Oasis issues a short-lived pairing URL or code for exactly one agent.
- The agent connects to a public HTTPS/WSS relay with a scoped token.
- The browser keeps an outbound connection open for live screenshots and GPU-rendered world state.
- MCP requests route through the relay to the correct browser/world/session.

This keeps both sides outbound-only for users, avoids laptop inbound ports, and lets the service revoke or rotate the agent token.

## Browser Vision Boundary

Vision is browser-mediated.

`screenshot_viewport` and avatar screenshot tools require:

- a live Oasis browser tab
- the screenshot bridge mounted in that tab
- the browser being in the requested world

If the bridge is absent, world tools can still work while screenshots fail.

## World Tool Substrate

The shared tool code lives at `src/lib/mcp/oasis-tools.ts` and feeds:

- remote streamable HTTP MCP: `src/app/api/mcp/oasis/route.ts`
- REST fallback: `POST /api/oasis-tools`
- local stdio MCP server

`get_world_state` includes catalog objects, crafted scenes, lights, agent avatars, placed conjured assets, behaviors, live player avatar context, and live player camera context.
