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
pnpm install           # auto-generates prisma client
cp .env.example .env
npx prisma db push     # creates prisma/data/oasis.db
pnpm dev
```

Open [http://localhost:4516](http://localhost:4516). You should land in the main 3D world with the Wizard Console available.

Node 18+ and pnpm 10+ required. No API keys needed for the progressive smoke test below — those unlock extra tools later.

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

## 3. Paste what Hermes gave you into Oasis

In step 2, Hermes hands back two things: an **SSH tunnel command** and a **pairing blob**. Paste BOTH into the Oasis Hermes panel — not into a terminal. Oasis owns the tunnel lifecycle; it spawns, restarts, and tears down for you.

In Oasis at [http://localhost:4516](http://localhost:4516):

1. Click the **☤** button in the left toolbar → **config**
2. Paste the pairing blob into **CONNECTION DATA** (`HERMES_API_BASE=... / HERMES_API_KEY=...`)
3. Paste the SSH command into **SSH TUNNEL** (whole thing, as one line or as-given)
4. Click **save & connect**

Status should flip to **CONNECTED / SAVED / SSH SAVED / OASIS-READY** and the chat input unlocks.

:::warning
Do NOT also run the SSH command in a terminal. If you do, the terminal's tunnel binds ports 8642/4516, Oasis's own spawn hits "address already in use" and dies with exit 255. One tunnel at a time. Let Oasis own it.
:::

:::info
If Hermes didn't include a pairing blob or tunnel command, ask: `output the SSH tunnel command and Hermes pairing blob so I can wire us up`. Older Hermes versions need the nudge.

If Hermes and Oasis are on the same machine, leave the SSH TUNNEL field empty — no tunnel needed.
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

## 5. Optional extras

The smoke test above works with **zero keys, zero extra installs**. World state, placement, self-crafting, screenshots, and Hermes chat all run out of the box.

Everything below is optional — enable only what you want.

### External API keys (add to `.env`, restart `pnpm dev`)

| `.env` var | Unlocks |
|---|---|
| `OPENROUTER_API_KEY` | Image generation (textures, material concepts), terrain generation via LLM |
| `FAL_KEY` | Video generation |
| `ELEVENLABS_API_KEY` | Voice notes / TTS in agent panels |
| `MESHY_API_KEY` | Forge conjuration: text-to-3D, image-to-3D, rigging, animation |
| `TRIPO_API_KEY` | Forge conjuration: fast text-to-3D |

If a tool requires a key that's not set, the call returns a clear error. Nothing crashes.

### Claude Code CLI (for local agents + sculptor fallback)

Install [Claude Code](https://claude.com/claude-code), log in once. Enables:

- **Merlin** — the in-Oasis build agent with vision and MCP tools
- **Anorak** — the vibecode chat agent
- **Anorak Pro** — the autonomous curator → coder → reviewer → tester → gamer pipeline
- `craft_scene` sculptor fallback when you explicitly ask an MCP agent to delegate crafting

If `claude` is on PATH, these light up automatically. If not, the buttons still show but return a clear "CLI not found" error.

### Local speech-to-text (optional, for mic input)

Oasis ships a local Whisper worker so the mic button transcribes on-device, no cloud. One-time setup:

```bash
# Ubuntu/WSL:
sudo apt install -y python3-pip python3-venv ffmpeg
python3 -m venv ~/.oasis-stt
source ~/.oasis-stt/bin/activate
pip install ctranslate2 faster-whisper
echo 'export OASIS_STT_PYTHON="$HOME/.oasis-stt/bin/python"' >> ~/.bashrc

# macOS (via brew + pyenv or similar):
brew install ffmpeg
python3 -m venv ~/.oasis-stt
source ~/.oasis-stt/bin/activate
pip install ctranslate2 faster-whisper
echo 'export OASIS_STT_PYTHON="$HOME/.oasis-stt/bin/python"' >> ~/.zshrc

# Windows (Python 3.11+ from python.org):
py -m venv %USERPROFILE%\.oasis-stt
%USERPROFILE%\.oasis-stt\Scripts\activate
pip install ctranslate2 faster-whisper
setx OASIS_STT_PYTHON "%USERPROFILE%\.oasis-stt\Scripts\python.exe"
```

Restart `pnpm dev` after. First mic press downloads the `distil-large-v3` weights (~600MB) into `~/.cache/huggingface/`. Subsequent transcriptions are 1-3s on CPU.

Env overrides:
- `OASIS_STT_MODEL` — default `distil-large-v3`. Try `small` for speed, `large-v3` for accuracy.
- `OASIS_STT_DEVICE` — default `auto`. Set to `cpu` on WSL (GPU passthrough is finicky).
- `OASIS_STT_COMPUTE_TYPE` — default `float16` on GPU / `int8` on CPU.

Without the venv, the mic button still works if Oasis finds `python3` on PATH with `ctranslate2` installed globally — but venv is cleaner.

## Next steps

- [Hermes agent reference](../agents/hermes) — how pairing, plugin, and skill fit together
- [MCP Tools](../agents/mcp-tools) — full tool catalog
- [Your First World](./first-world) — build something start-to-finish
- [Controls & Camera](../user-guide/controls) — WASD, gizmos, pointer lock
