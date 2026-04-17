# Oasis — The Oasis

**Conjure 3D worlds from text. Build. Paint. Persist.**

A standalone 3D world builder with AI-powered text-to-3D conjuring, terrain painting, procedural terrain generation, and full world persistence. Built with Next.js 14 + React Three Fiber + Three.js + Zustand.

> **Client note:** The Oasis is built and tested primarily on Windows 10/11 with Brave (Chromium). It runs on all major OSes + Chromium-based browsers, but Brave on Windows is the reference platform — if something looks off in Firefox/Safari/Linux, that's where to start debugging. Servers tested on Ubuntu.

## Quick Start

```bash
git clone https://github.com/Parzival-Moksha/oasis.git
cd oasis
pnpm install
pnpm approve-builds    # say "yes" to prisma + @prisma/client + @prisma/engines
cp .env.example .env   # DATABASE_URL etc — required before prisma commands
npx prisma generate
npx prisma db push     # creates prisma/data/oasis.db on first run
```

Edit `.env` to add any API keys you want (all optional for the core Hermes flow):

```env
MESHY_API_KEY=your_key_here       # meshy.ai — text-to-3D + rigging + animation
TRIPO_API_KEY=your_key_here       # tripo3d.ai — text-to-3D (fast)
OPENROUTER_API_KEY=your_key_here  # openrouter.ai — LLM craft + terrain generation
```

Then run:

```bash
pnpm dev
```

Open [http://localhost:4516](http://localhost:4516)

## Connect Your Hermes Agent

Two channels connect your agent to the Oasis: **MCP** (tools) and **chat** (the panel). Both are needed for the full experience.

### Step 1: Tell Your Hermes Agent To Read The Skill

Paste this one line to Hermes on Telegram, CLI, or any existing channel:

```text
Read https://raw.githubusercontent.com/Parzival-Moksha/oasis/main/skills/oasis/SKILL.md and connect to my Oasis following its instructions.
```

That's it. The skill is written for agent consumption — it tells Hermes the topology (you on your laptop, Hermes on the VPS), the MCP URL, the SSH tunnel command, the progressive smoke test, everything. One WebFetch, no clone.

Optional CLI alternative (for Hermes versions with a working skill installer):

```bash
hermes skills tap add Parzival-Moksha/oasis
hermes skills install oasis
/reload-mcp
```

If your Hermes' built-in skill system errors out, use the WebFetch line instead — it reaches the same SKILL.md content.

### Step 2: Configure MCP (Agent Gets Tools)

Add the Oasis MCP server to `~/.hermes/config.yaml`. Hermes uses snake_case `mcp_servers:` keyed by server name (NOT `mcp:` or camelCase `mcpServers`):

```yaml
mcp_servers:
  oasis:
    url: http://127.0.0.1:4516/api/mcp/oasis?agentType=hermes
```

If you set `OASIS_MCP_KEY` in the Oasis `.env`, add a matching bearer header:

```yaml
mcp_servers:
  oasis:
    url: http://127.0.0.1:4516/api/mcp/oasis?agentType=hermes
    headers:
      Authorization: "Bearer ${MCP_OASIS_API_KEY}"
```

Run `/reload-mcp` in the Hermes session (or restart the gateway). You should see `35 tool(s) available from 1 server(s)`.

Replace `127.0.0.1:4516` with the Oasis host if it runs on a different machine. For other MCP clients (Claude Desktop, Claude Code, generic `mcp.json`), see `skills/oasis/SKILL.md` for the `mcpServers` JSON shape.

Your agent now has access to world-building tools: `place_object`, `craft_scene`, `screenshot_viewport`, `set_sky`, and 30+ more.

Note: self-craft is the default — Hermes writes the `objects` array itself when you ask for a procedural scene. The sculptor fallback (`strategy: "sculptor"`) requires Claude Code CLI on the Oasis PATH and is rarely needed.

### Step 3: Wire Hermes ↔ Oasis (tunnel + pairing paste)

In Step 1 your Hermes should have handed you back two things: an SSH tunnel command and a pairing blob. If not, say: `output the SSH tunnel command and Hermes pairing blob so I can wire us up`.

**3a. Start the dual-forward SSH tunnel** on YOUR machine (where Oasis is):

```
ssh -o ExitOnForwardFailure=yes \
  -L 8642:127.0.0.1:8642 \
  -R 4516:127.0.0.1:4516 \
  user@your-vps -N
```

Both forwards are required. `-L 8642` lets Oasis reach Hermes; `-R 4516` lets Hermes reach Oasis. Leave this running in the background. Skip this step if Hermes runs on the same machine as Oasis.

**3b. Paste the pairing blob into Oasis**:
1. Open [http://localhost:4516](http://localhost:4516) in your browser
2. Click the **☤** button in the left toolbar → **config**
3. Paste the blob (format: `HERMES_API_BASE=... / HERMES_API_KEY=...`)
4. Click **save & connect**

Make sure Hermes has `API_SERVER_ENABLED=true` in `~/.hermes/.env` or the pairing call won't answer.

### Step 4: Talk to Your Agent

Say: *"Look around the world and build me a campfire scene with trees."*

Your agent calls Oasis tools via MCP, objects appear live in the 3D world, and you see the conversation in the ☤ panel.

### Progressive Smoke Test

Verify the connection in this exact order. Each step escalates what it proves working.

1. **Plain chat** — say `hi`. Proves Hermes API reachable, panel wired up.
2. **World awareness** — say `describe this world`. Expect `get_world_state`. Proves MCP transport up, plugin context injection working.
3. **Asset + placement** — say `find a cyberpunk streetlamp and place one in front of me`. Expect `search_assets` + `place_object`. Proves catalog read + world mutation.
4. **Self-craft** — say `craft a small campfire with embers and a crystal cluster`. Expect `craft_scene` with an `objects` array (NOT `strategy: "sculptor"`). Proves self-craft path.
5. **Vision** — say `take a screenshot and tell me what you see`. Expect `screenshot_viewport` with `mode: "current"`. Proves live browser bridge attached.

If step 1 passes but 2 fails, check the SSH `-R 4516` reverse forward. If 2-4 pass but 5 fails, the Oasis browser tab is closed or the screenshot bridge is not mounted.

### What Needs API Keys

The core smoke test (steps 1-5) works with **zero API keys on the Oasis host**. World state, placement, self-crafting, screenshots, and plain chat all run without external providers.

Optional keys in `.env` unlock extra tool surface:

| `.env` var | Unlocks |
|------------|---------|
| `OPENROUTER_API_KEY` | Image generation (textures, material concepts), terrain generation via LLM |
| `FAL_KEY` | Video generation |
| `ELEVENLABS_API_KEY` | Voice notes / TTS in agent panels |
| `MESHY_API_KEY` | Forge conjuration: text-to-3D, image-to-3D, rigging, animation |
| `TRIPO_API_KEY` | Forge conjuration: fast text-to-3D |
| Claude Code CLI on PATH | `craft_scene` sculptor fallback (and Merlin / Anorak / Anorak Pro local agents) |

If a tool requires a key the host does not have, the tool call returns a clear error. Prefer self-craft and catalog placement for zero-config flows.

### Optional: Install the Plugin

For automatic world context in every agent turn (no explicit tool call needed):

```bash
cp -r hermes-plugin/oasis ~/.hermes/plugins/oasis
```

The plugin injects a compact world summary before each response and a full world state at session start.

### Security Defaults

- `/api/hermes` is localhost-only by default.
- Pairing writes (`POST`/`DELETE /api/hermes/config`) are localhost-only by default.
- To allow remote access, set `OASIS_ALLOW_REMOTE_HERMES_PROXY=true` and `OASIS_ALLOW_REMOTE_HERMES_PAIRING=true`.
- Local pairing is stored in `data/hermes-config.local.json` (git-ignored).

## Optional Extras

Core flow (git clone → pnpm dev → Hermes skill connect) needs zero keys and zero extras. These light up more features.

| What | How to enable |
|---|---|
| **Text-to-3D, image gen, video, voice** | Add keys to `.env`: `MESHY_API_KEY`, `TRIPO_API_KEY`, `OPENROUTER_API_KEY`, `FAL_KEY`, `ELEVENLABS_API_KEY` |
| **Merlin, Anorak, Anorak Pro** (local build agents) | Install [Claude Code CLI](https://claude.com/claude-code), log in once. Oasis spawns `claude` on your PATH. |
| **Mic input (local Whisper STT)** | `python3 -m venv ~/.oasis-stt && source ~/.oasis-stt/bin/activate && pip install ctranslate2 faster-whisper`, then `export OASIS_STT_PYTHON=~/.oasis-stt/bin/python`. Restart `pnpm dev`. |
| **`craft_scene` sculptor fallback** | Same Claude Code CLI. Rarely needed — Hermes/Merlin/Anorak self-craft by default. |

Tools gracefully return errors if their dependency isn't set up. Nothing crashes.

See [docs quickstart → Optional extras](https://parzival-moksha.github.io/oasis/docs/getting-started/quickstart/#5-optional-extras) for platform-specific install commands (Linux/WSL, macOS, Windows).

## What You Can Do

- **Conjure** — Type a prompt, get a 3D model. Multiple providers (Meshy, Tripo, Rodin) with different quality tiers.
- **Animate** — Rig and animate conjured characters. Walk cycles, idle animations, custom motion.
- **Paint** — Paint ground textures tile-by-tile with real-time brush. Grass, stone, sand, lava, and more.
- **Terrain** — Describe a landscape in natural language, get procedural terrain with height maps and vertex-colored biomes.
- **Craft** — LLM-powered scene generation. Describe a scene, get procedural geometry.
- **Build** — Place, move, rotate, scale any object. 480+ built-in assets (cyberpunk, medieval, urban, furniture, nature). Full transform gizmos.
- **Light** — Add point lights, spotlights, hemisphere lights. Full color, intensity, shadow control.
- **Persist** — Every change autosaves into local SQLite. Create multiple worlds, switch between them.
- **Sky** — 24 sky environments: 4 night panoramas + 8 Poly Haven HDRIs (alps, grotto, sunset, stadium...) + 10 drei presets + procedural stars

## Controls

| Key | Action |
|-----|--------|
| WASD | Move camera |
| Mouse drag | Look around |
| Scroll | Zoom |
| W / E / R | Translate / Rotate / Scale (when object selected) |
| Escape | Deselect / Cancel placement |
| Delete | Remove selected object |
| Right-click ground | Send animated character to position (RTS-style) |

## Architecture

```
src/
  components/
    Scene.tsx              — Main R3F canvas, sky, post-processing
    forge/
      WizardConsole.tsx    — The command center (conjure, craft, assets, settings)
      WorldObjects.tsx     — Renders all placed objects + placement system
      ConjuredObject.tsx   — Individual GLB renderer with spawn VFX
  store/
    oasisStore.ts          — Zustand state (worlds, assets, UI)
  lib/
    conjure/               — Provider clients (Meshy, Tripo, Rodin) + registry
    forge/                 — World persistence, terrain generator
  app/
    api/                   — Next.js API routes (conjure, craft, terrain, worlds)
data/
  prisma/data/oasis.db     — Local SQLite database for worlds, snapshots, profiles, and missions
  conjured-registry.json   — Asset metadata (GLB paths, providers, thumbnails)
  worlds/                  — Legacy world JSON leftovers (not used by the current world API)
  scene-library.json       — Saved crafted scenes
public/
  conjured/                — Runtime-generated GLB files
  models/                  — Built-in asset library (Quaternius + Kenney, all CC0)
  hdri/                    — Sky environment textures
  textures/                — Ground painting textures
```

## Requirements

- Node.js 18+
- pnpm (recommended) or npm
- At least one API key (Meshy, Tripo, or OpenRouter)

## API Keys

| Provider | What For | Get Key |
|----------|----------|---------|
| [Meshy](https://meshy.ai) | Text-to-3D, image-to-3D, rigging, animation | Dashboard > API Keys |
| [Tripo](https://tripo3d.ai) | Text-to-3D, image-to-3D (fast) | Dashboard > API |
| [OpenRouter](https://openrouter.ai) | LLM craft + terrain generation | Dashboard > Keys |

You need at least one 3D provider key (Meshy or Tripo) to conjure. OpenRouter enables terrain and craft features.

## Default World

On a fresh SQLite database, Oasis auto-creates a first world named **The Forge**.

You may still see legacy artifacts like `data/worlds/forge-default.json` or `data/oasis.db` in the repo root. The current app does not load worlds from those files. Active world data lives in `prisma/data/oasis.db`.

## Asset Credits

Built-in 3D assets and environments provided by these incredible creators (all CC0 / public domain):

- **[Quaternius](https://quaternius.com)** — Cyberpunk Game Kit, Sci-Fi Essentials, characters
- **[Kenney](https://kenney.nl)** — Retro Medieval Kit (105 models), Retro Urban Kit (124 models), Furniture Kit (140 models)
- **[Poly Haven](https://polyhaven.com)** — HDR environment maps (alps, autumn, blue grotto, belfast sunset, and more)

No attribution is legally required (CC0), but these people give away their life's work for free. Consider supporting them.

## License

MIT

---

Built by [Parzival-Moksha](https://github.com/Parzival-Moksha) with vibes, sweat, and Claude.
