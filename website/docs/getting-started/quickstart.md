---
sidebar_position: 1
title: Quickstart
---

# Quickstart

Connect your Hermes agent to your local Oasis in five steps. By the end, your agent chats, builds, crafts, and sees.

:::info Reference client
The Oasis is built and tested primarily on **Windows 10/11 with Brave (Chromium)**. It runs on all major OSes and Chromium-based browsers, but Brave on Windows is the reference platform. If something looks off in Firefox, Safari, or Linux browsers, that's where to start debugging. Server side is tested on Ubuntu.
:::

:::info
This is the canonical onboarding path. If you arrived from the Hermes skill publication or Nous Discord, start here.
:::

## 1. Spin up Oasis locally

```bash
git clone https://github.com/Parzival-Moksha/oasis.git
cd oasis
pnpm install
pnpm approve-builds    # approve: prisma, @prisma/client, @prisma/engines
cp .env.example .env   # DATABASE_URL etc — required before prisma commands
npx prisma generate
npx prisma db push
pnpm dev
```

Open [http://localhost:4516](http://localhost:4516). You should land in the main 3D world with the Wizard Console available.

:::info
pnpm 10+ blocks postinstall scripts by default. Prisma needs them to generate its client and binaries. `pnpm approve-builds` is a one-time trust step — toggle the three `prisma*` entries with spacebar, confirm, done.

`npx prisma db push` creates the SQLite database at `prisma/data/oasis.db` on a fresh clone. Without it, the world won't load.
:::

Node 18+ and pnpm required. No API keys needed for the progressive smoke test below — those unlock extra tools later.

## 2. Tell your Hermes agent to read the skill

Paste this one line to Hermes on Telegram, CLI, or any existing channel:

```text
Read https://raw.githubusercontent.com/Parzival-Moksha/oasis/main/skills/oasis/SKILL.md and connect to my Oasis following its instructions.
```

That's it. The `SKILL.md` is written for agent consumption — it tells Hermes the topology (you on your laptop, Hermes on the VPS), the MCP URL, the SSH tunnel command, the progressive smoke test, everything. One WebFetch on Hermes' side, no repo clone.

:::info
**Why not `hermes skills install`?** Hermes has a built-in skill installer, but support for third-party repos is uneven across Hermes versions. The raw `SKILL.md` URL is the lowest-common-denominator path — every Hermes can WebFetch.
:::

If you still want the CLI install flow (some Hermes versions do support it):

```bash
hermes skills tap add Parzival-Moksha/oasis
hermes skills install oasis
/reload-mcp
```

Either path reaches the same `SKILL.md` content.

:::tip
If `/reload-mcp` reports "No MCP servers connected", Hermes is missing the `[mcp]` pip extra. Run `cd ~/.hermes/hermes-agent && uv pip install -e ".[mcp]"` and retry.
:::

## 3. Wire Hermes ↔ Oasis (tunnel + pairing paste)

In step 2, Hermes should have handed you back two things: a **dual-forward SSH tunnel command** and a **pairing blob**. Do both now.

:::info
If your Hermes didn't hand these back, ask: `output the SSH tunnel command and Hermes pairing blob so I can wire us up`. The skill instructs it to, but older Hermes versions may need a nudge.
:::

### 3a. Start the tunnel (local machine → your Hermes VPS)

Run this on YOUR machine (where Oasis is), substituting your VPS user/host:

```bash
ssh -o ExitOnForwardFailure=yes \
  -L 8642:127.0.0.1:8642 \
  -R 4516:127.0.0.1:4516 \
  user@your-vps -N
```

- `-L 8642` — opens local port 8642; your Oasis UI uses this to reach the Hermes API.
- `-R 4516` — opens remote port 4516 on the VPS; Hermes uses this to reach your Oasis MCP.

:::warning
Both forwards are required. Without `-R 4516`, Hermes chats but tool calls fail. Without `-L 8642`, the chat panel can't reach Hermes. Leave this SSH session running in the background (`-N` = no shell, just forwards).

If Hermes runs on the same machine as Oasis, skip this entirely.
:::

### 3b. Paste the pairing blob into Oasis

With Oasis open at [http://localhost:4516](http://localhost:4516):

1. Click the **☤** button in the left toolbar.
2. Click **config**.
3. Paste the blob Hermes gave you. It looks like:
   ```text
   HERMES_API_BASE=http://127.0.0.1:8642/v1
   HERMES_API_KEY=<the actual key from Hermes>
   ```
   The parser also accepts JSON objects or `oasis://` URL shapes.
4. Click **save & connect**.

Pairing is written to `data/hermes-config.local.json` (gitignored). You can also set `HERMES_API_KEY` / `HERMES_API_BASE` in `.env` as a static fallback — see [Hermes agent reference](../agents/hermes) for the split.

:::tip
Make sure your Hermes gateway has `API_SERVER_ENABLED=true` in `~/.hermes/.env` or it won't answer the pairing call. Hermes' side of the skill is supposed to flag this — but double-check if step 4 below bugs.
:::

## 4. Progressive smoke test

Run these five prompts in order. Each step escalates what it proves working.

1. **Plain chat** — say `hi`.
   - Proves: Hermes API reachable, panel wired up.
2. **World awareness** — say `describe this world`.
   - Expect `get_world_state` to fire. The agent should narrate sky, ground, object counts.
   - Proves: MCP transport up, plugin context injection working.
3. **Asset + placement** — say `find a cyberpunk streetlamp and place one in front of me`.
   - Expect `search_assets` then `place_object`.
   - Proves: catalog read, world mutation, no API keys required.
4. **Self-craft** — say `craft a small campfire with embers and a crystal cluster`.
   - Expect `craft_scene` with an `objects` array (NOT `strategy: "sculptor"`).
   - Proves: self-craft path, rendering, no API keys required.
5. **Vision** — say `take a screenshot and tell me what you see`.
   - Expect `screenshot_viewport` with `mode: "current"`.
   - Proves: live browser bridge attached.

:::tip
If step 1 passes but 2 fails, check the SSH `-R 4516` reverse forward — that's the MCP path. If 2–4 pass but 5 fails, the Oasis browser tab is closed or the screenshot bridge is not mounted.
:::

## 5. What needs API keys

The smoke test above works with **zero API keys on the Oasis host**. World state, placement, self-crafting, screenshots, and plain chat all run without external providers.

Optional keys in `.env` unlock extra tool surface:

| `.env` var | Unlocks |
|---|---|
| `OPENROUTER_API_KEY` | Image generation (textures, material concepts), terrain generation via LLM |
| `FAL_KEY` | Video generation |
| `ELEVENLABS_API_KEY` | Voice notes / TTS in agent panels |
| `MESHY_API_KEY` | Forge conjuration: text-to-3D, image-to-3D, rigging, animation |
| `TRIPO_API_KEY` | Forge conjuration: fast text-to-3D |
| Claude Code CLI on PATH | `craft_scene` sculptor fallback (also powers Merlin, Anorak, Anorak Pro local agents) |

If a tool requires a key the host does not have, the call returns a clear error. Prefer self-craft and catalog placement for zero-config flows.

## Next steps

- [Hermes agent reference](../agents/hermes) — how pairing, plugin, and skill fit together
- [MCP Tools](../agents/mcp-tools) — full tool catalog
- [Your First World](./first-world) — build something start-to-finish
- [Controls & Camera](../user-guide/controls) — WASD, gizmos, pointer lock
