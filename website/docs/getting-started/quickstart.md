---
sidebar_position: 1
title: Quickstart
---

# Quickstart

Connect an agent to a local Oasis. The same Oasis skill supports Hermes, OpenClaw, and other MCP-capable agents.

:::info Reference client
Oasis is built and tested primarily on Windows 10/11 with Brave or another Chromium browser. The server side is tested on Ubuntu. Other browsers and OSes can work, but Chromium on Windows is the reference path.
:::

## 1. Run Oasis locally

```bash
git clone https://github.com/Parzival-Moksha/oasis.git
cd oasis
pnpm install
cp .env.example .env
npx prisma db push
pnpm dev
```

Open [http://localhost:4516](http://localhost:4516).

Node 18+ and pnpm 10+ are required. No API keys are needed for chat, world state, placement, self-crafting, avatar movement, or screenshots.

## 2. Give the agent the Oasis skill

Until the ClawHub package is published, use the raw skill URL:

```text
Read https://raw.githubusercontent.com/Parzival-Moksha/oasis/main/skills/oasis/SKILL.md and connect to my Oasis.
```

After the skill is published, OpenClaw users should be able to install it with:

```bash
openclaw skills install oasis
```

Hermes users can keep using the Hermes tap flow if their Hermes version supports it:

```bash
hermes skills tap add Parzival-Moksha/oasis
hermes skills install oasis
/reload-mcp
```

## 3. Choose the connection shape

### Same machine

If the agent and Oasis run on the same machine, no tunnel is needed. The agent registers this MCP URL:

```text
http://127.0.0.1:4516/api/mcp/oasis?agentType=<agent-type>
```

OpenClaw local command:

```bash
openclaw mcp set oasis '{"url":"http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw","transport":"streamable-http"}'
```

### OpenClaw on a VPS

If OpenClaw runs on a VPS and Oasis runs on your laptop, one SSH bridge carries both directions:

```bash
ssh -o ExitOnForwardFailure=yes -L 18789:127.0.0.1:18789 -R 4516:127.0.0.1:4516 user@openclaw-host -N
```

- `-L 18789` lets your local Oasis browser reach the remote OpenClaw Gateway at `ws://127.0.0.1:18789`.
- `-R 4516` lets the remote OpenClaw process reach your local Oasis MCP endpoint at `http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw`.

In Oasis, open the OpenClaw panel, go to **config**, set Gateway WS to:

```text
ws://127.0.0.1:18789
```

If the panel shows a pending pairing request, approve it on the Gateway host.

### Hermes on a VPS

Hermes uses the same idea with its chat API port:

```bash
ssh -o ExitOnForwardFailure=yes -L 8642:127.0.0.1:8642 -R 4516:127.0.0.1:4516 user@hermes-host -N
```

- `-L 8642` lets Oasis reach the Hermes API.
- `-R 4516` lets Hermes reach Oasis MCP.

Paste the Hermes pairing blob and SSH command into the Oasis Hermes panel. Let Oasis own the tunnel lifecycle so you do not bind the same ports twice.

## 4. Run the smoke test

Run these prompts in order:

1. `hi`
   - Proves chat is alive.
2. `describe this world`
   - Expect `get_world_state` or `get_world_info`.
   - Proves MCP tools are reachable.
3. `find a cyberpunk streetlamp and place one in front of me`
   - Expect `search_assets`, then `place_object`.
   - Proves catalog read and world mutation.
4. `craft a small campfire with embers and a crystal cluster`
   - Expect `craft_scene` with an `objects` array.
   - Proves self-craft.
5. `take a screenshot and tell me what you see`
   - Expect `screenshot_viewport` with `mode: "current"`.
   - Proves the live browser screenshot bridge is attached.

If step 1 works but step 2 fails, the MCP path is broken. For VPS setups, check the `-R 4516` reverse forward. If steps 2-4 work but step 5 fails, keep the Oasis browser tab open in the target world.

## Optional Extras

The smoke test works with zero keys.

Add keys to `.env` only when you want the extra feature:

| `.env` var | Unlocks |
|---|---|
| `OPENROUTER_API_KEY` | Image generation, material concepts, terrain LLM |
| `FAL_KEY` | Video generation |
| `ELEVENLABS_API_KEY` | Voice notes and TTS |
| `MESHY_API_KEY` | Meshy Forge conjuration |
| `TRIPO_API_KEY` | Fast Tripo text-to-3D |

Install Claude Code locally only if you want local Anorak/Merlin flows or the optional `craft_scene` sculptor fallback.

## Next Steps

- [OpenClaw](../agents/openclaw) - OpenClaw Gateway, pairing, and remote connection notes
- [Hermes](../agents/hermes) - Hermes API, plugin, and tunnel notes
- [MCP Tools](../agents/mcp-tools) - full tool catalog
- [Your First World](./first-world) - build something start-to-finish
