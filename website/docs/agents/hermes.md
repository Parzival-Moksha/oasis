---
sidebar_position: 5
title: Hermes
---

# Hermes

Hermes is one supported remote-agent runtime for Oasis. Oasis does not host Hermes; it gives Hermes a chat surface, world context, and world-mutating MCP tools.

For the shortest setup path, start with the [Quickstart](../getting-started/quickstart).

## Integration Layers

Hermes can use three layers:

| Layer | Purpose |
|---|---|
| MCP endpoint | Gives Hermes world tools such as `place_object`, `craft_scene`, `walk_avatar_to`, and `screenshot_viewport`. |
| Optional plugin | Injects compact world context into Hermes turns. |
| Oasis skill | Teaches Hermes how to use the shared Oasis tools safely and effectively. |

The skill is no longer Hermes-only. It is the shared Oasis skill for Hermes, OpenClaw, and other MCP-capable agents.

## MCP Endpoint

Oasis exposes streamable HTTP MCP at:

```text
http://127.0.0.1:4516/api/mcp/oasis?agentType=hermes
```

Hermes config:

```yaml
mcp_servers:
  oasis:
    url: http://127.0.0.1:4516/api/mcp/oasis?agentType=hermes
```

The config key is `mcp_servers` with snake case and plural form. After saving, run `/reload-mcp`.

## Optional Plugin

The optional Oasis Hermes plugin lives at `hermes-plugin/oasis`. It gives Hermes passive world context before tool calls. MCP is still the actual tool hand.

Install:

```bash
cp -r hermes-plugin/oasis ~/.hermes/plugins/oasis
```

## Skill

Until ClawHub publishing is ready, ask Hermes to read:

```text
https://raw.githubusercontent.com/Parzival-Moksha/oasis/main/skills/oasis/SKILL.md
```

If your Hermes version supports repo taps:

```bash
hermes skills tap add Parzival-Moksha/oasis
hermes skills install oasis
/reload-mcp
```

## Pairing Config

Hermes pairing is the API base plus API key that Oasis uses to call Hermes.

| Location | Purpose |
|---|---|
| `data/hermes-config.local.json` | App-managed, reload-instant config written by the Oasis UI. |
| `.env` (`HERMES_API_BASE`, `HERMES_API_KEY`) | Static fallback for dev machines. |

The UI parser accepts JSON, `oasis://` URLs, and env-style blobs.

## VPS Bridge

When Hermes runs on a VPS and Oasis runs on your laptop, use one SSH command with two forwards:

```bash
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 8642:127.0.0.1:8642 -R 4516:127.0.0.1:4516 user@hermes-host
```

- `-L 8642` lets local Oasis reach the remote Hermes API.
- `-R 4516` lets remote Hermes reach local Oasis MCP.
- `ExitOnForwardFailure=yes` fails fast if a tunnel port is already occupied.
- `ServerAliveInterval=15` and `ServerAliveCountMax=3` are SSH keepalives. If the bridge stops answering for about 45 seconds, SSH exits and frees the ports for reconnect.

Without the `-R 4516` half, Hermes may chat but cannot touch the world.

## Security

Oasis keeps Hermes surfaces local by default:

- `/api/hermes` is localhost-only.
- Pairing writes are localhost-only.
- `data/hermes-config.local.json` is gitignored.

Only expose remote access deliberately. For shared hosts, set `OASIS_MCP_KEY` and require `Authorization: Bearer <token>` on remote MCP calls.

## Reference

| Route | Purpose |
|---|---|
| `/api/hermes` | Main Hermes chat bridge |
| `/api/hermes/config` | Pairing storage |
| `/api/hermes/sessions` | Session history |
| `/api/hermes/media` | Media attachment inspection |
| `/api/hermes/transcribe` | Speech transcription |
| `/api/hermes/tunnel` | SSH tunnel command storage and lifecycle |

See [MCP Tools](./mcp-tools) for the full shared tool catalog.
