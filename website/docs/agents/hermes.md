---
sidebar_position: 5
title: Hermes
---

# Hermes

Hermes is the world-aware chat bridge in Oasis. It's how a remote agent talks to you inside the Oasis UI while simultaneously reaching into the world to place objects, craft scenes, and take screenshots.

If you just want to get connected, read the [Quickstart](../getting-started/quickstart). This page covers what's actually happening under the hood.

## What Hermes is in Oasis

Hermes itself is an external agent runtime (typically running on a VPS). Oasis doesn't host Hermes — it integrates with it. The Oasis side of the integration gives the agent three things at once: a chat surface, world context, and world-mutating tools.

## Three-layer integration

Hermes connects to Oasis through three complementary layers. Each one can work without the others, but all three together is what turns a chatbot into a world-aware builder.

### 1. MCP endpoint — tools

Oasis exposes a remote MCP server at `/api/mcp/oasis` (streamable HTTP). This is where the 35+ world tools live: `place_object`, `craft_scene`, `screenshot_viewport`, `set_sky`, and friends.

Configure it in `~/.hermes/config.yaml` on the Hermes VPS:

```yaml
mcp_servers:
  oasis:
    url: http://127.0.0.1:4516/api/mcp/oasis?agentType=hermes
```

The config key is `mcp_servers` (snake_case, plural). NOT `mcp`, NOT `mcpServers`. After saving, run `/reload-mcp` in the Hermes session.

See [MCP Tools](./mcp-tools) for the full tool catalog.

### 2. Plugin — per-turn context

The optional Oasis Hermes plugin (`hermes-plugin/oasis`) injects a compact world summary into every agent turn before tools are called. The agent knows the sky, ground, object count, and player position without having to call `get_world_state` first.

Install:

```bash
cp -r hermes-plugin/oasis ~/.hermes/plugins/oasis
```

Plugin and MCP together is the best combination: plugin gives always-on context, MCP gives the hands.

### 3. Skill — procedures

The Oasis skill (`skills/oasis/SKILL.md`, published as a Hermes tap) teaches your agent *how to use* the Oasis tools — when to self-craft vs. delegate to the sculptor, how to do progressive verification, what vision tools require. It's the playbook.

Install on your Hermes agent:

```bash
hermes skills tap add Parzival-Moksha/oasis
hermes skills install oasis
/reload-mcp
```

## Pairing config — where it lives and why

Hermes pairing (the API base + API key Oasis uses to call back into Hermes) lives in two places:

| Location | Source | Purpose |
|---|---|---|
| `data/hermes-config.local.json` | App-managed, written by the paste-config UI flow | Dynamic, user-authored, reload-instant |
| `.env` (`HERMES_API_KEY`, `HERMES_API_BASE`) | Human-authored, static | Fallback when no pairing file exists |

The stored JSON always wins if present. If the file is missing or empty, Oasis falls back to the `.env` values. Delete the file (via the config UI's "disconnect" action) to fall back again.

Why this split:
- The JSON file is **app-authored dynamic config**. The Oasis UI writes it when you paste a pairing blob. No restart needed — the server reads it fresh on every request.
- The env var is **human-authored static config**. Fine for dev machines where you never rotate keys. Survives accidental JSON deletion.

The paste parser in the config UI accepts three shapes:
- JSON object with `apiBase` / `apiKey` keys
- `oasis://` URL with `base` / `key` query params
- Env-style blob (`HERMES_API_BASE=...` / `HERMES_API_KEY=...` on separate lines)

Whichever your Hermes gateway hands you, paste it. The parser figures it out.

## SSH dual-forward tunnel

When Hermes lives on a VPS and Oasis runs on your laptop, you need a single SSH session with two forwards — one for chat traffic outbound, one for MCP traffic inbound:

```bash
ssh -o ExitOnForwardFailure=yes \
  -L 8642:127.0.0.1:8642 \
  -R 4516:127.0.0.1:4516 \
  user@your-vps -N
```

- `-L 8642` lets Oasis reach the Hermes API over `127.0.0.1:8642`.
- `-R 4516` lets Hermes reach the Oasis MCP endpoint over `127.0.0.1:4516` from the VPS side.

:::warning
Without the `-R 4516` half, Hermes can chat but cannot touch the world. This is the #1 cause of "why does my agent pretend to place things but nothing appears" issues.
:::

The tunnel route (`/api/hermes/tunnel`) can remember and relaunch this command for you, so you don't have to rebuild the forward every time.

## Self-craft is the default

When you ask Hermes to build something procedural (campfire, shrine, crystal cluster, fountain), the skill instructs it to **write the primitives itself** and pass them as the `objects` array to `craft_scene`.

The sculptor fallback (`strategy: "sculptor"`) spawns an out-of-process Claude Code subprocess on the Oasis host — it costs a real LLM call, takes seconds to stream primitives in, and requires the Claude Code CLI on PATH. Use it only for deliberately ambitious scenes or when you explicitly say "have the sculptor do it."

Otherwise: self-craft. Hermes is an LLM. It can write the JSON.

## Security & remote access

Oasis keeps Hermes surfaces conservative by default:

- `/api/hermes` (the chat proxy) is localhost-only.
- Pairing writes (`POST` / `DELETE /api/hermes/config`) are localhost-only.
- Pairing JSON at `data/hermes-config.local.json` is gitignored; on Unix it's chmod 0600.

To allow remote access (exposing Oasis to a network rather than just your machine):

- Set `OASIS_ALLOW_REMOTE_HERMES_PROXY=true` to open the chat proxy.
- Set `OASIS_ALLOW_REMOTE_HERMES_PAIRING=true` to allow remote pairing writes.

For multi-user Oasis hosts, set `OASIS_MCP_KEY` and send a matching `Authorization: Bearer` header from the Hermes side. Solo / local users should skip this — the SSH reverse tunnel is already the auth boundary.

## Reference

### Core routes

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/hermes` | `GET`, `POST` | Main Hermes chat bridge |
| `/api/hermes/config` | `GET`, `POST`, `DELETE` | Pairing storage (paste-parser + file writes) |
| `/api/hermes/sessions` | `GET` | Session history |
| `/api/hermes/media` | `GET` | Media attachment inspection |
| `/api/hermes/transcribe` | `GET`, `POST` | Speech transcription |
| `/api/hermes/tunnel` | `GET`, `POST`, `DELETE` | SSH tunnel command storage and control |

### Links

- [Quickstart](../getting-started/quickstart) — six-step onboarding from clone to `take a screenshot`
- [MCP Tools](./mcp-tools) — full tool catalog
- [Hermes skill on GitHub](https://github.com/Parzival-Moksha/oasis/tree/main/skills/oasis) — source of truth for skill behavior
